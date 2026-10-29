import { digest, type NormalizedObservation, type SourceContext } from '../accounting/codex-observations';
import { metric } from '../accounting/integers';
import type { InspectorStore } from '../storage/InspectorStore';
import type { InspectorQuery, LedgerEntry } from '../shared/inspector';
import type { RetryAttempt, RetryEpisode, RetryProgressView } from '../shared/retry-progress';

interface Attempt extends RetryAttempt { command: string; failure: string | null; generation: number; sourceId: string; }
interface Episode { view: RetryEpisode; attempts: Attempt[]; lastFailure: string | null; editAt: number; latestEdit: number; streak: number; }

export function retryProgress(store: InspectorStore, query: InspectorQuery): RetryProgressView {
  const filter = store.metadataFilter(query, 'COALESCE(t.completed_at,t.started_at)', 't.context'); const episodes: Episode[] = [];
  const active = new Map<string, Episode>(); const processes = new Map<string, { attempt: Attempt; episode: Episode | null }>(); const seen = new Set<string>();
  let stream = ''; let edits = 0; let unlinkedPolls = 0;
  const rows = store.db.prepare(`SELECT t.*,s.machine_id,i.sequence AS first,o.sequence AS last,i.generation AS input_generation,o.generation AS output_generation,i.evidence_ref AS input_ref,o.evidence_ref AS output_ref
    FROM tool_index t JOIN sources s ON s.id=t.source_id LEFT JOIN observations i ON i.id=t.input_observation LEFT JOIN observations o ON o.id=t.output_observation
    WHERE ${filter.sql} ORDER BY t.source_id,COALESCE(i.generation,o.generation),COALESCE(i.sequence,o.sequence),t.id`);
  for (const row of rows.iterate(...filter.args)) {
    const context = JSON.parse(String(row.context)) as SourceContext; const generation = Number(row.input_generation ?? row.output_generation ?? 0); const sourceId = String(row.source_id); const machineId = String(row.machine_id);
    const current = JSON.stringify([sourceId, generation, context.threadId, context.contextEpoch]);
    if (current !== stream) { active.clear(); processes.clear(); edits = 0; stream = current; }
    const identity = JSON.stringify([machineId, generation, context.threadId, row.call_id]); if (seen.has(identity)) continue; seen.add(identity);
    const input = row.input_metadata ? JSON.parse(String(row.input_metadata)) as NormalizedObservation['metadata'] : {};
    const output = row.output_metadata ? JSON.parse(String(row.output_metadata)) as NormalizedObservation['metadata'] : {};
    const refs = [row.input_ref, row.output_ref].filter((ref): ref is string => typeof ref === 'string');
    const at = row.completed_at === null ? null : String(row.completed_at); const first = row.first === null ? null : Number(row.first); const last = row.last === null ? null : Number(row.last);
    if (Number(row.conflicted) || row.input_generation !== null && row.output_generation !== null && row.input_generation !== row.output_generation) continue;
    if (input.operation === 'edit' && row.output_observation && output.status !== 'error') { edits++; continue; }
    const failed = output.exitCode !== undefined && output.exitCode !== '0' || output.status === 'error';
    const succeeded = output.exitCode === '0';
    if (input.operation === 'poll') {
      const running = input.processRef ? processes.get(input.processRef) : undefined;
      if (!running) { unlinkedPolls++; continue; }
      const attempt = running.attempt; attempt.polls++; attempt.evidenceRefs.push(...refs); attempt.lastSequence = last; attempt.completedAt = at; attempt.exitCode = output.exitCode ?? null;
      attempt.outcome = failed ? 'failed' : succeeded ? 'command_succeeded' : 'running'; if (failed) attempt.failure = output.failureFingerprint ?? output.outputFingerprint ?? null;
      if (running.episode) {
        running.episode.view.polls++; running.episode.view.latestAt = at; running.episode.view.evidenceRefs.push(...refs); running.episode.view.edits = edits - running.episode.editAt;
        if (failed && attempt.failure) recordFailure(running.episode, attempt.failure, edits);
      }
      if (succeeded) { if (running.episode) running.episode.streak = 0; active.delete(attempt.command); }
      if (succeeded || failed) processes.delete(input.processRef!);
      if (failed && !running.episode && attempt.failure) {
        const view = makeEpisode(store, attempt, machineId, context); const episode = { view, attempts: [attempt], lastFailure: attempt.failure, editAt: edits, latestEdit: edits, streak: 1 }; active.set(attempt.command, episode); episodes.push(episode); running.episode = episode;
      }
      continue;
    }
    if (input.operation !== 'execute' || !(input.commandFingerprint || input.argumentsFingerprint)) continue;
    const command = input.commandFingerprint ?? input.argumentsFingerprint!; let episode = active.get(command);
    if (episode && at && episode.view.startedAt && (Date.parse(at) < Date.parse(episode.view.startedAt) || Date.parse(at) - Date.parse(episode.view.startedAt) > 600000)) { active.delete(command); episode = undefined; }
    const attempt: Attempt = { command, failure: failed ? output.failureFingerprint ?? output.outputFingerprint ?? null : null, sourceId, generation,
      callId: String(row.call_id), startedAt: row.started_at === null ? null : String(row.started_at), completedAt: at, exitCode: output.exitCode ?? null,
      outcome: failed ? 'failed' : succeeded ? 'command_succeeded' : output.processState === 'running' ? 'running' : 'unknown', polls: 0, evidenceRefs: refs, firstSequence: first, lastSequence: last };
    if (!episode && failed && attempt.failure) { const view = makeEpisode(store, attempt, machineId, context); episode = { view, attempts: [], lastFailure: null, editAt: edits, latestEdit: edits, streak: 0 }; active.set(command, episode); episodes.push(episode); }
    if (episode) {
      episode.attempts.push(attempt); episode.view.latestAt = at;
      if (failed && attempt.failure) recordFailure(episode, attempt.failure, edits);
      episode.view.edits = edits - episode.editAt;
      episode.view.evidenceRefs.push(...refs);
      if (succeeded) { episode.streak = 0; active.delete(command); }
    }
    if (output.processRef && output.processState === 'running') processes.set(output.processRef, { attempt, episode: episode ?? null });
  }
  const filterUsage = store.queryFilter(query, 'l');
  const displayed = episodes.slice(-200);
  for (const episode of displayed) {
    const view = episode.view; const attempts = episode.attempts;
    view.attemptCount = attempts.length; view.failures = attempts.filter(attempt => attempt.outcome === 'failed').length; view.consecutiveFailures = episode.streak; view.polls = attempts.reduce((sum, attempt) => sum + attempt.polls, 0);
    const latest = attempts.at(-1)!; view.status = latest.outcome === 'command_succeeded' ? 'command_succeeded' : latest.outcome === 'running' ? 'running' : episode.streak >= 3 ? 'recurring_failure' : view.edits ? 'edit_then_retry' : view.failureChanges ? 'failure_changed' : 'unknown';
    view.successEvidenceRef = latest.outcome === 'command_succeeded' ? latest.evidenceRefs.at(-1) ?? null : null;
    view.attempts = attempts.slice(-50).map(({ command: _command, failure: _failure, sourceId: _source, generation: _generation, ...attempt }) => attempt);
    view.evidenceRefs = [...new Set(view.evidenceRefs)].slice(-40);
    let total = 0n; let known = false; const union = new Set<string>();
    for (const attempt of attempts.slice(-50)) {
      if (attempt.firstSequence === null || attempt.lastSequence === null || attempt.lastSequence < attempt.firstSequence) continue;
      for (const row of store.db.prepare(`SELECT p.entry FROM observations o CROSS JOIN ledger_links k ON k.observation_id=o.id AND k.relation='support' AND k.revision IN (SELECT active_revision FROM scope_state WHERE workspace_id=?) CROSS JOIN ledger_memberships l ON l.id=k.entry_id AND l.revision=k.revision CROSS JOIN scope_state r ON r.scope_id=l.scope_id AND r.active_revision=l.revision CROSS JOIN ledger_payloads p ON p.id=l.payload_id
        WHERE o.workspace_id=? AND o.source_id=? AND o.generation=? AND o.sequence BETWEEN ? AND ? AND ${filterUsage.sql.replaceAll('l.entry', 'p.entry')} AND l.thread_id IS ? AND l.status='selected'`).iterate(store.workspaceId, store.workspaceId, attempt.sourceId, attempt.generation, attempt.firstSequence, attempt.lastSequence, ...filterUsage.args, view.threadId)) {
        const entry = JSON.parse(String(row.entry)) as LedgerEntry; if (entry.grain !== 'response' || union.has(entry.id)) continue; union.add(entry.id); if (entry.usage.total.value !== null) { total += BigInt(entry.usage.total.value); known = true; }
      }
    }
    view.associatedUsage = metric(known ? total.toString() : null, known ? 'derived' : 'unknown', 'monitor_calculation', [...union], ['Selected response membership inside the last 50 paired attempt ranges, counted once. This is association, not retry overhead or avoidable cost.']);
  }
  return { episodes: displayed.map(episode => episode.view), totalEpisodes: episodes.length, unlinkedPolls,
    notes: ['Comparable command/failure signatures are required; missing fingerprints do not prove no retries.', 'Polling a linked process updates one attempt. Unlinked polling is counted separately, not as a failed execution.', 'Edits are recorded tool operations, not verified repository changes. A changed failure signature is not proof of productive progress.', 'Exit code zero establishes command success only. Task acceptance and avoidable savings require separate evidence.', 'Episodes use retained source order, source generation/context epoch and a ten-minute observed window. Missing timestamps and truncated metadata may hide transitions.', 'Counts cover all matching episodes; at most 200 episodes and the last 50 attempts each are displayed.'] };
}

