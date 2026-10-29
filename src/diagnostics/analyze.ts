import { advicePlan } from '../shared/advice-plan';
import { retryProgress } from './retry-progress';
import type { SQLInputValue } from 'node:sqlite';
import { InspectorStore, validateQuery } from '../storage/InspectorStore';
import { digest, type NormalizedObservation, type SourceContext } from '../accounting/codex-observations';
import { integer, metric } from '../accounting/integers';
import { thresholdFindings } from './thresholds';
import { compactionOperations, compactionDiagnostics } from './compactions';
import type { DiagnosticsView, FindingView, InspectorPage, InspectorQuery, LedgerEntry, ToolView, ToolActivityCounts, ToolActivityGroup, ToolActivityView } from '../shared/inspector';

type Row = Record<string, SQLInputValue>;
interface ToolRecord { view: ToolView; input: NormalizedObservation['metadata']; output: NormalizedObservation['metadata']; context: SourceContext; }

function scopeFilter(store: InspectorStore, query: InspectorQuery, dateColumn: string, contextColumn: string, prefix = '') {
  return store.metadataFilter(query, dateColumn, contextColumn, prefix);
}

function decode(row: Row): ToolRecord {
  const input = row.input_metadata ? JSON.parse(String(row.input_metadata)) as NormalizedObservation['metadata'] : {};
  const output = row.output_metadata ? JSON.parse(String(row.output_metadata)) as NormalizedObservation['metadata'] : {};
  const start = row.started_at === null ? null : String(row.started_at); const end = row.completed_at === null ? null : String(row.completed_at);
  const refs = [row.input_evidence, row.output_evidence].filter((ref): ref is string => typeof ref === 'string');
  const status = Number(row.conflicted) ? 'conflicted' : row.output_observation ? output.status === 'error' || (output.exitCode !== undefined && output.exitCode !== '0') ? 'failed' : 'completed' : row.input_observation ? 'running' : 'unknown';
  return { input, output, context: JSON.parse(String(row.context)) as SourceContext, view: {
    id: String(row.id), sourceId: String(row.source_id), threadId: row.thread_id === null ? null : String(row.thread_id), callId: String(row.call_id), name: String(row.name ?? '(unknown)'),
    generation: row.input_generation === null && row.output_generation === null ? null : Number(row.input_generation ?? row.output_generation),
    operation: input.operation ?? 'other', startedAt: start, completedAt: end, durationMs: start && end && Date.parse(end) >= Date.parse(start) ? Date.parse(end) - Date.parse(start) : null,
    status, argumentBytes: input.argumentBytes ?? null, argumentEstimate: metric(input.argumentTokenEstimate ?? null, input.argumentTokenEstimate === undefined ? 'unknown' : 'estimated', 'tokenizer', refs, ['Recorded argument text only; approximate UTF-8 bytes / 4. Official generated output tokens, serialization overhead and subsequent request inclusion are not measured.']),
    outputBytes: output.outputBytes ?? null, payloadEstimate: metric(output.payloadTokenEstimate ?? null, 'estimated', 'tokenizer', refs, ['Approximate UTF-8 bytes / 4; captured payload only; serialization overhead and later request inclusion are unknown.']),
    origin: input.origin ?? 'unknown', captureComplete: output.captureComplete ?? null, evidenceRefs: refs, pairedBy: row.input_observation && row.output_observation ? 'provider_id' : 'unpaired',
  } };
}

