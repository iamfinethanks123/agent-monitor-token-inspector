import { InspectorStore, validateQuery } from './InspectorStore';
import { metric } from '../accounting/integers';
import type { QuotaMeasurement, QuotaSnapshot, QuotaView } from '../shared/inspector';
import type { SQLInputValue } from 'node:sqlite';

type Row = Record<string, SQLInputValue>;
const cached = new WeakMap<InspectorStore, { scope: string; count: number; watermark: number; rows: Row[]; value: QuotaView }>();

export function quotas(store: InspectorStore, value: unknown = {}): QuotaView {
  const query = validateQuery(value); const filter = store.metadataFilter(query, 'o.timestamp', 'COALESCE(a.normalized,o.normalized)', 'context.');
  const version = store.db.prepare("SELECT COUNT(*) AS count,MAX(sequence) AS watermark FROM timeline_events WHERE workspace_id=? AND kind='event_msg/token_count'").get(store.workspaceId)!;
  const count = Number(version.count); const watermark = Number(version.watermark ?? 0);
  const scope = JSON.stringify([filter.sql, filter.args, store.db.prepare("SELECT s.id,s.machine_id,s.thread_id,s.parent_thread_id,json_extract(s.cursor,'$.generation') AS generation,v.revision FROM sources s LEFT JOIN source_analysis v ON v.source_id=s.id WHERE s.workspace_id=? ORDER BY s.id").all(store.workspaceId)]);
  const previous = cached.get(store);
  if (previous?.scope === scope && previous.count === count && previous.watermark === watermark) return structuredClone(previous.value);
  const appended = previous?.scope === scope && watermark > previous.watermark && count >= previous.count
    ? Number(store.db.prepare("SELECT COUNT(*) AS count FROM timeline_events WHERE workspace_id=? AND kind='event_msg/token_count' AND sequence>?").get(store.workspaceId, previous.watermark)!.count) : -1;
  const incremental = !!previous && previous.scope === scope && appended >= 0 && count === previous.count + appended;
  const fields = `SELECT o.id,o.source_id,s.machine_id,o.timestamp,o.evidence_ref,o.rowid,
    json_extract(COALESCE(a.normalized,o.normalized),'$.metadata.quota') AS quota FROM timeline_events e INDEXED BY timeline_kind_order
    CROSS JOIN observations o ON o.id=e.observation_id CROSS JOIN sources s ON s.id=o.source_id
    LEFT JOIN source_analysis v ON v.source_id=o.source_id LEFT JOIN observation_analyses a ON a.observation_id=o.id AND a.revision=v.revision
    WHERE e.workspace_id=? AND e.kind='event_msg/token_count' AND ${incremental ? 'e.sequence>? AND ' : ''}${filter.sql} AND o.kind='event_msg/token_count' AND json_type(COALESCE(a.normalized,o.normalized),'$.metadata.quota')='object'`;
  const args = [store.workspaceId, ...(incremental ? [previous!.watermark] : []), ...filter.args];
  const decode = (row: Record<string, unknown>): QuotaSnapshot => ({ ...JSON.parse(String(row.quota)) as QuotaMeasurement,
    id: String(row.id), sourceId: String(row.source_id), machineId: String(row.machine_id), measuredAt: row.timestamp === null ? null : String(row.timestamp), evidenceRef: String(row.evidence_ref), accountIdentity: 'unverified' });
  // The union of 200 history rows and 200 snapshots has at most 400 rows.
  const incoming = store.db.prepare(`WITH candidates AS MATERIALIZED (${fields}), ranked AS (
    SELECT *,ROW_NUMBER() OVER(PARTITION BY source_id,json_extract(quota,'$.limitId') ORDER BY timestamp DESC,rowid DESC) AS source_rank,
      ROW_NUMBER() OVER(ORDER BY timestamp DESC,rowid DESC) AS history_rank FROM candidates)
    SELECT * FROM ranked WHERE source_rank=1 OR history_rank<=200 ORDER BY timestamp DESC,rowid DESC LIMIT 400`).all(...args);
  const rows = [...new Map([...(incremental ? previous!.rows : []), ...incoming].map(row => [String(row.id), row])).values()].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp === null ? 1 : b.timestamp === null ? -1 : String(a.timestamp) < String(b.timestamp) ? 1 : -1;
    return BigInt(String(a.rowid)) > BigInt(String(b.rowid)) ? -1 : BigInt(String(a.rowid)) < BigInt(String(b.rowid)) ? 1 : 0;
  });
  const historyRows = rows.slice(0, 200); const snapshotRows: Row[] = []; const seen = new Set<string>();
  for (const row of rows) {
    const key = JSON.stringify([row.source_id, (JSON.parse(String(row.quota)) as QuotaMeasurement).limitId]);
    if (!seen.has(key)) { seen.add(key); snapshotRows.push(row); if (snapshotRows.length === 200) break; }
  }
  const snapshots = snapshotRows.map(decode); const history = historyRows.map(decode);
  const result: QuotaView = { mode: 'passive', state: snapshots.length ? 'available' : 'unavailable', snapshots, history, liveConnection: 'disabled',
    accountTotal: metric(null, 'unknown', 'unknown', [], ['Passive quota percentages do not provide an account token aggregate.']),
    reconciliationGap: metric(null, 'unknown', 'unknown', [], ['Account identity, time scope and coverage must be established before reconciling local usage.']),
    notes: ['Snapshots are provider quota observations from authorized local records, at their recorded time; they are not live account state.',
      'Account identity is unverified. Different sessions or devices are not assumed to belong to one account; quota snapshots are never summed.',
      'Window durations and resets are source-defined. Percentages are not converted to invented token allowances.',
      'Only usage statistics are synchronized by collectors; account quota, credit balances and credentials stay outside that payload.',
      'Live account integration is disabled; authentication stores are not inspected or duplicated.',
      ...(snapshots.length ? [] : ['No supported passive quota fields have been indexed. New records or a successful reparse can supply them.'])] };
  const retained = [...new Map([...historyRows, ...snapshotRows].map(row => [String(row.id), row])).values()];
  cached.set(store, { scope, count, watermark, rows: retained, value: structuredClone(result) }); return result;
}
