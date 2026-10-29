import { InspectorStore } from './InspectorStore';
import { clearDiagnosticsCache } from '../diagnostics/analyze';
import { object } from '../accounting/codex-observations';
import type { InspectorQuery, ProjectPrivacyItem, ProjectPrivacyPolicy } from '../shared/inspector';
import { pruneContent } from './local-content';
import type { ProjectPolicyControl } from '../transport/protocol';

export const projectId = (input: unknown): string => { if (typeof input !== 'string' || input !== '(unknown)' && !/^project:[a-f0-9]{24,64}$/.test(input)) throw new Error('INVALID_PROJECT_ID'); return input; };
export function projectPolicy(store: InspectorStore, id: string | null): ProjectPrivacyPolicy {
  const key = id ?? '(unknown)'; const row = store.db.prepare('SELECT record FROM project_policies WHERE workspace_id=? AND project_id=?').get(store.workspaceId, key);
  const local: ProjectPrivacyPolicy = row ? JSON.parse(String(row.record)) : { projectId: key, metadataDays: null, usageDays: null, contentDays: 0, allowExports: true, allowSourcePreview: true, excluded: false, updatedAt: null };
  const constraint = store.db.prepare("SELECT record FROM collector_project_constraints WHERE workspace_id=? AND project_id IN (?, '*') ORDER BY (project_id='*') LIMIT 1").get(store.workspaceId, key);
  if (!constraint) return local;
  const central = (JSON.parse(String(constraint.record)) as ProjectPolicyControl).policy;
  const global = JSON.parse(store.getSetting('retention_policy') ?? '{"eventDays":30,"usageDays":180}');
  const metadataDays = Math.min(local.metadataDays ?? global.eventDays, central.metadataDays), usageDays = Math.min(local.usageDays ?? global.usageDays, central.usageDays);
  const allowSourcePreview = local.allowSourcePreview && central.allowSourcePreview, excluded = local.excluded || central.excluded;
  return { ...local, metadataDays, usageDays, contentDays: !allowSourcePreview || excluded ? 0 : Math.min(local.contentDays, central.contentDays ?? 30, metadataDays), allowExports: local.allowExports && central.allowExports, allowSourcePreview, excluded };
}
export function projectPolicies(store: InspectorStore): Map<string, ProjectPrivacyPolicy> {
  const ids = store.db.prepare("SELECT project_id FROM project_policies WHERE workspace_id=? UNION SELECT project_id FROM collector_project_constraints WHERE workspace_id=? AND project_id!='*'").all(store.workspaceId, store.workspaceId).map(row => String(row.project_id));
  return new Map([...new Set(['(unknown)', ...ids])].map(id => [id, projectPolicy(store, id)]));
}
function previewRestricted(store: InspectorStore): boolean { return [...projectPolicies(store).values()].some(policy => !policy.allowSourcePreview || policy.excluded); }
export const privacyVersion = (store: InspectorStore) => store.getSetting('privacy_version') ?? '0';
export function bumpPrivacyVersion(store: InspectorStore): void { clearDiagnosticsCache(store); store.db.prepare("DELETE FROM settings WHERE key LIKE 'collector-health:%'").run(); store.setSetting('privacy_version', (BigInt(privacyVersion(store)) + 1n).toString()); }
function checkedPolicy(store: InspectorStore, input: unknown): ProjectPrivacyPolicy {
  const value = object(input); if (!value || Object.keys(value).some(key => !['projectId', 'metadataDays', 'usageDays', 'contentDays', 'allowExports', 'allowSourcePreview', 'excluded', 'updatedAt'].includes(key))) throw new Error('INVALID_PROJECT_POLICY');
  const id = projectId(value.projectId);
  for (const key of ['metadataDays', 'usageDays']) if (value[key] !== null && (!Number.isInteger(value[key]) || Number(value[key]) < 1 || Number(value[key]) > 3650)) throw new Error('INVALID_PROJECT_RETENTION');
  const global = JSON.parse(store.getSetting('retention_policy') ?? '{"eventDays":30,"usageDays":180}');
  if (Number(value.usageDays ?? global.usageDays) < Number(value.metadataDays ?? global.eventDays) || !Number.isInteger(value.contentDays) || Number(value.contentDays) < 0 || Number(value.contentDays) > Math.min(30, Number(value.metadataDays ?? global.eventDays)) || typeof value.allowExports !== 'boolean' || typeof value.allowSourcePreview !== 'boolean' || value.excluded !== projectPolicy(store, id).excluded || Number(value.contentDays) > 0 && (id === '(unknown)' || !value.allowSourcePreview || value.excluded)) throw new Error('INVALID_PROJECT_POLICY');
  return { projectId: id, metadataDays: value.metadataDays as number | null, usageDays: value.usageDays as number | null, contentDays: Number(value.contentDays), allowExports: value.allowExports, allowSourcePreview: value.allowSourcePreview, excluded: value.excluded as boolean, updatedAt: new Date().toISOString() };
}
export function projectPolicyPlan(store: InspectorStore, input: unknown): { policy: ProjectPrivacyPolicy; expiredObservations: number; expiredContent: number; contentConsentRequired: boolean; collectorTargets: number } {
  const policy = checkedPolicy(store, input); const global = JSON.parse(store.getSetting('retention_policy') ?? '{"eventDays":30,"usageDays":180}'); const now = Date.now();
  const count = store.db.prepare(`SELECT COUNT(*) AS n FROM observations o WHERE o.workspace_id=? AND COALESCE(json_extract(o.normalized,'$.context.projectId'),'(unknown)')=? AND (o.received_at<? OR o.received_at<? AND NOT EXISTS(SELECT 1 FROM usage_observations u WHERE u.observation_id=o.id))`).get(store.workspaceId, policy.projectId, new Date(now - (policy.usageDays ?? global.usageDays) * 86400000).toISOString(), new Date(now - (policy.metadataDays ?? global.eventDays) * 86400000).toISOString());
  const expiredContent = store.db.prepare('SELECT COUNT(*) AS n FROM local_content WHERE workspace_id=? AND project_id=? AND received_at<=?').get(store.workspaceId, policy.projectId, new Date(now - policy.contentDays * 86400000).toISOString());
  const previous = projectPolicy(store, policy.projectId); const changed = ['metadataDays','usageDays','contentDays','allowExports','allowSourcePreview'].some(key => policy[key as keyof ProjectPrivacyPolicy] !== previous[key as keyof ProjectPrivacyPolicy]);
  const collectorTargets = changed ? Number(store.db.prepare("SELECT COUNT(*) AS n FROM devices WHERE workspace_id=? AND state IN ('active','pending')").get(store.workspaceId)!.n) : 0;
  return { policy, expiredObservations: Number(count!.n), expiredContent: Number(expiredContent!.n), contentConsentRequired: policy.contentDays > previous.contentDays, collectorTargets };
}
export function setProjectPolicy(store: InspectorStore, input: unknown): void {
  const record = checkedPolicy(store, input);
  store.db.exec('BEGIN IMMEDIATE');
  try {
    store.db.prepare('INSERT INTO project_policies VALUES(?,?,?) ON CONFLICT(workspace_id,project_id) DO UPDATE SET record=excluded.record').run(store.workspaceId, record.projectId, JSON.stringify(record));
    if (!record.contentDays || !record.allowSourcePreview || record.excluded) store.db.prepare('DELETE FROM local_content WHERE workspace_id=? AND project_id=?').run(store.workspaceId, record.projectId);
    else store.db.prepare("UPDATE local_content SET expires_at=MIN(expires_at,strftime('%Y-%m-%dT%H:%M:%fZ',received_at,?)) WHERE workspace_id=? AND project_id=?").run(`+${record.contentDays} days`, store.workspaceId, record.projectId);
    pruneContent(store); bumpPrivacyVersion(store); store.setSetting(`project-control-version:${record.projectId}`, privacyVersion(store)); store.audit('project_privacy.update', record.projectId); store.db.exec('COMMIT');
  }
  catch (error) { store.db.exec('ROLLBACK'); throw error; }
}
export function projectPrivacy(store: InspectorStore): ProjectPrivacyItem[] {
  const items = new Map<string, ProjectPrivacyItem>();
  for (const row of store.db.prepare(`SELECT COALESCE(json_extract(normalized,'$.context.projectId'),'(unknown)') AS project_id,COUNT(*) AS observations,COUNT(DISTINCT source_id) AS sources FROM observations WHERE workspace_id=? GROUP BY project_id`).all(store.workspaceId)) {
    const id = String(row.project_id); items.set(id, { id, observations: Number(row.observations), sources: Number(row.sources), retainedContent: 0, policy: projectPolicy(store, id) });
  }
  for (const row of store.db.prepare('SELECT project_id FROM project_policies WHERE workspace_id=?').all(store.workspaceId)) { const id = String(row.project_id); if (!items.has(id)) items.set(id, { id, observations: 0, sources: 0, retainedContent: 0, policy: projectPolicy(store, id) }); }
  for (const row of store.db.prepare('SELECT project_id,COUNT(*) AS n FROM local_content WHERE workspace_id=? AND expires_at>? GROUP BY project_id').all(store.workspaceId, new Date().toISOString())) { const item = items.get(String(row.project_id)); if (item) item.retainedContent = Number(row.n); }
  return [...items.values()].sort((a, b) => b.observations - a.observations || a.id.localeCompare(b.id));
}