export function toolsPage(store: InspectorStore, queryValue: unknown = {}): InspectorPage<ToolView> {
  const query = validateQuery(queryValue); const filter = scopeFilter(store, query, 'COALESCE(t.completed_at,t.started_at)', 't.context'); const limit = query.limit ?? 200;
  const signature = digest(JSON.stringify({ ...query, cursor: undefined, limit: undefined }));
  const revision = Number(store.db.prepare('SELECT COALESCE(MAX(rowid),0) value FROM observations WHERE workspace_id=?').get(store.workspaceId)!.value);
  let after = '';
  if (query.cursor) {
    let cursor; try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); } catch { throw new Error('INVALID_CURSOR'); }
    if (cursor.kind !== 'tools' || cursor.identity !== '2' || cursor.filter !== signature || typeof cursor.after !== 'string' || cursor.after.length > 256) throw new Error('INVALID_CURSOR');
    if (cursor.revision !== revision) throw new Error('REVISION_CHANGED'); after = cursor.after;
  }
  const rows = store.db.prepare(`SELECT t.*,i.generation AS input_generation,o.generation AS output_generation,i.evidence_ref AS input_evidence,o.evidence_ref AS output_evidence FROM tool_index t JOIN sources s ON s.id=t.source_id
    LEFT JOIN observations i ON i.id=t.input_observation LEFT JOIN observations o ON o.id=t.output_observation
    WHERE ${filter.sql} AND t.id>? ORDER BY t.id LIMIT ?`)
    .all(...filter.args, after, limit + 1) as Row[];
  const items = rows.slice(0, limit).map(row => decode(row).view);
  return { revision, items, nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ kind: 'tools', identity: '2', filter: signature, revision, after: items.at(-1)!.id })).toString('base64url') : null };
}

const activityCounts = (): ToolActivityCounts => ({ records: 0, invocations: 0, unpaired: 0, failed: 0, conflicted: 0, outputs: 0, measuredOutputs: 0, outputBytes: null,
  measuredArguments: 0, argumentBytes: null, measuredArgumentEstimates: 0, argumentEstimate: null,
  measuredEstimates: 0, payloadEstimate: null, partialOutputs: 0, unknownCaptureOutputs: 0, comparableOutputs: 0, repeatedOutputRecords: 0, repeatedOutputBytes: null, measuredDurations: 0, durationMs: null });
const addActivity = (total: string | null, value: string) => (BigInt(total ?? '0') + BigInt(value)).toString();
/** Full scoped tool population; display caps never truncate aggregate counts. */
export function toolActivity(store: InspectorStore, queryValue: unknown = {}): ToolActivityView {
  const query = validateQuery(queryValue); if (query.cursor) throw new Error('INVALID_CURSOR');
  const filter = scopeFilter(store, query, 'COALESCE(t.completed_at,t.started_at)', 't.context');
  const observationRevision = Number(store.db.prepare('SELECT COALESCE(MAX(rowid),0) value FROM observations WHERE workspace_id=?').get(store.workspaceId)!.value);
  const totals = activityCounts(); const groups = new Map<string, { group: ToolActivityGroup; fingerprints: Set<string> }>();
  const rows = store.db.prepare(`SELECT t.*,i.generation AS input_generation,o.generation AS output_generation,i.evidence_ref AS input_evidence,o.evidence_ref AS output_evidence FROM tool_index t JOIN sources s ON s.id=t.source_id
    LEFT JOIN observations i ON i.id=t.input_observation LEFT JOIN observations o ON o.id=t.output_observation WHERE ${filter.sql} ORDER BY t.id`).iterate(...filter.args);
  for (const raw of rows) {
    const row = raw as Row; const { view, output } = decode(row); const key = JSON.stringify([view.name, view.operation]);
    let item = groups.get(key); if (!item) { item = { group: { ...activityCounts(), name: view.name, operation: view.operation, evidenceRefs: [] }, fingerprints: new Set() }; groups.set(key, item); }
    const eligible = view.status !== 'conflicted' && !!row.output_observation;
    const comparable = eligible && !!output.outputFingerprint && view.outputBytes !== null;
    const repeated = comparable && item.fingerprints.has(output.outputFingerprint!);
    if (comparable) item.fingerprints.add(output.outputFingerprint!);
    for (const counts of [totals, item.group]) {
      counts.records++; if (row.input_observation) counts.invocations++; if (view.pairedBy === 'unpaired') counts.unpaired++;
      if (view.status === 'failed') counts.failed++; if (view.status === 'conflicted') counts.conflicted++;
      if (row.output_observation) counts.outputs++;
      if (view.status !== 'conflicted' && row.input_observation) {
        if (view.argumentBytes !== null) { counts.measuredArguments++; counts.argumentBytes = addActivity(counts.argumentBytes, view.argumentBytes); }
        if (view.argumentEstimate.value !== null) { counts.measuredArgumentEstimates++; counts.argumentEstimate = addActivity(counts.argumentEstimate, view.argumentEstimate.value); }
      }
      if (eligible) {
        if (view.outputBytes !== null) { counts.measuredOutputs++; counts.outputBytes = addActivity(counts.outputBytes, view.outputBytes); }
        if (view.payloadEstimate.value !== null) { counts.measuredEstimates++; counts.payloadEstimate = addActivity(counts.payloadEstimate, view.payloadEstimate.value); }
        if (view.captureComplete === false) counts.partialOutputs++; if (view.captureComplete === null) counts.unknownCaptureOutputs++;
        if (comparable) { counts.comparableOutputs++; counts.repeatedOutputBytes ??= '0'; }
        if (repeated) { counts.repeatedOutputRecords++; counts.repeatedOutputBytes = addActivity(counts.repeatedOutputBytes, view.outputBytes!); }
        if (view.durationMs !== null) { counts.measuredDurations++; counts.durationMs = addActivity(counts.durationMs, String(view.durationMs)); }
      }
    }
    for (const ref of view.evidenceRefs) if (item.group.evidenceRefs.length < 5 && !item.group.evidenceRefs.includes(ref)) item.group.evidenceRefs.push(ref);
  }
  const ranked = [...groups.values()].map(item => item.group).sort((a, b) => {
    const left = BigInt(a.outputBytes ?? '-1'); const right = BigInt(b.outputBytes ?? '-1'); return left === right ? b.records - a.records || a.name.localeCompare(b.name) || a.operation.localeCompare(b.operation) : left > right ? -1 : 1;
  });
  return { revision: store.revision(), observationRevision, toolIdentityVersion: 'codex-tool/2', totals, groups: ranked.slice(0, 20), groupCount: ranked.length, groupLimit: 20 };
}

