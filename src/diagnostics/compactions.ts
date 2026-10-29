import { digest, type NormalizedObservation } from '../accounting/codex-observations';
import { metric } from '../accounting/integers';
import { withinDates, type InspectorStore } from '../storage/InspectorStore';
import type { CompactionView, InspectorQuery, LedgerEntry } from '../shared/inspector';

export const COMPACTION_KINDS = ['compacted', 'event_msg/context_compacted', 'event_msg/item_started', 'event_msg/item_completed'];
interface Operation {
  view: CompactionView; scopeId: string; first: number; last: number; lastTimestamp: string | null;
  forms: Set<string>; confirmed: boolean;
}

/** Retained explicit markers only. Legacy aliases need a bounded, visible linkage. */
export function compactionOperations(store: InspectorStore, query: InspectorQuery): Operation[] {
  const filter = store.metadataFilter({ ...query, days: undefined, from: undefined, to: undefined }, 'o.timestamp', 'COALESCE(a.normalized,o.normalized)', 'context.');
  const rows = store.db.prepare(`SELECT o.id,o.source_id,o.generation,o.sequence,o.timestamp,o.evidence_ref,s.machine_id,COALESCE(a.normalized,o.normalized) AS normalized
    FROM timeline_events e CROSS JOIN observations o ON o.id=e.observation_id JOIN sources s ON s.id=o.source_id LEFT JOIN source_analysis r ON r.source_id=o.source_id
    LEFT JOIN observation_analyses a ON a.observation_id=o.id AND a.revision=r.revision
    WHERE e.workspace_id=? AND e.kind IN (${COMPACTION_KINDS.map(() => '?').join(',')}) AND ${filter.sql}
    AND (e.kind IN ('compacted','event_msg/context_compacted') OR instr(e.search_metadata,'codex-compaction/1')>0)
    ORDER BY o.source_id,o.generation,o.sequence`);
  const operations: Operation[] = []; const identified = new Map<string, Operation>(); const latest = new Map<string, Operation>();
  for (const row of rows.iterate(store.workspaceId, ...COMPACTION_KINDS, ...filter.args)) {
    const n = JSON.parse(String(row.normalized)) as NormalizedObservation;
    const marker = n.metadata.compaction ?? (n.kind === 'compacted' || n.kind === 'event_msg/context_compacted'
      ? { itemId: null, phase: 'marker' as const, form: n.kind } : null);
    if (!marker || !n.context.codex) continue;
    const sourceId = String(row.source_id); const machineId = String(row.machine_id); const generation = Number(row.generation);
    const at = row.timestamp === null ? null : String(row.timestamp); const sequence = Number(row.sequence); const ref = String(row.evidence_ref);
    const stream = JSON.stringify([sourceId, generation, n.context.threadId, n.context.turnId]);
    const identity = marker.itemId ? JSON.stringify([machineId, n.context.threadId ?? sourceId, marker.itemId]) : null;
    let operation = identity ? identified.get(identity) : undefined;
    const previous = latest.get(stream);
    const adjacent = !identity && previous?.confirmed && previous.last + 1 === sequence && !previous.forms.has(marker.form)
      && at !== null && previous.lastTimestamp !== null && Math.abs(Date.parse(at) - Date.parse(previous.lastTimestamp)) <= 1000;
    if (!operation && adjacent) { operation = previous; operation.view.deduplication = 'adjacent_alias'; }
    if (!operation) {
      const id = `compaction:${digest(JSON.stringify([store.workspaceId, identity ?? String(row.id)]))}`;
      const scopeId = `scope:${digest(JSON.stringify([store.workspaceId, machineId, n.context.providerRoute, n.context.threadId ?? sourceId]))}`;
      const view: CompactionView = { id, sourceId, machineId, threadId: n.context.threadId, generation, itemId: marker.itemId, timestamp: at,
        startedAt: null, completedAt: null, durationMs: null, intervalMs: null, trigger: 'unknown', state: 'started',
        contextEpoch: n.context.contextEpoch, evidenceRef: ref, evidenceRefs: [], markers: 0, deduplication: identity ? 'item_id' : 'standalone',
        overhead: metric(null, 'unknown', 'unknown', [], ['No distinct accounting scope identifies compaction usage; nearby usage is not overhead.']),
        before: null, after: null, inputChange: null, issues: [] };
      operation = { view, scopeId, first: sequence, last: sequence, lastTimestamp: at, forms: new Set(), confirmed: false };
      operations.push(operation); if (identity) identified.set(identity, operation);
    }
    const v = operation.view;
    v.markers++; if (v.evidenceRefs.length < 20) v.evidenceRefs.push(ref);
    operation.forms.add(marker.form);
    if (v.sourceId === sourceId && v.generation === generation) { operation.first = Math.min(operation.first, sequence); operation.last = Math.max(operation.last, sequence); }
    operation.lastTimestamp = at;
    if (marker.phase === 'started') v.startedAt ??= at;
    else {
      operation.confirmed = true; v.completedAt ??= at; v.timestamp = v.completedAt ?? at;
      v.state = marker.phase === 'completed' || v.state === 'completed' ? 'completed' : 'observed'; v.contextEpoch = n.context.contextEpoch;
    }
    if (v.startedAt && v.completedAt) {
      const duration = Date.parse(v.completedAt) - Date.parse(v.startedAt);
      if (duration >= 0) v.durationMs = duration; else if (!v.issues.includes('SOURCE_TIME_ORDER_UNKNOWN')) v.issues.push('SOURCE_TIME_ORDER_UNKNOWN');
    }
    latest.set(stream, operation);
  }
  const selected = operations.filter(operation => withinDates(operation.view.timestamp, query));
  const previous = new Map<string, string | null>();
  for (const operation of selected) {
    const v = operation.view; const stream = JSON.stringify([v.sourceId, v.generation]); const last = previous.get(stream);
    if (last && v.timestamp) { const interval = Date.parse(v.timestamp) - Date.parse(last); if (interval >= 0) v.intervalMs = interval; }
    previous.set(stream, v.timestamp);
    v.overhead.sourceRefs = [...v.evidenceRefs];
    if (v.deduplication === 'adjacent_alias') v.issues.push('LEGACY_ALIAS_LINK_DERIVED_NOT_OPERATION_ID');
    if (!v.itemId) v.issues.push('OPERATION_ID_UNAVAILABLE');
  }
  return selected;
}