export function assertProjectExports(store: InspectorStore, ids: Iterable<string>): void {
  for (const id of new Set(ids)) { const policy = projectPolicy(store, id); if (!policy.allowExports || policy.excluded) throw new Error('PROJECT_EXPORT_RESTRICTED'); }
}
/** Include source metadata as well as usage. Mixed sources cannot leak an opted-out project's tool history. */
export function reportProjects(store: InspectorStore, query: InspectorQuery): string[] {
  const filter = store.queryFilter(query, 's');
  return store.db.prepare(`SELECT DISTINCT COALESCE(e.project_id,'(unknown)') AS id FROM sources s JOIN timeline_events e ON e.source_id=s.id AND e.workspace_id=s.workspace_id WHERE ${filter.sql}`).all(...filter.args).map(row => String(row.id));
}
export function assertReportPrivacy(store: InspectorStore, value: unknown): void {
  const input = object(value); if (!input || typeof input.privacyVersion !== 'string' || !Array.isArray(input.projectIds) || input.projectIds.length > 10000 || Object.keys(input).some(key => !['privacyVersion', 'projectIds'].includes(key))) throw new Error('INVALID_REPORT_PRIVACY');
  if (input.privacyVersion !== privacyVersion(store)) throw new Error('REPORT_PRIVACY_CHANGED');
  assertProjectExports(store, input.projectIds.map(projectId));
}
export function sourcePreviewAllowed(store: InspectorStore, input: unknown): boolean {
  const value = object(input); if (!value || typeof value.threadId !== 'string' || typeof value.sourcePath !== 'string' || Object.keys(value).some(key => !['threadId', 'sourcePath'].includes(key))) throw new Error('INVALID_TRACE_PRIVACY');
  const ids = store.db.prepare(`SELECT DISTINCT p.project_id AS id FROM sources s JOIN project_source_links p ON p.source_id=s.id AND p.workspace_id=s.workspace_id WHERE s.workspace_id=? AND s.machine_id=? AND (s.path=? OR s.thread_id=?)`).all(store.workspaceId, store.machineId, value.sourcePath, value.threadId).map(row => String(row.id));
  if (!ids.length) { if (previewRestricted(store)) return false; ids.push('(unknown)'); }
  return ids.every(id => { const policy = projectPolicy(store, id); return policy.allowSourcePreview && !policy.excluded; });
}
export function previewPermissions(store: InspectorStore, input: unknown): { id: string; allowed: boolean }[] {
  if (!Array.isArray(input) || input.length > 2048) throw new Error('INVALID_TRACE_PRIVACY');
  const restricted = previewRestricted(store);
  return input.map(row => { const value = object(row); if (!value || typeof value.id !== 'string' || value.id.length > 2048 || Object.keys(value).some(key => !['id', 'threadId', 'sourcePath'].includes(key))) throw new Error('INVALID_TRACE_PRIVACY'); return { id: value.id, allowed: !restricted || sourcePreviewAllowed(store, { threadId: value.threadId, sourcePath: value.sourcePath }) }; });
}