function makeEpisode(store: InspectorStore, attempt: Attempt, machineId: string, context: SourceContext): RetryEpisode {
  return { id: `retry:${digest(JSON.stringify([store.workspaceId, machineId, context.threadId, attempt.sourceId, attempt.generation, attempt.command, attempt.callId]))}`,
    sourceId: attempt.sourceId, machineId, threadId: context.threadId, generation: attempt.generation, contextEpoch: context.contextEpoch,
    startedAt: attempt.startedAt ?? attempt.completedAt, latestAt: attempt.completedAt, status: 'unknown', attempts: [], attemptCount: 0, failures: 0, consecutiveFailures: 0, peakComparableFailures: 0, edits: 0, failureChanges: 0, polls: 0,
    evidenceRefs: [...attempt.evidenceRefs], successEvidenceRef: null, associatedUsage: metric(null, 'unknown', 'unknown'), avoidableUsage: metric(null, 'unknown', 'unknown'), notes: context.verificationIntent || /review|verify|test/i.test(context.declaredPurpose ?? '') ? ['Explicit verification or independent-review purpose.'] : [] };
}

function recordFailure(episode: Episode, failure: string, edits: number): void {
  const changed = episode.lastFailure !== null && episode.lastFailure !== failure;
  if (changed) episode.view.failureChanges++;
  if (changed || edits !== episode.latestEdit) episode.streak = 0;
  episode.streak++; episode.view.peakComparableFailures = Math.max(episode.view.peakComparableFailures, episode.streak); episode.latestEdit = edits; episode.lastFailure = failure;
}