function finding(store: InspectorStore, detectorId: string, target: string, records: ToolRecord[], duplicateTokens: bigint | null, suppressions: string[] = []): FindingView {
  const first = records[0]; const id = `finding:${digest(`${store.workspaceId}:${detectorId}/2:${first.view.sourceId}:${first.view.generation}:${first.view.threadId}:${first.context.contextEpoch}:${target}`)}`;
  const repeated = detectorId === 'repeated-read';
  return { id, detectorId, detectorVersion: '2', title: repeated ? 'Repeated captured content / 重複讀取內容' : 'Comparable failures recur / 相近失敗重複出現',
    confidence: suppressions.length ? 'low' : repeated && records.every(r => r.view.captureComplete === true) ? 'medium' : 'low', severity: 'info',
    observedFacts: [repeated ? `${records.length} operations emitted the same captured payload in one context epoch.` : `${records.length} comparable execution attempts report failure in a ten-minute window.`],
    hypotheses: [repeated ? 'Some repeated reads may be redundant.' : 'A recurring environment or task assumption may need investigation.'],
    alternativeExplanations: repeated ? ['Required verification, external changes, or independent review may justify rereading.', 'Request inclusion and actual cache allocation are not captured.'] : ['Relevant changes or environment progress may not appear in the trace.', 'An intentional retry/backoff test can produce the same pattern.'],
    evidenceRefs: records.flatMap(r => r.view.evidenceRefs).slice(0, 40), associatedLedgerEntryIds: [], associatedUsage: metric(null, 'unknown', 'unknown'),
    duplicatePayloadEstimate: metric(duplicateTokens === null ? null : integer(duplicateTokens), 'estimated', 'tokenizer', records.flatMap(r => r.view.evidenceRefs).slice(0, 40), ['Duplicate emitted payload, using approximate UTF-8 bytes / 4; not duplicate billed input.']),
    avoidableTokens: metric(null, 'unknown', 'unknown', [], ['Avoidable savings require an eligible before/after experiment.']),
    recommendations: [repeated ? 'Read the relevant ranges once and retain a short evidence reference; keep necessary verification.' : 'Check the recurring failure signature and the environment before the next bounded diagnostic step.'],
    qualityRisk: 'Reducing evidence or verification can hide a correctness issue.', validation: 'Compare an approved run with the same acceptance criteria; revert if quality declines.',
    suppressionReasons: suppressions, annotation: store.annotation(id) as FindingView['annotation'], occurrences: records.length,
    latestEvidenceRef: records.at(-1)?.view.evidenceRefs.at(-1), lastObservedAt: records.at(-1)?.view.completedAt ?? null,
  };
}

