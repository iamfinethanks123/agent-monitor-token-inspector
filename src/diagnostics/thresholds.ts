import { InspectorStore, withinDates } from '../storage/InspectorStore';
import type { compactionOperations } from './compactions';
import { digest } from '../accounting/codex-observations';
import { metric } from '../accounting/integers';
import type { FindingView, InspectorQuery } from '../shared/inspector';

export function thresholdFindings(store: InspectorStore, query: InspectorQuery, operations: ReturnType<typeof compactionOperations>): FindingView[] {
  const filter = store.metadataFilter({ ...query, days: undefined, from: undefined, to: undefined }, 'o.timestamp', 'COALESCE(a.normalized,o.normalized)', 'context.'); const results: FindingView[] = [];
  const groups = new Map<string, { source: string; kind: string; count: number; refs: string[]; last: string | null; start: number | null }>();
  const gaps = store.db.prepare(`SELECT o.source_id,e.kind,o.timestamp,o.received_at,o.evidence_ref FROM timeline_events e CROSS JOIN observations o ON o.id=e.observation_id JOIN sources s ON s.id=o.source_id
    LEFT JOIN source_analysis v ON v.source_id=o.source_id LEFT JOIN observation_analyses a ON a.observation_id=o.id AND a.revision=v.revision
    WHERE e.workspace_id=? AND e.kind GLOB 'gap/*' AND ${filter.sql} ORDER BY o.source_id,o.sequence`).iterate(store.workspaceId, ...filter.args);
  function* events() {
    yield* gaps;
    for (const operation of operations) if (operation.confirmed) yield { source_id: operation.view.sourceId, kind: 'compacted', timestamp: operation.view.timestamp, received_at: null, evidence_ref: operation.view.evidenceRefs.at(-1) ?? operation.view.evidenceRef };
  }
  for (const row of events()) {
    const kind = row.kind === 'compacted' ? 'compaction-burst' : 'collector-gap';
    const timestamp = kind === 'collector-gap' ? String(row.received_at) : row.timestamp === null ? null : String(row.timestamp);
    if (!withinDates(timestamp, query)) continue;
    const source = String(row.source_id); const key = `${source}:${kind}`; const previous = groups.get(key);
    const at = timestamp ? Date.parse(timestamp) : null;
    const group = !previous || kind === 'compaction-burst' && (at === null || previous.start === null || at < previous.start || at - previous.start > 300000)
      ? { source, kind, count: 0, refs: [], last: timestamp, start: at } : previous;
    group.count++; group.last = timestamp; if (group.refs.length < 19) group.refs.push(String(row.evidence_ref));
    const refs = [...new Set([...group.refs, String(row.evidence_ref)])]; groups.set(key, group);
    if (kind === 'compaction-burst' && group.count < 3) continue;
    const id = `finding:${digest(`${store.workspaceId}:${key}/1`)}`;
    const finding: FindingView = { id, detectorId: kind, detectorVersion: kind === 'collector-gap' ? '1' : '2', title: kind === 'collector-gap' ? 'Indexed collector gaps / 已記錄收集缺口' : 'Explicit compaction burst / 明確 Context 壓縮密集出現', confidence: 'medium', severity: 'warning',
      observedFacts: [kind === 'collector-gap' ? `${group.count} malformed/oversized record gaps are indexed. Their event time is unavailable; alert freshness uses monitor receipt time.` : `${group.count} explicit compaction operation groups occur in a bounded five-minute source window. Item IDs deduplicate lifecycle notifications; adjacent legacy aliases use a stated source-order inference.`],
      hypotheses: [kind === 'collector-gap' ? 'Coverage may omit usage or tool details.' : 'The current task may repeatedly exceed its available context.'],
      alternativeExplanations: [kind === 'collector-gap' ? 'Unsupported or interrupted writes may explain the missing record; later valid records remain eligible.' : 'Necessary long-running work can require compaction; these records do not identify separate compaction token cost.'],
      evidenceRefs: refs, latestEvidenceRef: String(row.evidence_ref), lastObservedAt: timestamp, occurrences: group.count, associatedLedgerEntryIds: [], associatedUsage: metric(null, 'unknown', 'unknown'), duplicatePayloadEstimate: metric(null, 'unknown', 'unknown'), avoidableTokens: metric(null, 'unknown', 'unknown'),
      recommendations: [kind === 'collector-gap' ? 'Inspect the exact gap evidence and adapter support before interpreting complete coverage.' : 'Compare a bounded task decomposition while keeping acceptance and required evidence unchanged.'], qualityRisk: 'Removing required context or verification can hide correctness issues.', validation: 'Use the same acceptance task and compare recorded coverage; restore the prior approach if quality falls.', suppressionReasons: [], annotation: store.annotation(id) as FindingView['annotation'] };
    const index = results.findIndex(item => item.id === id); if (index >= 0) results[index] = finding; else if (results.length < 200) results.push(finding);
  }
  return results;
}
