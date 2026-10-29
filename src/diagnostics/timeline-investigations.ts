import { analyze } from './analyze';
import { validateQuery, type InspectorStore } from '../storage/InspectorStore';
import { privacyVersion } from '../storage/project-privacy';
import type { InvestigationMarker, TimelineInvestigations } from '../shared/inspector';

/** Current derived analysis is separate from immutable raw-event paging snapshots. */
export function timelineInvestigations(store: InspectorStore, input: unknown = {}): TimelineInvestigations {
  const query = validateQuery(input); const diagnostics = analyze(store, query); const markers: InvestigationMarker[] = [];
  const filter = store.metadataFilter(query, 'o.timestamp', 'COALESCE(a.normalized,o.normalized)', 'context.');
  const anchor = store.db.prepare(`SELECT o.id,o.source_id,o.timestamp,o.evidence_ref,s.machine_id,COALESCE(json_extract(a.normalized,'$.context.threadId'),json_extract(o.normalized,'$.context.threadId')) AS thread_id
    FROM observations o JOIN sources s ON s.id=o.source_id LEFT JOIN source_analysis r ON r.source_id=o.source_id LEFT JOIN observation_analyses a ON a.observation_id=o.id AND a.revision=r.revision
    WHERE o.evidence_ref=? AND ${filter.sql}`);
  const add = (id: string, kind: InvestigationMarker['kind'], title: string, refs: string[], extra: Partial<InvestigationMarker> = {}) => {
    for (const ref of [...new Set(refs)].reverse()) {
      const row = anchor.get(ref, ...filter.args); if (!row) continue;
      const timestamp = row.timestamp === null ? null : String(row.timestamp);
      markers.push({ id, kind, title, timestamp, timeBasis: timestamp ? 'source' : 'unknown', sourceId: String(row.source_id), machineId: String(row.machine_id), threadId: row.thread_id === null ? null : String(row.thread_id), evidenceRef: ref, ...extra }); break;
    }
  };
  for (const finding of diagnostics.findings) add(finding.id, 'finding', finding.title, [...finding.evidenceRefs, ...(finding.latestEvidenceRef ? [finding.latestEvidenceRef] : [])], { findingId: finding.id, state: finding.annotation ?? 'unreviewed' });
  for (const compaction of diagnostics.compactions) add(compaction.id, 'compaction', 'Context compaction / Context 壓縮', compaction.evidenceRefs, { state: compaction.state });
  for (const episode of diagnostics.retries.episodes) add(episode.id, 'retry', 'Retry and diagnostic progress / 重試與診斷進度', episode.evidenceRefs, { state: episode.status });
  const gaps = store.db.prepare(`SELECT o.id,o.evidence_ref FROM timeline_events e CROSS JOIN observations o ON o.id=e.observation_id JOIN sources s ON s.id=o.source_id
    LEFT JOIN source_analysis r ON r.source_id=o.source_id LEFT JOIN observation_analyses a ON a.observation_id=o.id AND a.revision=r.revision
    WHERE e.workspace_id=? AND e.kind LIKE 'gap/%' AND ${filter.sql} ORDER BY e.sequence DESC LIMIT 201`).all(store.workspaceId, ...filter.args);
  for (const gap of gaps.slice(0, 200)) add(`gap:${String(gap.id)}`, 'gap', 'Captured source gap / 已記錄來源缺口', [String(gap.evidence_ref)]);
  markers.sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? '') || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  return { revision: store.revision(), privacyVersion: privacyVersion(store), computedAt: new Date().toISOString(), markers,
    limited: diagnostics.findings.length >= 200 || diagnostics.compactionCount > diagnostics.compactions.length || diagnostics.retries.totalEpisodes > diagnostics.retries.episodes.length || gaps.length > 200,
    notes: ['These are current derived analysis markers, not the raw timeline snapshot. Live updates can change them while source paging stays pinned.', 'Marker placement uses a retained source evidence timestamp. Unknown event time remains in a separate lane; monitor receipt/discovery time is not substituted.', 'One representative retained scope-matching evidence anchor is shown per finding/compaction/retry. Marker count is not event count or summed usage.', 'Per-type analysis limits are explicit. Open full source history or finding evidence to inspect all retained records.', 'Error categorization in the source timeline uses recorded kinds and indexed exit/status flags; older indexes may require explicit reanalysis. Unknown/unclassified source records remain available in All.'] };
}