function nearbyInput(store: InspectorStore, operation: Operation, query: InspectorQuery, direction: 'before' | 'after'): CompactionView['before'] {
  const filter = store.queryFilter(query, 'l'); const before = direction === 'before';
  const row = store.db.prepare(`SELECT p.entry FROM scope_state r CROSS JOIN ledger_memberships l ON l.scope_id=r.scope_id AND l.revision=r.active_revision
    JOIN ledger_payloads p ON p.id=l.payload_id
    WHERE r.scope_id=? AND ${filter.sql.replaceAll('l.entry', 'p.entry')} AND l.source_id=? AND l.source_generation=? AND l.status='selected'
    AND json_extract(p.entry,'$.grain')='response' AND l.sequence${before ? '<' : '>'}? ORDER BY l.sequence ${before ? 'DESC' : 'ASC'},l.id LIMIT 1`)
    .get(operation.scopeId, ...filter.args, operation.view.sourceId, operation.view.generation, before ? operation.first : operation.last);
  if (!row) return null;
  const entry = JSON.parse(String(row.entry)) as LedgerEntry;
  return { ledgerId: entry.id, timestamp: entry.endAt, model: entry.model.observedModel ?? entry.model.requestedModel,
    input: metric(entry.usage.input.value, entry.usage.input.value === null ? 'unknown' : 'derived', 'monitor_calculation', entry.evidenceRefs,
      ['Nearest selected response input in retained source order and current scope. This is a context-size proxy, not a captured context snapshot or compaction overhead.']) };
}

export function compactionDiagnostics(store: InspectorStore, query: InspectorQuery, operations: Operation[]) {
  const displayed = operations.slice(-200);
  for (const operation of displayed) {
    const view = operation.view;
    view.before = nearbyInput(store, operation, query, 'before');
    if (operation.confirmed) view.after = nearbyInput(store, operation, query, 'after');
    if (view.before?.input.value !== null && view.before?.input.value !== undefined && view.after?.input.value !== null && view.after?.input.value !== undefined)
      view.inputChange = (BigInt(view.after.input.value) - BigInt(view.before.input.value)).toString();
    if (!view.before || !view.after) view.issues.push('NEARBY_RESPONSE_INPUT_INCOMPLETE');
    if (view.before?.timestamp && view.startedAt && view.before.timestamp > view.startedAt || view.after?.timestamp && view.completedAt && view.after.timestamp < view.completedAt)
      view.issues.push('SOURCE_TIME_ORDER_UNKNOWN');
    if (view.before?.model !== view.after?.model && view.before && view.after) view.issues.push('NEARBY_MODEL_CHANGED');
  }
  return { compactions: displayed.map(operation => operation.view), compactionCount: operations.length,
    compactionCompleted: operations.filter(operation => operation.confirmed).length,
    compactionMarkers: operations.reduce((sum, operation) => sum + operation.view.markers, 0),
    compactionUnknownTimes: operations.filter(operation => operation.view.timestamp === null).length };
}
