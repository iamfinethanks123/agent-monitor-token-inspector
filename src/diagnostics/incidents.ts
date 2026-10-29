import { InspectorStore, validateQuery, withinDates, type SourceCursor } from '../storage/InspectorStore';
import { digest, object } from '../accounting/codex-observations';
import { analyze } from './analyze';
import { evaluateBudgets } from './budgets';
import type { AlertSuppression, FindingView, IncidentRecord, IncidentView, InspectorQuery } from '../shared/inspector';

const cooldown = 300000; const warmup = 30000; const recent = 600000;
const detectors = ['repeated-read', 'retry-recurrence', 'large-output', 'compaction-burst', 'collector-gap'];
const analysisContinuation = new WeakMap<InspectorStore, string>();
function suppressed(store: InspectorStore, detectorId: string, sourceId: string, now: number): boolean {
  return suppressions(store).some(rule => rule.detectorId === detectorId && (!rule.expiresAt || Date.parse(rule.expiresAt) > now) && store.sources(rule.query).some(source => source.id === sourceId));
}
function suppressions(store: InspectorStore): AlertSuppression[] { return store.db.prepare('SELECT record FROM alert_suppressions WHERE workspace_id=? ORDER BY id LIMIT 200').all(store.workspaceId).map(row => JSON.parse(String(row.record))); }
export function suppressAlerts(store: InspectorStore, input: unknown): void {
  const value = object(input); if (!value || Object.keys(value).some(key => !['query', 'detectorId', 'hours'].includes(key)) || !detectors.includes(String(value.detectorId)) || !Number.isInteger(value.hours) || Number(value.hours) < 0 || Number(value.hours) > 720) throw new Error('INVALID_SUPPRESSION');
  const query = validateQuery(value.query); delete query.cursor; delete query.limit; delete query.includeQuarantined;
  if (!query.runId && !query.agentId && !query.projectId) throw new Error('SUPPRESSION_SCOPE_REQUIRED');
  const now = Date.now(); const id = `suppression:${digest(JSON.stringify([query, value.detectorId]))}`;
  if (!store.db.prepare('SELECT 1 FROM alert_suppressions WHERE id=? AND workspace_id=?').get(id, store.workspaceId) && Number(store.db.prepare('SELECT COUNT(*) n FROM alert_suppressions WHERE workspace_id=?').get(store.workspaceId)!.n) >= 200) throw new Error('SUPPRESSION_LIMIT');
  const record: AlertSuppression = { id, query, detectorId: String(value.detectorId), createdAt: new Date(now).toISOString(), expiresAt: value.hours ? new Date(now + Number(value.hours) * 3600000).toISOString() : null };
  store.db.prepare('INSERT INTO alert_suppressions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(id, store.workspaceId, JSON.stringify(record)); store.audit('alerts.suppress', id);
}
export function removeSuppression(store: InspectorStore, id: unknown): void {
  if (typeof id !== 'string' || !/^suppression:[a-f0-9]{64}$/.test(id)) throw new Error('INVALID_SUPPRESSION');
  store.db.prepare('DELETE FROM alert_suppressions WHERE id=? AND workspace_id=?').run(id, store.workspaceId); store.audit('alerts.unsuppress', id);
}

function notificationAllowed(store: InspectorStore, incident: IncidentRecord, now: number): boolean {
  const annotation = store.annotation(incident.id);
  return !incident.historical && !incident.suppressionReasons.length && !['intentional', 'not_relevant', 'incorrect', 'resolved'].includes(annotation ?? '')
    && !suppressed(store, incident.detectorId, incident.sourceId, now) && !!incident.lastObservedAt && now - Date.parse(incident.lastObservedAt) >= 0 && now - Date.parse(incident.lastObservedAt) <= recent
    && (!incident.lastNotifiedAt || now - Date.parse(incident.lastNotifiedAt) >= cooldown);
}
function notify(store: InspectorStore, incident: IncidentRecord, now: number): void {
  incident.updates++; incident.lastNotifiedAt = new Date(now).toISOString(); store.audit('incident.alert', incident.id);
}
function persist(store: InspectorStore, finding: FindingView, cursor: SourceCursor, live: boolean, now: number, ready: boolean): void {
  const saved = store.db.prepare('SELECT record FROM incidents WHERE workspace_id=? AND id=?').get(store.workspaceId, finding.id);
  const previous = saved ? JSON.parse(String(saved.record)) as IncidentRecord : null;
  const refs = [...new Set([...finding.evidenceRefs, ...(finding.latestEvidenceRef ? [finding.latestEvidenceRef] : [])])];
  const fingerprint = digest(JSON.stringify([finding.occurrences, refs, finding.lastObservedAt, finding.suppressionReasons]));
  if (previous && digest(JSON.stringify([previous.occurrences, previous.evidenceRefs, previous.lastObservedAt, previous.suppressionReasons])) === fingerprint) return;
  const record: IncidentRecord = { id: finding.id, sourceId: cursor.id, query: { agentId: cursor.context.threadId ?? undefined, machineId: cursor.machineId }, detectorId: finding.detectorId,
    title: finding.title, occurrences: finding.occurrences ?? 1, firstSeenAt: previous?.firstSeenAt ?? new Date(now).toISOString(), lastSeenAt: new Date(now).toISOString(), lastObservedAt: finding.lastObservedAt ?? null,
    revision: (previous?.revision ?? 0) + 1, updates: previous?.updates ?? 0, lastNotifiedAt: previous?.lastNotifiedAt ?? null, historical: previous?.historical === false || live ? false : true,
    suppressionReasons: finding.suppressionReasons, dataIssues: cursor.issues, evidenceRefs: refs.slice(0, 41), annotation: finding.annotation };
  if (live && ready && notificationAllowed(store, record, now)) notify(store, record, now);
  store.db.prepare('INSERT INTO incidents VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_id=excluded.source_id,record=excluded.record').run(record.id, store.workspaceId, cursor.id, JSON.stringify(record));
}

/** Persist findings requested by a user without treating a retrospective read as a live alert. */
export function recordFindings(store: InspectorStore, findings: FindingView[], now = Date.now()): void {
  for (const finding of findings) {
    const pointer = store.evidencePointer(finding.latestEvidenceRef ?? finding.evidenceRefs[0]);
    if (pointer) persist(store, finding, pointer.cursor, false, now, false);
  }
}

export function incidents(store: InspectorStore, input: unknown = {}): IncidentView {
  const query = validateQuery(input); const scope = new Map(store.sources(query).map(source => [source.id, source])); const items: IncidentRecord[] = [];
  for (const row of store.db.prepare("SELECT record FROM incidents WHERE workspace_id=? ORDER BY json_extract(record,'$.lastObservedAt') DESC,json_extract(record,'$.lastSeenAt') DESC,id").iterate(store.workspaceId)) {
    const incident = JSON.parse(String(row.record)) as IncidentRecord; const source = scope.get(incident.sourceId); if (!source) continue;
    incident.dataIssues = [...source.issues, ...(source.state !== 'current' ? [`SOURCE_${source.state.toUpperCase()}`] : []), ...(!incident.lastObservedAt || Date.now() - Date.parse(incident.lastObservedAt) > recent ? ['EVIDENCE_STALE_OR_UNTIMED'] : [])];
    if (!withinDates(incident.lastObservedAt, query)) continue;
    if (query.requestedModel || query.attributedModel || query.projectId || query.provider !== undefined || query.serviceTier !== undefined) {
      const filter = store.metadataFilter({ ...query, days: undefined, from: undefined, to: undefined }, 'o.timestamp', 'COALESCE(a.normalized,o.normalized)', 'context.');
      if (!incident.evidenceRefs.length || !store.db.prepare(`SELECT 1 FROM observations o JOIN sources s ON s.id=o.source_id LEFT JOIN source_analysis v ON v.source_id=o.source_id LEFT JOIN observation_analyses a ON a.observation_id=o.id AND a.revision=v.revision WHERE ${filter.sql} AND o.evidence_ref IN (${incident.evidenceRefs.map(() => '?').join(',')}) LIMIT 1`).get(...filter.args, ...incident.evidenceRefs)) continue;
    }
    incident.annotation = store.annotation(incident.id) as FindingView['annotation']; items.push(incident); if (items.length >= 200) break;
  }
  return { items, suppressions: suppressions(store), notes: ['Advisory in-app alerts only; no Codex actions or OS notifications.', 'Explicit thresholds only; no statistical cohort or quota-exhaustion prediction.', '30-second source warm-up, ten-minute recent-evidence window and five-minute update cooldown. Historical imports do not notify.', 'Up to 200 incident records are shown; annotations and scoped suppressions do not change raw evidence or token totals.'] };
}

/** Durable per-source watermarks distinguish new appends from first imports and generations. */
export function checkAlerts(store: InspectorStore, now = Date.now(), baseline = false): void {
  const sources = store.sources(); const next = sources.findIndex(source => source.id === analysisContinuation.get(store)) + 1;
  const ordered = [...sources.slice(next), ...sources.slice(0, next)]; let lastAnalyzed: string | undefined;
  store.db.exec('BEGIN IMMEDIATE');
  try {
  const changed = new Set<string>(); const live = new Set<string>(); let analyzed = 0;
  for (const source of ordered) {
    const cursor = store.getSource(source.id)!;
    const checkpoint = store.db.prepare('SELECT * FROM alert_checkpoints WHERE source_id=?').get(cursor.id);
    const issues = JSON.stringify(cursor.issues);
    if (!baseline && checkpoint && Number(checkpoint.generation) === cursor.generation && Number(checkpoint.line) === cursor.line && String(checkpoint.issues) === issues) continue;
    // Return to the worker event loop after one full analysis; retain other checkpoints for the next scan.
    if (checkpoint && analyzed >= 1) continue;
    changed.add(cursor.id);
    const fresh = checkpoint && Number(checkpoint.generation) === cursor.generation ? store.db.prepare('SELECT evidence_ref,timestamp,kind,received_at FROM observations WHERE source_id=? AND generation=? AND line>? ORDER BY line DESC LIMIT 1').get(cursor.id, cursor.generation, Number(checkpoint.line)) : null;
    const at = fresh?.timestamp ?? (String(fresh?.kind).startsWith('gap/') ? fresh?.received_at : null);
    const recentAppend = !baseline && !!at && now - Date.parse(String(at)) >= 0 && now - Date.parse(String(at)) <= recent;
    const historicalUsage = checkpoint && store.db.prepare(`SELECT 1 FROM observations o JOIN usage_observations u ON u.observation_id=o.id
      WHERE o.source_id=? AND o.generation=? AND o.line>? AND (o.timestamp IS NULL OR o.timestamp<? OR o.timestamp>?) LIMIT 1`).get(cursor.id, cursor.generation, Number(checkpoint.line), new Date(now - recent).toISOString(), new Date(now).toISOString());
    if (recentAppend && !historicalUsage) live.add(cursor.id);
    const changedTools = checkpoint && store.db.prepare("SELECT 1 FROM observations WHERE source_id=? AND generation=? AND line>? AND (kind LIKE 'response_item/%call%' OR kind IN ('compacted','event_msg/context_compacted','event_msg/item_started','event_msg/item_completed') OR kind LIKE 'gap/%') LIMIT 1").get(cursor.id, cursor.generation, Number(checkpoint.line));
    if (!baseline && checkpoint && changedTools && cursor.context.threadId) {
      const findings = analyze(store, { agentId: cursor.context.threadId, machineId: cursor.machineId }).findings;
      const ready = now - Date.parse(String(checkpoint.started_at)) >= warmup;
      for (const finding of findings) {
        const pointer = store.evidencePointer(finding.latestEvidenceRef ?? finding.evidenceRefs[0]);
        if (pointer?.cursor.id === cursor.id) persist(store, finding, cursor, recentAppend && pointer.row.generation === Number(checkpoint.generation) && pointer.row.line > Number(checkpoint.line), now, ready);
      }
      analyzed++; lastAnalyzed = cursor.id;
    }
    store.db.prepare('INSERT INTO alert_checkpoints VALUES(?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET generation=excluded.generation,line=excluded.line,issues=excluded.issues,started_at=excluded.started_at').run(cursor.id, cursor.generation, cursor.line, issues,
      !baseline && checkpoint && Number(checkpoint.generation) === cursor.generation ? String(checkpoint.started_at) : new Date(now).toISOString());
  }
  evaluateBudgets(store, live, changed, now);
  if (baseline) store.db.prepare("UPDATE incidents SET record=json_set(record,'$.historical',json('true')) WHERE workspace_id=? AND json_extract(record,'$.updates')=0").run(store.workspaceId);
  for (const row of store.db.prepare('SELECT record FROM incidents WHERE workspace_id=?').iterate(store.workspaceId)) {
    const incident = JSON.parse(String(row.record)) as IncidentRecord;
    if (baseline || incident.lastNotifiedAt || now - Date.parse(incident.firstSeenAt) < warmup || !notificationAllowed(store, incident, now)) continue;
    notify(store, incident, now); store.db.prepare('UPDATE incidents SET record=? WHERE id=?').run(JSON.stringify(incident), incident.id);
  }
  store.db.exec('COMMIT');
  if (lastAnalyzed) analysisContinuation.set(store, lastAnalyzed);
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
}
