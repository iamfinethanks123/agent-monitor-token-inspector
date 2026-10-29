import { digest, object, type NormalizedObservation, type SourceContext } from '../accounting/codex-observations';
import { metric } from '../accounting/integers';
import { validateQuery, type InspectorStore } from '../storage/InspectorStore';
import { privacyVersion } from '../storage/project-privacy';
import type { AgentComparisonView, AgentPurpose, ComparisonAgent, ComparisonInvocation, SharedOperationGroup } from '../shared/agent-comparison';
import type { InspectorQuery, LedgerEntry } from '../shared/inspector';

const purposes: AgentPurpose[] = ['implementation', 'review', 'independent_test', 'research', 'parallel_exploration', 'shared_startup'];
const agentKey = (store: InspectorStore, machine: string, thread: string) => `agent:${digest(JSON.stringify([store.workspaceId, machine, thread]))}`;
interface Source { id: string; machine: string; context: SourceContext; }
interface Invocation { view: ComparisonInvocation; sourceId: string; callId: string; input: NormalizedObservation['metadata']; output: NormalizedObservation['metadata']; first: number | null; last: number | null; generation: number | null; context: SourceContext; }
function sourceRows(store: InspectorStore): Source[] { return store.db.prepare('SELECT id,machine_id,context FROM sources WHERE workspace_id=?').all(store.workspaceId).map(row => ({ id: String(row.id), machine: String(row.machine_id), context: JSON.parse(String(row.context)) })); }
function purposeOf(sources: Source[], store: InspectorStore): { purpose: AgentPurpose | null; purposeOrigin: ComparisonAgent['purposeOrigin'] } {
  const choices = [...new Set(sources.map(source => store.getSetting(`agent-purpose:${source.id}`)).filter(Boolean))];
  if (choices.length === 1 && purposes.includes(choices[0] as AgentPurpose)) return { purpose: choices[0] as AgentPurpose, purposeOrigin: 'user_annotation' };
  const roles = sources.map(source => source.context.declaredPurpose ?? '').join(' ');
  const purpose = /review|覆核/i.test(roles) ? 'review' : /verify|test|驗證|測試/i.test(roles) ? 'independent_test' : /research|explor|研究/i.test(roles) ? 'research' : /implement|builder|實作/i.test(roles) ? 'implementation' : null;
  return { purpose, purposeOrigin: purpose ? 'derived_declared_role' : 'unknown' };
}

