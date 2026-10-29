import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { InspectorStore } from './InspectorStore';
import { validateQuery, dateFilter } from './InspectorStore';
import { digest, object, type NormalizedObservation } from '../accounting/codex-observations';
import { redactText } from '../reporting/privacy';
import type { ContentExcerpt, ContentSearchPage } from '../shared/inspector';
import { projectPolicy } from './project-privacy';

export const CONTENT_LIMITS = { excerptBytes: 8192, projectBytes: 8 * 1024 * 1024, workspaceBytes: 64 * 1024 * 1024, workspaceRecords: 20000 } as const;
export function createContentTable(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS local_content(sequence INTEGER PRIMARY KEY AUTOINCREMENT,observation_id TEXT NOT NULL UNIQUE REFERENCES observations(id) ON DELETE CASCADE,workspace_id TEXT NOT NULL,project_id TEXT NOT NULL,received_at TEXT NOT NULL,expires_at TEXT NOT NULL,excerpt TEXT NOT NULL,bytes INTEGER NOT NULL,truncated INTEGER NOT NULL,redaction_policy TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS local_content_project ON local_content(workspace_id,project_id,sequence);
    CREATE INDEX IF NOT EXISTS local_content_expiry ON local_content(workspace_id,expires_at);`);
}

/** Only recognized visible text fields enter this optional local read model. */
export function captureContent(store: InspectorStore, normalized: NormalizedObservation, input: unknown): ContentExcerpt | undefined {
  const id = normalized.context.projectId;
  if (!id || !normalized.supported) return;
  const policy = projectPolicy(store, id);
  if (!policy.contentDays || policy.excluded || !policy.allowSourcePreview) return;
  const record = object(input), payload = object(record?.payload);
  if (record?.type !== 'response_item' || !payload) return;
  const texts: string[] = []; let truncated = payload.truncated === true;
  const parts = (value: unknown) => {
    if (typeof value === 'string') { texts.push(value); return; }
    if (!Array.isArray(value)) return;
    for (const item of value.slice(0, 128)) { const part = object(item); if (part && ['text','input_text','output_text'].includes(String(part.type)) && typeof part.text === 'string') texts.push(part.text); else truncated = true; }
    if (value.length > 128) truncated = true;
  };
  if (payload.type === 'message' && ['user','assistant','developer','system'].includes(String(payload.role))) parts(payload.content);
  else if (['function_call_output','custom_tool_call_output','tool_result'].includes(String(payload.type))) parts(payload.output ?? payload.result);
  else if (['function_call','tool_call'].includes(String(payload.type)) && typeof payload.arguments === 'string') texts.push(payload.arguments);
  else if (payload.type === 'custom_tool_call' && typeof payload.input === 'string') texts.push(payload.input);
  if (!texts.length) return;
  const redacted = texts.map(redactText).join('\n'); const bytes = Buffer.from(redacted, 'utf8');
  const text = new TextDecoder().decode(bytes.subarray(0, CONTENT_LIMITS.excerptBytes), { stream: true });
  if (!text) return;
  return { text, truncated: truncated || bytes.length > CONTENT_LIMITS.excerptBytes, redactionPolicyId: 'local-content-redaction/1' };
}

/** Called inside the observation publication transaction; consent is checked again at write time. */
export function retainContent(store: InspectorStore, observationId: string, projectId: string | null, machineId: string, receivedAt: string, content: ContentExcerpt | undefined): void {
  if (!content || machineId !== store.machineId || !projectId) return;
  const policy = projectPolicy(store, projectId);
  const expiresAt = new Date(Date.parse(receivedAt) + policy.contentDays * 86400000).toISOString();
  if (!policy.contentDays || policy.excluded || !policy.allowSourcePreview || expiresAt <= new Date().toISOString()) return;
  const text = redactText(content.text); const bytes = Buffer.byteLength(text);
  if (!bytes || bytes > CONTENT_LIMITS.excerptBytes || content.redactionPolicyId !== 'local-content-redaction/1') throw new Error('INVALID_LOCAL_CONTENT');
  store.db.prepare('INSERT INTO local_content(observation_id,workspace_id,project_id,received_at,expires_at,excerpt,bytes,truncated,redaction_policy) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(observation_id) DO UPDATE SET excerpt=excluded.excerpt,bytes=excluded.bytes,truncated=excluded.truncated,expires_at=MIN(local_content.expires_at,excluded.expires_at),redaction_policy=excluded.redaction_policy').run(observationId, store.workspaceId, projectId, receivedAt, expiresAt, text, bytes, content.truncated ? 1 : 0, content.redactionPolicyId);
}

/** Expiry and hard caps do not depend on metadata expiring in the same scan. */
export function pruneContent(store: InspectorStore, now = Date.now()): void {
  const workspace = store.workspaceId;
  store.db.prepare("DELETE FROM local_content WHERE workspace_id=? AND NOT EXISTS(SELECT 1 FROM project_policies p WHERE p.workspace_id=local_content.workspace_id AND p.project_id=local_content.project_id AND json_extract(p.record,'$.contentDays')>0 AND json_extract(p.record,'$.allowSourcePreview')=1 AND json_extract(p.record,'$.excluded')=0)").run(workspace);
  for (const row of store.db.prepare('SELECT DISTINCT project_id FROM local_content WHERE workspace_id=?').all(workspace)) {
    const policy = projectPolicy(store, String(row.project_id));
    if (!policy.contentDays || !policy.allowSourcePreview || policy.excluded) store.db.prepare('DELETE FROM local_content WHERE workspace_id=? AND project_id=?').run(workspace, row.project_id);
    else store.db.prepare("UPDATE local_content SET expires_at=MIN(expires_at,strftime('%Y-%m-%dT%H:%M:%fZ',received_at,?)) WHERE workspace_id=? AND project_id=?").run(`+${policy.contentDays} days`, workspace, row.project_id);
  }
  store.db.prepare('DELETE FROM local_content WHERE workspace_id=? AND expires_at<=?').run(workspace, new Date(now).toISOString());
  const totals = store.db.prepare('SELECT project_id,SUM(bytes) AS bytes FROM local_content WHERE workspace_id=? GROUP BY project_id').all(workspace);
  for (const total of totals) {
    let bytes = Number(total.bytes); if (bytes <= CONTENT_LIMITS.projectBytes) continue;
    for (const row of store.db.prepare('SELECT observation_id,bytes FROM local_content WHERE workspace_id=? AND project_id=? ORDER BY sequence').iterate(workspace, total.project_id)) { store.db.prepare('DELETE FROM local_content WHERE observation_id=?').run(row.observation_id); bytes -= Number(row.bytes); if (bytes <= CONTENT_LIMITS.projectBytes) break; }
  }
  const total = store.db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(bytes),0) AS bytes FROM local_content WHERE workspace_id=?').get(workspace)!;
  let bytes = Number(total.bytes), records = Number(total.n);
  if (bytes > CONTENT_LIMITS.workspaceBytes || records > CONTENT_LIMITS.workspaceRecords) for (const row of store.db.prepare('SELECT observation_id,bytes FROM local_content WHERE workspace_id=? ORDER BY sequence').iterate(workspace)) { store.db.prepare('DELETE FROM local_content WHERE observation_id=?').run(row.observation_id); bytes -= Number(row.bytes); records--; if (bytes <= CONTENT_LIMITS.workspaceBytes && records <= CONTENT_LIMITS.workspaceRecords) break; }
}

export function contentSearch(store: InspectorStore, input: unknown = {}, now = Date.now()): ContentSearchPage {
  const value = object(input); if (!value) throw new Error('INVALID_CONTENT_QUERY');
  const { search = '', cursor, ...base } = value;
  if (typeof search !== 'string' || search.length > 256 || /[\x00-\x1f]/.test(search)) throw new Error('INVALID_CONTENT_QUERY');
  const query = validateQuery(base); const text = search.trim(); const privacy = store.getSetting('privacy_version') ?? '0'; const analysis = store.getSetting('timeline_analysis_epoch') ?? '0';
  const hash = digest(JSON.stringify({ ...query, limit: undefined, search: text }));
  let after = 0, watermark = Number(store.db.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM local_content WHERE workspace_id=?').get(store.workspaceId)!.n);
  let capturedAt = new Date(now).toISOString();
  if (cursor !== undefined) {
    if (typeof cursor !== 'string' || cursor.length > 2048) throw new Error('INVALID_CURSOR');
    let c; try { c = object(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))); } catch { throw new Error('INVALID_CURSOR'); }
    if (!c || c.hash !== hash || !Number.isSafeInteger(c.after) || Number(c.after) < 0 || !Number.isSafeInteger(c.watermark) || Number(c.watermark) < Number(c.after) || typeof c.capturedAt !== 'string' || !Number.isFinite(Date.parse(c.capturedAt))) throw new Error('INVALID_CURSOR');
    if (c.privacy !== privacy || c.analysis !== analysis) throw new Error('CONTENT_SNAPSHOT_INVALIDATED');
    after = Number(c.after); watermark = Number(c.watermark); capturedAt = c.capturedAt;
  }
  const filter = store.queryFilter(query, 'e'); const args: SQLInputValue[] = [...filter.args, new Date(now).toISOString(), watermark];
  const parts = [filter.sql, 'c.expires_at>?', 'c.sequence<=?', "json_extract(p.record,'$.contentDays')>0", "json_extract(p.record,'$.allowSourcePreview')=1", "json_extract(p.record,'$.excluded')=0", "COALESCE(json_extract(cc.record,'$.policy.allowSourcePreview'),1)=1", "COALESCE(json_extract(cc.record,'$.policy.excluded'),0)=0", "COALESCE(json_extract(cc.record,'$.policy.contentDays'),30)>0"];
  const equal = (column: string, item: string | null | undefined) => { if (item !== undefined) { parts.push(`${column}${item === null ? ' IS NULL' : '=?'}`); if (item !== null) args.push(item); } };
  equal('e.project_id', query.projectId); equal('e.requested_model', query.requestedModel); equal('COALESCE(e.observed_model,e.requested_model)', query.attributedModel); equal('e.provider', query.provider); equal('e.service_tier', query.serviceTier);
  const dates = dateFilter({ ...query, days: undefined, from: query.days ? new Date(Math.max(Date.parse(query.from ?? '1970-01-01'), Date.parse(capturedAt) - query.days * 86400000)).toISOString() : query.from, to: query.to ?? (query.days ? capturedAt : undefined) }, 'e.timestamp');
  if (dates.sql) { parts.push(dates.sql); args.push(...dates.args); }
  const joins = "FROM local_content c JOIN observations o ON o.id=c.observation_id JOIN sources s ON s.id=o.source_id AND s.workspace_id=c.workspace_id JOIN timeline_events e ON e.observation_id=c.observation_id JOIN project_policies p ON p.workspace_id=c.workspace_id AND p.project_id=c.project_id LEFT JOIN collector_project_constraints cc ON cc.workspace_id=c.workspace_id AND cc.project_id=COALESCE((SELECT project_id FROM collector_project_constraints selected WHERE selected.workspace_id=c.workspace_id AND selected.project_id=c.project_id),'*')";
  const retained = Number(store.db.prepare(`SELECT COUNT(*) AS n ${joins} WHERE ${parts.join(' AND ')}`).get(...args)!.n);
  if (!text) return { retained, items: [], nextCursor: null, limits: CONTENT_LIMITS };
  parts.push('instr(lower(c.excerpt),?)>0', 'c.sequence>?'); args.push(text.toLowerCase(), after);
  const limit = query.limit ?? 50;
  const rows = store.db.prepare(`SELECT c.*,o.evidence_ref,o.source_id,e.thread_id,e.machine_id,e.kind,e.timestamp,e.generation ${joins} WHERE ${parts.join(' AND ')} ORDER BY c.sequence LIMIT ?`).all(...args, limit + 1);
  const items = rows.slice(0, limit).map(row => ({ id: String(row.observation_id), sourceId: String(row.source_id), evidenceRef: String(row.evidence_ref), projectId: String(row.project_id), machineId: String(row.machine_id), threadId: row.thread_id === null ? null : String(row.thread_id), generation: Number(row.generation), kind: String(row.kind), timestamp: row.timestamp === null ? null : String(row.timestamp), receivedAt: String(row.received_at), expiresAt: String(row.expires_at), text: String(row.excerpt), truncated: !!row.truncated, redactionPolicyId: String(row.redaction_policy) }));
  return { retained, items, limits: CONTENT_LIMITS, nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ hash, after: Number(rows[limit - 1].sequence), watermark, capturedAt, privacy, analysis })).toString('base64url') : null };
}
