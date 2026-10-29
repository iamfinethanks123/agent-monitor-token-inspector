import { InspectorStore } from '../storage/InspectorStore';
import { priceAnalytics } from '../accounting/prices';
import { analyze } from '../diagnostics/analyze';
import { integer } from '../accounting/integers';
import type { InspectorQuery, LedgerEntry, TrialResources } from '../shared/inspector';

export function trialResources(store: InspectorStore, query: InspectorQuery | null): TrialResources {
  if (!query) return { knownTokens: '0', uncachedInput: null, observedWindowMs: null, toolCalls: null, failedToolCalls: null, retryCandidates: null, compactionRecords: null,
    observedFrom: null, observedTo: null, requestedModels: [], projectIds: [], prices: [], unpricedEntries: 0, priceSnapshotIds: [], sourceIds: [], selectedEntries: 0, quarantinedEntries: 0, issues: ['NO_RUN_TELEMETRY'] };
  const summary = store.summary(query); const sources = store.sources(query); const filter = store.queryFilter(query, 'l');
  let known = 0n; let uncached = 0n; let cacheComplete = true; let timed = true; let first: number | null = null; let last: number | null = null;
  const issues = new Set<string>(); const models = new Set<string>(); const projects = new Set<string>();
  const observedModels = new Set<string>(); const providers = new Set<string | null>(); const serviceTiers = new Set<string | null>(); const agentIds = new Set<string>();
  for (const row of store.db.prepare(`SELECT l.entry FROM scope_state s CROSS JOIN ledger l ON s.scope_id=l.scope_id AND s.active_revision=l.revision WHERE ${filter.sql} AND l.status='selected'`).iterate(...filter.args)) {
    const entry = JSON.parse(String(row.entry)) as LedgerEntry;
    if (entry.model.observedModel ?? entry.model.requestedModel) observedModels.add((entry.model.observedModel ?? entry.model.requestedModel)!); providers.add(entry.model.providerRoute); serviceTiers.add(entry.model.serviceTier); if (entry.identity.threadId) agentIds.add(entry.identity.threadId);
    if (entry.model.requestedModel) models.add(entry.model.requestedModel); if (entry.identity.projectId) projects.add(entry.identity.projectId);
    if (entry.usage.total.value !== null) known += BigInt(entry.usage.total.value); else issues.add('MISSING_FINAL_USAGE');
    const input = entry.usage.input.value; const cached = entry.usage.cachedInput.value;
    if (input === null || cached === null) cacheComplete = false; else uncached += BigInt(input) - BigInt(cached);
    if (!entry.startAt || !entry.endAt) timed = false;
    else { const start = Date.parse(entry.startAt); const end = Date.parse(entry.endAt); first = first === null ? start : Math.min(first, start); last = last === null ? end : Math.max(last, end); }
  }
  if (!summary.selectedEntries) issues.add('NO_SELECTED_USAGE');
  if (summary.quarantinedEntries) issues.add('ACCOUNTING_CONFLICTS');
  if (sources.some(source => source.issues.length || ['partial', 'failed', 'unsupported', 'catching_up'].includes(source.state))) issues.add('SOURCE_COVERAGE_GAPS');
  const sourceFilter = store.queryFilter(query, 's');
  const calls = store.db.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN t.output_observation IS NOT NULL AND (json_extract(t.output_metadata,'$.status')='error' OR json_extract(t.output_metadata,'$.exitCode')<>'0') THEN 1 ELSE 0 END) failed
    FROM tool_index t JOIN sources s ON s.id=t.source_id WHERE ${sourceFilter.sql}`).get(...sourceFilter.args)!;
  const eventFilter = store.metadataFilter(query, 'o.timestamp', 'COALESCE(a.normalized,o.normalized)', 'context.');
  const compactions = store.db.prepare(`SELECT COUNT(*) n FROM observations o JOIN sources s ON s.id=o.source_id
    LEFT JOIN source_analysis r ON r.source_id=o.source_id LEFT JOIN observation_analyses a ON a.observation_id=o.id AND a.revision=r.revision
    WHERE ${eventFilter.sql} AND o.kind='compacted'`).get(...eventFilter.args)!;
  const diagnostics = analyze(store, query); const prices = priceAnalytics(store, query, 'historical');
  if (diagnostics.findings.length >= 200) issues.add('DIAGNOSTIC_LIMIT');
  const lifecycleAvailable = sources.every(source => !source.capabilities.includes('statistics-only-v2'));
  if (!lifecycleAvailable) issues.add('REMOTE_LIFECYCLE_UNAVAILABLE');
  const intervals: { start: number; end: number }[] = []; let indexedCalls = 0; let missingCalls = 0; let invalidCalls = 0;
  for (const row of store.db.prepare(`SELECT t.started_at,t.completed_at FROM tool_index t JOIN sources s ON s.id=t.source_id WHERE ${sourceFilter.sql}`).iterate(...sourceFilter.args)) {
    indexedCalls++;
    if (row.started_at === null || row.completed_at === null) { missingCalls++; continue; }
    const start = Date.parse(String(row.started_at)); const end = Date.parse(String(row.completed_at));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) { invalidCalls++; continue; }
    intervals.push({ start, end });
  }
  intervals.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : a.end < b.end ? -1 : a.end > b.end ? 1 : 0);
  let union = 0n; let current: { start: number; end: number } | undefined;
  for (const interval of intervals) {
    if (!current) current = { ...interval };
    else if (interval.start <= current.end) current.end = Math.max(current.end, interval.end);
    else { union += BigInt(current.end) - BigInt(current.start); current = { ...interval }; }
  }
  if (current) union += BigInt(current.end) - BigInt(current.start);
  const singleMachine = new Set(sources.map(source => source.machineId)).size === 1;
  const toolIntervals = { knownUnionMs: singleMachine && lifecycleAvailable ? integer(union) : null, indexedCalls, timedCalls: intervals.length, missingCalls, invalidCalls,
    clockScope: singleMachine ? 'single_machine' as const : 'unverified' as const, recordedComplete: singleMachine && lifecycleAvailable && !missingCalls && !invalidCalls };
  return { knownTokens: integer(known), uncachedInput: cacheComplete && summary.selectedEntries ? integer(uncached) : null,
    observedFrom: timed && first !== null ? new Date(first).toISOString() : null, observedTo: timed && last !== null ? new Date(last).toISOString() : null,
    requestedModels: [...models], projectIds: [...projects], observedModels: [...observedModels], providers: [...providers], serviceTiers: [...serviceTiers], agentIds: [...agentIds],
    observedWindowMs: timed && first !== null && last !== null ? integer(BigInt(Math.max(0, last - first))) : null,
    toolCalls: lifecycleAvailable ? Number(calls.total) : null, failedToolCalls: lifecycleAvailable ? Number(calls.failed ?? 0) : null,
    retryCandidates: lifecycleAvailable && diagnostics.findings.length < 200 ? diagnostics.findings.filter(finding => finding.detectorId === 'retry-recurrence').length : null,
    compactionRecords: lifecycleAvailable ? Number(compactions.n) : null, compactionOperations: lifecycleAvailable ? diagnostics.compactionCompleted : null,
    prices: prices.currencies.map(({ currency, amount }) => ({ currency, amount })), unpricedEntries: prices.unpricedEntries, priceSnapshotIds: prices.snapshotIds,
    toolIntervals, sourceIds: sources.map(source => source.id), selectedEntries: summary.selectedEntries, quarantinedEntries: summary.quarantinedEntries, issues: [...issues] };
}