export function setAgentPurpose(store: InspectorStore, input: unknown): void {
  const value = object(input);
  if (!value || Object.keys(value).some(key => !['agentId', 'purpose'].includes(key)) || typeof value.agentId !== 'string' || value.purpose !== null && !purposes.includes(value.purpose as AgentPurpose)) throw new Error('INVALID_AGENT_PURPOSE');
  const sources = sourceRows(store).filter(source => source.context.threadId && agentKey(store, source.machine, source.context.threadId) === value.agentId);
  if (!sources.length) throw new Error('AGENT_NOT_RETAINED');
  store.db.exec('BEGIN IMMEDIATE');
  try {
    for (const source of sources) { const key = `agent-purpose:${source.id}`; if (value.purpose === null) store.db.prepare('DELETE FROM settings WHERE key=?').run(key); else store.setSetting(key, String(value.purpose)); }
    store.audit('agent.purpose', value.agentId); store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
}

export function agentComparison(store: InspectorStore, input: unknown = {}): AgentComparisonView {
  const value = object(input); if (!value || Object.keys(value).some(key => !['query', 'leftAgentId', 'rightAgentId', 'focusGroupId'].includes(key))) throw new Error('INVALID_AGENT_COMPARISON');
  if (value.focusGroupId !== undefined && (typeof value.focusGroupId !== 'string' || !/^finding:[a-f0-9]{64}$/.test(value.focusGroupId))) throw new Error('INVALID_AGENT_COMPARISON');
  for (const key of ['leftAgentId', 'rightAgentId'] as const) if (value[key] !== undefined && (typeof value[key] !== 'string' || !/^agent:[a-f0-9]{64}$/.test(value[key]))) throw new Error('INVALID_AGENT_COMPARISON');
  const query = validateQuery(value.query); const filter = store.metadataFilter(query, 'COALESCE(t.completed_at,t.started_at)', 't.context');
  const sources = sourceRows(store); const sourceMap = new Map(sources.map(source => [source.id, source])); const groupedSources = new Map<string, Source[]>();
  for (const source of sources) if (source.context.threadId) { const key = agentKey(store, source.machine, source.context.threadId); const group = groupedSources.get(key) ?? []; group.push(source); groupedSources.set(key, group); }
  const agents = new Map<string, ComparisonAgent>();
  const getAgent = (source: Source, thread: string): ComparisonAgent => {
    const key = agentKey(store, source.machine, thread); const existing = agents.get(key); if (existing) return existing;
    const copies = groupedSources.get(key) ?? [source]; const parentIds = [...new Set(copies.map(copy => copy.context.parentThreadId))]; const forkIds = [...new Set(copies.map(copy => copy.context.forkedFromId))];
    const conflicted = parentIds.length > 1 || forkIds.length > 1; const parent = parentIds[0] ?? null; const fork = forkIds[0] ?? null;
    let root: string | null = thread; const seen = new Set<string>();
    while (root) { if (seen.has(root)) { root = null; break; } seen.add(root); const family: Source[] = groupedSources.get(agentKey(store, source.machine, root)) ?? []; const links = [...new Set(family.map(copy => copy.context.parentThreadId ?? copy.context.forkedFromId).filter(Boolean))]; if (links.length > 1) { root = null; break; } if (!links.length) break; root = links[0]!; }
    const result: ComparisonAgent = { id: key, machineId: source.machine, threadId: thread, rootThreadId: conflicted ? null : root, parentThreadId: parent, forkedFromId: fork,
      relationship: conflicted ? 'conflicted' : parent ? 'parent_link' : fork ? 'fork' : 'unlinked', ...purposeOf(copies, store), invocations: 0, fingerprintedOutputs: 0, selectedEntries: 0, missingUsage: 0, exclusiveUsage: metric(null, 'unknown', 'unknown') };
    agents.set(key, result); return result;
  };
  const invocations = new Map<string, Invocation>(); let mirrored = 0;
  const rows = store.db.prepare(`SELECT t.*,s.machine_id,i.sequence AS first,o.sequence AS last,i.generation AS input_generation,o.generation AS output_generation,i.evidence_ref AS input_ref,o.evidence_ref AS output_ref
    FROM tool_index t JOIN sources s ON s.id=t.source_id LEFT JOIN observations i ON i.id=t.input_observation LEFT JOIN observations o ON o.id=t.output_observation
    WHERE ${filter.sql} ORDER BY t.source_id,t.id`);
  for (const row of rows.iterate(...filter.args)) {
    if (row.thread_id === null) continue;
    const source = sourceMap.get(String(row.source_id))!; const agent = getAgent(source, String(row.thread_id));
    const callId = String(row.call_id); const key = JSON.stringify([agent.id, row.input_generation ?? row.output_generation, callId]); const call = row.input_metadata ? JSON.parse(String(row.input_metadata)) as NormalizedObservation['metadata'] : {};
    const output = row.output_metadata ? JSON.parse(String(row.output_metadata)) as NormalizedObservation['metadata'] : {}; const old = invocations.get(key);
    if (old) { mirrored++; if (Number(row.conflicted) || row.input_generation !== null && row.output_generation !== null && row.input_generation !== row.output_generation || old.input.argumentsFingerprint && call.argumentsFingerprint && old.input.argumentsFingerprint !== call.argumentsFingerprint || old.output.outputFingerprint && output.outputFingerprint && old.output.outputFingerprint !== output.outputFingerprint) old.view.status = 'conflicted'; continue; }
    const status = Number(row.conflicted) || row.input_generation !== null && row.output_generation !== null && row.input_generation !== row.output_generation ? 'conflicted' : row.output_observation ? output.status === 'error' || output.exitCode !== undefined && output.exitCode !== '0' ? 'failed' : 'completed' : row.input_observation ? 'running' : 'unknown';
    const refs = [row.input_ref, row.output_ref].filter((ref): ref is string => typeof ref === 'string');
    const view: ComparisonInvocation = { id: String(row.id), agentId: agent.id, name: String(row.name ?? '(unknown)'), operation: call.operation ?? 'other', startedAt: row.started_at === null ? null : String(row.started_at), completedAt: row.completed_at === null ? null : String(row.completed_at), status, outputBytes: output.outputBytes ?? null, evidenceRefs: refs, sharedGroupIds: [] };
    invocations.set(key, { view, sourceId: source.id, callId, input: call, output, first: row.first === null ? null : Number(row.first), last: row.last === null ? null : Number(row.last), generation: row.input_generation === null ? null : Number(row.input_generation), context: JSON.parse(String(row.context)) });
    agent.invocations++; if (output.outputFingerprint) agent.fingerprintedOutputs++;
  }
  const ledgerFilter = store.queryFilter(query, 'l'); const sums = new Map<string, bigint>();
  for (const row of store.db.prepare(`SELECT l.machine_id,l.thread_id,json_extract(p.entry,'$.usage.total.value') AS total FROM scope_state r CROSS JOIN ledger_memberships l ON l.scope_id=r.scope_id AND l.revision=r.active_revision JOIN ledger_payloads p ON p.id=l.payload_id WHERE ${ledgerFilter.sql.replaceAll('l.entry', 'p.entry')} AND l.status='selected'`).iterate(...ledgerFilter.args)) {
    if (row.thread_id === null || row.machine_id === null) continue; const copies = groupedSources.get(agentKey(store, String(row.machine_id), String(row.thread_id))); if (!copies?.length) continue;
    const agent = getAgent(copies[0], String(row.thread_id)); agent.selectedEntries++; if (row.total === null) agent.missingUsage++; else sums.set(agent.id, (sums.get(agent.id) ?? 0n) + BigInt(String(row.total)));
  }
  for (const agent of agents.values()) { const known = sums.get(agent.id); agent.exclusiveUsage = metric(known === undefined ? null : known.toString(), known === undefined ? 'unknown' : 'derived', 'monitor_calculation', [], ['Exclusive selected usage in the current scope; missing usage is separate. Do not add child inclusive totals.']); }
  const buckets = new Map<string, Invocation[]>();
  for (const invocation of invocations.values()) {
    const agent = agents.get(invocation.view.agentId)!;
    if (!agent.rootThreadId || invocation.view.status === 'conflicted' || !invocation.output.outputFingerprint || BigInt(invocation.output.outputBytes ?? '0') < 256n || !['read', 'execute', 'edit'].includes(invocation.view.operation)) continue;
    const key = JSON.stringify([agent.machineId, agent.rootThreadId, invocation.view.operation, invocation.output.outputFingerprint]); const bucket = buckets.get(key) ?? []; bucket.push(invocation); buckets.set(key, bucket);
  }
  const matching: [string, Invocation[]][] = [];
  for (const [key, calls] of buckets) {
    const identities = new Map<string, Set<string>>(); for (const call of calls) { const members = identities.get(call.callId) ?? new Set(); members.add(call.view.agentId); identities.set(call.callId, members); }
    const distinct = calls.filter(call => identities.get(call.callId)!.size === 1);
    if (new Set(distinct.map(call => call.view.agentId)).size > 1) matching.push([key, distinct]);
  }
  const allAgents = [...agents.values()].sort((a, b) => b.invocations - a.invocations || a.id.localeCompare(b.id));
  const families = new Map<string, string[]>(); for (const agent of allAgents) if (agent.rootThreadId) { const key = JSON.stringify([agent.machineId, agent.rootThreadId]); const family = families.get(key) ?? []; family.push(agent.id); families.set(key, family); }
  const defaults = matching.length ? [...new Set(matching[0][1].map(call => call.view.agentId))] : [...families.values()].find(family => family.length > 1) ?? [];
  const leftId = value.leftAgentId as string | undefined ?? defaults[0] ?? allAgents[0]?.id ?? null; const rightId = value.rightAgentId as string | undefined ?? defaults.find(id => id !== leftId) ?? allAgents.find(agent => agent.id !== leftId)?.id ?? null;
  if (leftId && !agents.has(leftId) || rightId && !agents.has(rightId)) throw new Error('COMPARISON_AGENT_OUT_OF_SCOPE');
  const shared: SharedOperationGroup[] = []; const usageUnion = new Set<string>(); let unionTotal = 0n; let unionKnown = false;
  for (const [key, calls] of matching) {
    if (!leftId || !rightId || leftId === rightId) break;
    const selected = calls.filter(call => call.view.agentId === leftId || call.view.agentId === rightId);
    if (!selected.some(call => call.view.agentId === leftId) || !selected.some(call => call.view.agentId === rightId) || new Set(selected.map(call => call.callId)).size < 2) continue;
    if (shared.length >= 50) break;
    const pair = [leftId!, rightId!].sort(); const id = `finding:${digest(JSON.stringify([store.workspaceId, 'cross-agent/1', key, pair]))}`; const memberAgents = [...new Set(calls.map(call => call.view.agentId))]; const targets = selected.map(call => call.input.targetFingerprint ?? call.input.commandFingerprint ?? null);
    const reviewed = selected.some(call => call.context.verificationIntent) || pair.some(id => ['review', 'independent_test'].includes(agents.get(id)!.purpose ?? ''));
    const classification = reviewed ? 'declared_review' : pair.some(id => agents.get(id)!.purpose === 'shared_startup') ? 'shared_startup' : pair.some(id => ['parallel_exploration', 'research'].includes(agents.get(id)!.purpose ?? '')) ? 'declared_parallel' : 'possible_overlap';
    let associated = 0n; let observed = false; const refs: string[] = []; const localUnion = new Set<string>();
    for (const call of selected) call.view.sharedGroupIds.push(id);
    const sampled = [...selected.filter(call => call.view.agentId === leftId).slice(0, 10), ...selected.filter(call => call.view.agentId === rightId).slice(0, 10)];
    for (const call of sampled) {
      refs.push(...call.view.evidenceRefs);
      if (call.first === null || call.last === null || call.generation === null || call.last < call.first) continue;
      for (const row of store.db.prepare(`SELECT p.entry FROM observations o CROSS JOIN ledger_links k ON k.observation_id=o.id AND k.relation='support'
        JOIN ledger_memberships l ON l.id=k.entry_id AND l.revision=k.revision JOIN scope_state r ON r.scope_id=l.scope_id AND r.active_revision=l.revision JOIN ledger_payloads p ON p.id=l.payload_id
        WHERE o.workspace_id=? AND o.source_id=? AND o.generation=? AND o.sequence BETWEEN ? AND ? AND ${ledgerFilter.sql.replaceAll('l.entry', 'p.entry')} AND l.thread_id=? AND l.status='selected'`).iterate(store.workspaceId, call.sourceId, call.generation, call.first, call.last, ...ledgerFilter.args, agents.get(call.view.agentId)!.threadId)) {
        const entry = JSON.parse(String(row.entry)) as LedgerEntry; if (entry.grain !== 'response' || localUnion.has(entry.id)) continue; localUnion.add(entry.id);
        if (entry.usage.total.value !== null) { associated += BigInt(entry.usage.total.value); observed = true; if (!usageUnion.has(entry.id)) { unionTotal += BigInt(entry.usage.total.value); unionKnown = true; } } usageUnion.add(entry.id);
      }
    }
    const timed = selected.filter(call => call.view.startedAt && call.view.completedAt && call.view.completedAt >= call.view.startedAt);
    const ranges = (agent: string) => { const merged: [number, number][] = []; for (const call of timed.filter(call => call.view.agentId === agent).sort((a, b) => a.view.startedAt!.localeCompare(b.view.startedAt!))) { const start = Date.parse(call.view.startedAt!); const end = Date.parse(call.view.completedAt!); const last = merged.at(-1); if (last && start <= last[1]) last[1] = Math.max(last[1], end); else merged.push([start, end]); } return merged; };
    let overlap: number | null = null;
    if (timed.length === selected.length) { overlap = 0; const a = ranges(leftId!); const b = ranges(rightId!); let i = 0; let j = 0; while (i < a.length && j < b.length) { overlap += Math.max(0, Math.min(a[i][1], b[j][1]) - Math.max(a[i][0], b[j][0])); if (a[i][1] <= b[j][1]) i++; else j++; } }
    shared.push({ id, agents: memberAgents.slice(0, 20), agentCount: memberAgents.length, invocations: selected.length, outputBytes: selected[0].output.outputBytes!, completeCapture: selected.every(call => call.output.captureComplete === true), commonTarget: targets.every(Boolean) ? new Set(targets).size === 1 : null, overlapMs: overlap, classification, evidenceRefs: [...new Set(refs)].slice(0, 40), associatedUsage: metric(observed ? associated.toString() : null, observed ? 'derived' : 'unknown', 'monitor_calculation', [...localUnion], ['Selected response membership inside up to 20 linked invocation ranges, counted once within this group. Association is not causal or avoidable usage; groups must not be added.']), avoidableUsage: metric(null, 'unknown', 'unknown'), annotation: store.annotation(id) as SharedOperationGroup['annotation'] });
  }
  if (value.focusGroupId && !shared.some(group => group.id === value.focusGroupId)) throw new Error('COMPARISON_GROUP_OUT_OF_SCOPE');
  const focus = value.focusGroupId ?? shared[0]?.id;
  const samples = (agentId: string | null) => { const all = [...invocations.values()].filter(call => call.view.agentId === agentId).map(call => call.view).sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? '') || a.id.localeCompare(b.id)); const anchor = Math.max(0, all.findIndex(call => focus && call.sharedGroupIds.includes(String(focus))) - 10); return all.slice(anchor, anchor + 50); };
  const handoffFilter = store.metadataFilter(query, 'o.timestamp', 'COALESCE(a.normalized,o.normalized)', 'context.');
  const handoffs = store.db.prepare(`SELECT o.timestamp,s.thread_id,o.evidence_ref FROM timeline_events e CROSS JOIN observations o ON o.id=e.observation_id JOIN sources s ON s.id=o.source_id LEFT JOIN source_analysis r ON r.source_id=o.source_id LEFT JOIN observation_analyses a ON a.observation_id=o.id AND a.revision=r.revision WHERE e.workspace_id=? AND e.kind='inter_agent_communication_metadata' AND ${handoffFilter.sql} ORDER BY e.sequence DESC LIMIT 20`).all(store.workspaceId, ...handoffFilter.args).map(row => ({ timestamp: row.timestamp === null ? null : String(row.timestamp), threadId: row.thread_id === null ? null : String(row.thread_id), evidenceRef: String(row.evidence_ref) }));
  return { revision: store.revision(), privacyVersion: privacyVersion(store), agents: allAgents, leftAgentId: leftId, rightAgentId: rightId, left: samples(leftId), right: samples(rightId), shared, associatedUnionUsage: metric(unionKnown ? unionTotal.toString() : null, unionKnown ? 'derived' : 'unknown', 'monitor_calculation', [...usageUnion], ['Each linked selected response contributes once across displayed groups. This is association, not avoidable or causal cost.']), mirroredInvocations: mirrored, conflictedInvocations: [...invocations.values()].filter(call => call.view.status === 'conflicted').length, limited: shared.length >= 50 || [leftId, rightId].some(id => id && agents.get(id)!.invocations > 50) || shared.some(group => group.invocations > 20 || group.agentCount > 20), handoffs,
    notes: ['Content buckets narrow comparisons before selecting two agents; no universal agent all-pairs pass.', 'Only same-machine agents with a shared identified ancestry are duplicate-work candidates. Cross-machine execution origin is unproven and statistics-only clients have no tool fingerprints.', 'Same-thread Call ID replicas collapse. Shared Call IDs across different threads are excluded as possible copied history; distinct recorded calls remain visible.', 'At least 256 captured output bytes are required. Partial capture is not proof of identical complete content. Target fingerprints describe captured expressions, not resolved file identity; worktree revision and assignment state may be unknown.', 'Purpose is user annotation or a stated inference from captured role metadata; common output is not an efficiency penalty. Avoidable usage requires a quality-preserving experiment.', 'Time overlap uses merged source intervals for the selected pair, not causal ordering. Tool lists show up to 50 records near the focused common operation, or the first retained calls without a match; Timeline retains full indexed history.', 'Handoff entries are local evidence pointers; their presence does not identify recipients or prove receipt. Absence of recorded handoff does not prove information was unavailable.'] };
}

export function annotateAgentComparison(store: InspectorStore, input: unknown): void {
  const value = object(input); if (!value || Object.keys(value).some(key => !['request', 'id', 'choice'].includes(key)) || typeof value.id !== 'string') throw new Error('INVALID_ANNOTATION');
  const view = agentComparison(store, value.request); const group = view.shared.find(group => group.id === value.id); if (!group) throw new Error('COMPARISON_NOT_RETAINED');
  const sources = sourceRows(store).filter(source => source.context.threadId && [view.leftAgentId, view.rightAgentId].includes(agentKey(store, source.machine, source.context.threadId)));
  store.db.exec('BEGIN IMMEDIATE');
  try { store.annotate(value.id, value.choice); for (const source of sources) store.setSetting(`comparison-annotation:${source.id}:${value.id}`, value.id); store.db.exec('COMMIT'); }
  catch (error) { store.db.exec('ROLLBACK'); throw error; }
}