const cachedViews = new WeakMap<InspectorStore, { stamp: string; views: Map<string, DiagnosticsView> }>();
export function clearDiagnosticsCache(store: InspectorStore): void { cachedViews.delete(store); }
function analysisStamp(store: InspectorStore): string {
  return `${store.db.prepare('PRAGMA data_version').get()!.data_version}:${store.db.prepare('SELECT CAST(total_changes() AS TEXT) AS value').get()!.value}`;
}
export function analyze(store: InspectorStore, queryValue: unknown = {}): DiagnosticsView {
  const query = validateQuery(queryValue); query.limit ??= 200;
  // Rolling date windows change with the clock; fixed scopes depend only on DB state.
  if (query.days) return computeDiagnostics(store, query);
  const stamp = analysisStamp(store); const key = JSON.stringify(Object.entries(query).sort(([a], [b]) => a.localeCompare(b)));
  let cache = cachedViews.get(store);
  if (!cache || cache.stamp !== stamp) { cache = { stamp, views: new Map() }; cachedViews.set(store, cache); }
  const previous = cache.views.get(key); if (previous) return structuredClone(previous);
  const result = computeDiagnostics(store, query);
  if (cache.views.size >= 4) cache.views.delete(cache.views.keys().next().value!);
  cache.views.set(key, structuredClone(result)); return result;
}
function computeDiagnostics(store: InspectorStore, query: InspectorQuery): DiagnosticsView {
  const filter = scopeFilter(store, query, 'COALESCE(t.completed_at,t.started_at)', 't.context');
  const findings: FindingView[] = []; const context = new Map<string, { bytes: bigint; estimate: bigint; occurrences: number }>();
  const rows = store.db.prepare(`SELECT t.*,i.generation AS input_generation,o.generation AS output_generation,i.evidence_ref AS input_evidence,o.evidence_ref AS output_evidence FROM tool_index t JOIN sources s ON s.id=t.source_id
    LEFT JOIN observations i ON i.id=t.input_observation LEFT JOIN observations o ON o.id=t.output_observation WHERE ${filter.sql} ORDER BY t.source_id,COALESCE(i.generation,o.generation),t.started_at,t.id`);
  const reads = new Map<string, { count: number; examples: ToolRecord[]; estimate: bigint; suppressed: Set<string> }>();
  const failures = new Map<string, { started: number; count: number; examples: ToolRecord[] }>();
  const largeOutputs = new Map<string, { count: number; examples: ToolRecord[] }>();
  let lastSource: string | undefined; let recentEditAt: string | null = null; let fingerprintsAvailable = false; let toolCount = 0;
  for (const raw of rows.iterate(...filter.args)) {
    const record = decode(raw as Row); const tool = record.view; toolCount++;
    const toolStream = JSON.stringify([tool.sourceId,tool.generation]);
    if (lastSource !== toolStream) { reads.clear(); failures.clear(); largeOutputs.clear(); recentEditAt = null; lastSource = toolStream; }
    if (tool.outputBytes !== null) {
      const group = context.get(tool.origin) ?? { bytes: 0n, estimate: 0n, occurrences: 0 };
      group.bytes += BigInt(tool.outputBytes); group.estimate += BigInt(tool.payloadEstimate.value ?? '0'); group.occurrences++; context.set(tool.origin, group);
    }
    if (tool.operation === 'edit' && tool.status === 'completed') { recentEditAt = tool.completedAt; failures.clear(); }
    if (record.output.outputFingerprint) fingerprintsAvailable = true;
    if (tool.outputBytes !== null && BigInt(tool.outputBytes) >= 262144n) {
      const key = `${record.context.contextEpoch}:${tool.origin}`; const group = largeOutputs.get(key) ?? { count: 0, examples: [] };
      group.count++; if (group.examples.length < 19) group.examples.push(record); largeOutputs.set(key, group);
      const candidate = finding(store, 'large-output', key, [...group.examples.filter(item => item !== record), record], null, tool.captureComplete ? [] : ['Partial output capture; full size is unknown.']);
      candidate.title = 'Large captured output / 大型已捕捉輸出'; candidate.occurrences = group.count; candidate.confidence = tool.captureComplete ? 'medium' : 'low';
      candidate.observedFacts = [`${group.count} captured outputs exceed the explicit 262144-byte threshold in this context epoch.`];
      candidate.hypotheses = ['A bounded failure summary may preserve relevant diagnostics with less emitted text.'];
      candidate.alternativeExplanations = ['Full output may be necessary evidence; model request inclusion is not recorded.'];
      candidate.recommendations = ['Keep the complete log locally and compare a concise summary under the same acceptance criteria.'];
      const existing = findings.findIndex(item => item.id === candidate.id); if (existing >= 0) findings[existing] = candidate; else if (findings.length < 200) findings.push(candidate);
    }
    if (tool.operation === 'read' && tool.status === 'completed' && record.output.outputFingerprint) {
      const key = `${record.context.contextEpoch}:${record.input.targetFingerprint ?? 'unknown'}:${record.output.outputFingerprint}`;
      const group = reads.get(key) ?? { count: 0, examples: [], estimate: 0n, suppressed: new Set<string>() };
      group.count++; if (group.examples.length < 20) group.examples.push(record);
      if (group.count > 1) group.estimate += BigInt(tool.payloadEstimate.value ?? '0');
      if (record.context.verificationIntent || /review|verify|test/i.test(record.context.declaredPurpose ?? '')) group.suppressed.add('Explicit verification or independent-review purpose.');
      if (recentEditAt && tool.startedAt && Date.parse(tool.startedAt) >= Date.parse(recentEditAt)) group.suppressed.add('A preceding edit may justify verification.');
      if (!tool.captureComplete) group.suppressed.add('Partial or truncated capture.');
      reads.set(key, group);
      if (group.count >= 3 && group.estimate >= 2000n) {
        const candidate = finding(store, 'repeated-read', key, group.examples, group.estimate, [...group.suppressed]);
        candidate.occurrences = group.count; candidate.latestEvidenceRef = tool.evidenceRefs.at(-1); candidate.lastObservedAt = tool.completedAt;
        const existing = findings.findIndex(f => f.id === candidate.id);
        if (existing >= 0) findings[existing] = candidate; else if (findings.length < 200) findings.push(candidate);
      }
    }
    if (tool.operation === 'execute' && tool.status === 'failed' && (record.input.commandFingerprint || record.input.argumentsFingerprint) && (record.output.failureFingerprint || record.output.outputFingerprint) && tool.completedAt) {
      const key = `${record.input.commandFingerprint ?? record.input.argumentsFingerprint}:${record.output.failureFingerprint ?? record.output.outputFingerprint}`;
      const at = Date.parse(tool.completedAt); const saved = failures.get(key);
      const group = !saved || at < saved.started || at - saved.started > 600000 ? { started: at, count: 0, examples: [] } : saved;
      group.count++; if (group.examples.length < 19) group.examples.push(record); failures.set(key, group);
      if (group.count >= 3) {
        const candidate = finding(store, 'retry-recurrence', key, [...group.examples.filter(item => item !== record), record], null, record.context.verificationIntent ? ['Explicit verification/retry purpose.'] : []);
        candidate.occurrences = group.count; candidate.observedFacts = [`${group.count} comparable execution failures occur within one bounded ten-minute incident window.`];
        const existing = findings.findIndex(f => f.id === candidate.id);
        if (existing >= 0) findings[existing] = candidate; else if (findings.length < 200) findings.push(candidate);
      }
    }
  }
  const eventFilter = scopeFilter(store, query, 'o.timestamp', 'COALESCE(a.normalized,o.normalized)', 'context.');
  const messageRows = store.db.prepare(`SELECT COALESCE(a.normalized,o.normalized) AS normalized FROM timeline_events e CROSS JOIN observations o ON o.id=e.observation_id JOIN sources s ON s.id=o.source_id
    LEFT JOIN source_analysis v ON v.source_id=o.source_id LEFT JOIN observation_analyses a ON a.observation_id=o.id AND a.revision=v.revision
    WHERE e.workspace_id=? AND e.kind='response_item/message' AND ${eventFilter.sql}`);
  for (const row of messageRows.iterate(store.workspaceId, ...eventFilter.args)) {
    const metadata = (JSON.parse(String(row.normalized)) as NormalizedObservation).metadata;
    if (!metadata.origin || !metadata.outputBytes || !metadata.payloadTokenEstimate) continue;
    const group = context.get(metadata.origin) ?? { bytes: 0n, estimate: 0n, occurrences: 0 };
    group.bytes += BigInt(metadata.outputBytes); group.estimate += BigInt(metadata.payloadTokenEstimate); group.occurrences++; context.set(metadata.origin, group);
  }
  const retries = retryProgress(store, query);
  for (const candidate of findings) if (candidate.detectorId === 'retry-recurrence') {
    const episode = retries.episodes.find(episode => episode.evidenceRefs.some(ref => candidate.evidenceRefs.includes(ref)));
    if (episode) { candidate.detectorVersion = '2';
      if (episode.status === 'command_succeeded') { candidate.suppressionReasons.push('A subsequent comparable command reported exit code zero; task acceptance is not established.'); candidate.hypotheses = ['The recurrence was followed by observed command success.']; }
      else if (episode.status !== 'recurring_failure' && (episode.edits || episode.failureChanges)) candidate.suppressionReasons.push('Recorded edits or changed failure signatures may indicate a productive diagnostic step.');
    }
  }
  for (const episode of retries.episodes) if (episode.peakComparableFailures >= 3 && !findings.some(finding => finding.detectorId === 'retry-recurrence' && finding.evidenceRefs.some(ref => episode.evidenceRefs.includes(ref)))) {
    if (findings.length >= 200) break;
    const id = `finding:${digest(`${store.workspaceId}:${episode.id}:retry-progress/1`)}`;
    findings.push({ id, detectorId: 'retry-recurrence', detectorVersion: '2', title: 'Comparable failures recur / 相近失敗重複出現', confidence: 'low', severity: 'info',
      observedFacts: [`${episode.peakComparableFailures} comparable failed executions were recorded since the latest edit/failure-signature change; linked polling is not a new attempt.`],
      hypotheses: ['A recurring environment or task assumption may need investigation.'], alternativeExplanations: ['Missing changes, required independent verification or partial capture may explain repetition.'],
      evidenceRefs: episode.evidenceRefs, associatedLedgerEntryIds: [], associatedUsage: metric(null, 'unknown', 'unknown'), duplicatePayloadEstimate: metric(null, 'unknown', 'unknown'), avoidableTokens: metric(null, 'unknown', 'unknown'),
      recommendations: ['Inspect the latest failure evidence before another bounded diagnostic attempt.'], qualityRisk: 'Stopping required verification can hide correctness issues.', validation: 'Keep the same acceptance contract while testing a changed approach.',
      suppressionReasons: [...episode.notes, ...(episode.status === 'command_succeeded' ? ['A subsequent comparable command reported exit code zero; task acceptance is not established.'] : episode.status !== 'recurring_failure' && (episode.edits || episode.failureChanges) ? ['Recorded edits or changed failure signatures may indicate a productive diagnostic step.'] : [])], annotation: store.annotation(id) as FindingView['annotation'], occurrences: episode.peakComparableFailures, latestEvidenceRef: episode.evidenceRefs.at(-1), lastObservedAt: episode.latestAt });
    if (findings.length >= 200) break;
  }
  const operations = compactionOperations(store, query);
  findings.push(...thresholdFindings(store, query, operations).slice(0, 200 - findings.length));
  const union = new Map<string, LedgerEntry>();
  const usageFilter = store.queryFilter(query, 'l');
  const associatedRows = store.db.prepare(`SELECT json_set(p.entry,'$.revision',l.revision) AS entry
    FROM scope_state a CROSS JOIN ledger_memberships l ON a.scope_id=l.scope_id AND a.active_revision=l.revision
    JOIN ledger_payloads p ON p.id=l.payload_id
    WHERE ${usageFilter.sql.replaceAll('l.entry', 'p.entry')} AND l.source_id=? AND l.source_generation=? AND l.status='selected' AND l.sequence BETWEEN ? AND ?`);
  for (const candidate of findings) {
    const pointers = candidate.evidenceRefs.map(ref => store.evidencePointer(ref)).filter(pointer => pointer !== null);
    const grouped = new Map<string, { sourceId: string; generation: number; first: number; last: number }>();
    for (const pointer of pointers) {
      const key = JSON.stringify([pointer.cursor.id, pointer.row.generation]);
      const range = grouped.get(key) ?? { sourceId: pointer.cursor.id, generation: pointer.row.generation, first: pointer.row.line, last: pointer.row.line };
      range.first = Math.min(range.first, pointer.row.line); range.last = Math.max(range.last, pointer.row.line); grouped.set(key, range);
    }
    let known = 0n; let count = 0; const entryIds: string[] = [];
    for (const range of grouped.values()) {
      for (const row of associatedRows.iterate(...usageFilter.args, range.sourceId, range.generation, range.first, range.last)) {
        const entry = JSON.parse(String(row.entry)) as LedgerEntry;
        // Initial aggregates include history before the incident; overlapping
        // intervals cannot be allocated unless their complete range is linked.
        if (entry.grain === 'aggregate') continue;
        if (entry.grain === 'interval' && (entry.coverage.fromSequence === null || entry.coverage.toSequence === null)) continue;
        if (entry.grain === 'interval' && entry.evidenceRefs.some(ref => { const pointer = store.evidencePointer(ref); return !pointer || pointer.cursor.id !== range.sourceId || pointer.row.generation !== range.generation || pointer.row.line < range.first || pointer.row.line > range.last; })) continue;
        if (entry.usage.total.value !== null) { known += BigInt(entry.usage.total.value); count++; }
        if (entryIds.length < 200) entryIds.push(entry.id); union.set(entry.id, entry);
      }
    }
    candidate.associatedLedgerEntryIds = entryIds;
    candidate.associatedUsage = metric(count ? integer(known) : null, count ? 'derived' : 'unknown', 'monitor_calculation', entryIds,
      ['Selected membership fully inside the linked recorded range. Association is not causal tool cost; missing final usage remains unknown.']);
  }
  let unionTotal = 0n; let unionKnown = 0;
  for (const entry of union.values()) if (entry.usage.total.value !== null) { unionTotal += BigInt(entry.usage.total.value); unionKnown++; }
  const page = toolsPage(store, query);
  for (const candidate of findings) candidate.plan = advicePlan(candidate);
  return { revision: store.revision(), tools: page.items, nextToolsCursor: page.nextCursor, findings,
    context: [...context].map(([origin, value]) => ({ origin, bytes: integer(value.bytes), occurrences: value.occurrences, estimate: metric(integer(value.estimate), 'estimated', 'tokenizer', [], ['Approximate UTF-8 bytes / 4; one exclusive primary-origin category per captured tool result.']) })),
    ...compactionDiagnostics(store, query, operations), retries, associatedUnionUsage: metric(unionKnown ? integer(unionTotal) : null, unionKnown ? 'derived' : 'unknown', 'monitor_calculation', [...union.keys()].slice(0, 200), ['Each selected ledger entry contributes once across findings; association is not avoidable cost.']),
    notes: [`${toolCount} indexed invocations; the tool list is paged independently from whole-scope findings.`,
      'Tool payload estimates are separate from provider input usage. Subsequent request inclusion and avoidable cost remain unknown.',
      'Captured messages and visible instructions are counted once per recorded occurrence, not once per assumed model request. Hidden system/reasoning context is unavailable.',
      ...(fingerprintsAvailable ? [] : ['Insufficient fingerprint evidence: secure local fingerprinting or captured outputs are unavailable.']),
      'External AI analysis and automatic Codex actions are disabled.'] };
}
