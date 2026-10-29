import { promises as fs } from 'node:fs';
import path from 'node:path';
import { InspectorStore } from './InspectorStore';
import { pruneContent } from './local-content';
import { digest, object } from '../accounting/codex-observations';
import type { PrivacyView, RetentionPolicy, TraceRoot, ProjectDeletionPlan } from '../shared/inspector';
import { clearBudgetHistory } from '../diagnostics/budgets';
import { projectId, projectPolicy, projectPolicies, projectPrivacy, bumpPrivacyVersion, privacyVersion } from './project-privacy';

const DEFAULT_RETENTION: RetentionPolicy = { eventDays: 30, usageDays: 180, rawCopies: false, textSearch: false };
export function roots(store: InspectorStore): TraceRoot[] {
  return store.db.prepare('SELECT id,path,label,enabled FROM source_roots WHERE workspace_id=? ORDER BY label,id').all(store.workspaceId).map(row => ({ id: String(row.id), path: String(row.path), label: String(row.label), enabled: Number(row.enabled) === 1 }));
}
export async function addRoot(store: InspectorStore, input: unknown): Promise<void> {
  if (typeof input !== 'string' || input.length > 4096) throw new Error('INVALID_ROOT');
  const stat = await fs.lstat(input); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('FORBIDDEN_SOURCE');
  const canonical = await fs.realpath(input); const id = `root:${digest(`${store.workspaceId}:${canonical}`)}`;
  store.db.prepare('INSERT INTO source_roots VALUES(?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET enabled=1').run(id, store.workspaceId, canonical, path.basename(canonical)); store.audit('source_root.add', id);
}
export function setRoot(store: InspectorStore, input: unknown): void {
  const value = object(input); if (!value || typeof value.id !== 'string' || typeof value.enabled !== 'boolean' || Object.keys(value).some(key => !['id', 'enabled'].includes(key))) throw new Error('INVALID_ROOT');
  const changed = store.db.prepare('UPDATE source_roots SET enabled=? WHERE workspace_id=? AND id=?').run(value.enabled ? 1 : 0, store.workspaceId, value.id);
  if (!changed.changes) throw new Error('UNKNOWN_ROOT'); store.audit(value.enabled ? 'source_root.enable' : 'source_root.disable', value.id);
}
export function retention(store: InspectorStore): RetentionPolicy { return JSON.parse(store.getSetting('retention_policy') ?? JSON.stringify(DEFAULT_RETENTION)) as RetentionPolicy; }
function checkedRetention(store: InspectorStore, input: unknown): RetentionPolicy {
  const value = object(input); if (!value || Object.keys(value).some(key => !['eventDays', 'usageDays', 'rawCopies', 'textSearch'].includes(key))) throw new Error('INVALID_RETENTION');
  if (!Number.isInteger(value.eventDays) || Number(value.eventDays) < 1 || Number(value.eventDays) > 3650 || !Number.isInteger(value.usageDays) || Number(value.usageDays) < Number(value.eventDays) || Number(value.usageDays) > 3650 || value.rawCopies !== false || value.textSearch !== false) throw new Error('INVALID_RETENTION');
  for (const row of store.db.prepare('SELECT record FROM project_policies WHERE workspace_id=?').all(store.workspaceId)) { const policy = JSON.parse(String(row.record)); if ((policy.usageDays ?? Number(value.usageDays)) < (policy.metadataDays ?? Number(value.eventDays))) throw new Error('PROJECT_RETENTION_CONFLICT'); if (policy.contentDays > Math.min(30, policy.metadataDays ?? Number(value.eventDays))) throw new Error('PROJECT_CONTENT_RETENTION_CONFLICT'); }
  return value as unknown as RetentionPolicy;
}
export function retentionPlan(store: InspectorStore, input: unknown): { policy: RetentionPolicy; collectorTargets: number } {
  const policy = checkedRetention(store, input), current = retention(store), changed = policy.eventDays !== current.eventDays || policy.usageDays !== current.usageDays;
  return { policy, collectorTargets: changed ? Number(store.db.prepare("SELECT COUNT(*) AS n FROM devices WHERE workspace_id=? AND state IN ('active','pending')").get(store.workspaceId)!.n) : 0 };
}
export function setRetention(store: InspectorStore, input: unknown): void {
  const value = checkedRetention(store, input);
  store.db.exec('BEGIN IMMEDIATE');
  try { store.setSetting('retention_policy', JSON.stringify(value)); bumpPrivacyVersion(store); store.setSetting('project-control-version:*', privacyVersion(store)); store.audit('retention.update', store.workspaceId); store.db.exec('COMMIT'); }
  catch (error) { store.db.exec('ROLLBACK'); throw error; }
}
export function privacy(store: InspectorStore): PrivacyView {
  return { roots: roots(store), retention: retention(store), projects: projectPrivacy(store), excludedSources: Number(store.db.prepare('SELECT COUNT(*) AS count FROM source_tombstones WHERE workspace_id=?').get(store.workspaceId)!.count),
    auditEntries: Number(store.db.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE workspace_id=?').get(store.workspaceId)!.count) };
}

function removeTrialSnapshots(store: InspectorStore, threadId: string | null): void {
  if (!threadId) return;
  const relatedContracts = store.db.prepare(`WITH RECURSIVE ancestors(id) AS (SELECT ? UNION SELECT s.parent_thread_id FROM sources s JOIN ancestors a ON s.thread_id=a.id WHERE s.workspace_id=? AND s.parent_thread_id IS NOT NULL) SELECT id FROM task_contracts WHERE workspace_id=? AND run_id IN (SELECT id FROM ancestors)`).all(threadId, store.workspaceId, store.workspaceId).map(row => String(row.id));
  for (const contractId of relatedContracts) {
    store.db.prepare("DELETE FROM trials WHERE workspace_id=? AND contract_id=? AND json_extract(record,'$.executionId') IS NOT NULL").run(store.workspaceId, contractId);
    store.db.prepare("DELETE FROM settings WHERE key LIKE 'benchmark-execution:%' AND json_extract(value,'$.contractId')=?").run(contractId);
  }
  // An inclusive root trial also contains a deleted/expired child run.
  store.db.prepare(`DELETE FROM trials WHERE workspace_id=? AND json_extract(record,'$.runId') IN (
    WITH RECURSIVE ancestors(id) AS (SELECT ? UNION SELECT s.parent_thread_id FROM sources s JOIN ancestors a ON s.thread_id=a.id
      WHERE s.workspace_id=? AND s.parent_thread_id IS NOT NULL) SELECT id FROM ancestors)`).run(store.workspaceId, threadId, store.workspaceId);
}

function clearAgentAnnotations(store: InspectorStore, sourceIds: Set<string>): void {
  for (const sourceId of sourceIds) {
    store.db.prepare('DELETE FROM settings WHERE key=?').run(`agent-purpose:${sourceId}`);
    const links = store.db.prepare('SELECT value FROM settings WHERE key LIKE ?').all(`comparison-annotation:${sourceId}:%`);
    for (const link of links) { store.db.prepare('DELETE FROM annotations WHERE workspace_id=? AND finding_id=?').run(store.workspaceId, String(link.value)); store.db.prepare('DELETE FROM settings WHERE key LIKE ?').run(`comparison-annotation:%:${String(link.value)}`); }
  }
}

/** The temporary selection holds IDs only; remove every derived copy of them. */
function purgeSelectedObservations(store: InspectorStore): void {
  const count = Number(store.db.prepare('SELECT COUNT(*) AS n FROM expired_observations').get()!.n);
  if (!count) return;
  const affected = new Set(store.db.prepare('SELECT DISTINCT source_id FROM observations WHERE id IN (SELECT id FROM expired_observations)').all().map(row => String(row.source_id)));
  clearBudgetHistory(store, affected);
  clearAgentAnnotations(store, affected);
  bumpPrivacyVersion(store);
  for (const row of store.db.prepare(`SELECT DISTINCT json_extract(normalized,'$.context.threadId') AS thread_id FROM observations WHERE id IN (SELECT id FROM expired_observations)`).all()) removeTrialSnapshots(store, row.thread_id === null ? null : String(row.thread_id));
  store.db.prepare(`DELETE FROM context_records WHERE workspace_id=? AND (client_id,request_id) IN (SELECT client_id,request_id FROM context_records WHERE workspace_id=? AND kind='manifest' AND json_extract(record,'$.threadId') IN (SELECT DISTINCT json_extract(normalized,'$.context.threadId') FROM observations WHERE id IN (SELECT id FROM expired_observations)))`).run(store.workspaceId, store.workspaceId);
  store.db.exec(`DELETE FROM annotations WHERE finding_id IN (SELECT id FROM incidents WHERE source_id IN (SELECT source_id FROM observations WHERE id IN (SELECT id FROM expired_observations)));
    DELETE FROM incidents WHERE source_id IN (SELECT source_id FROM observations WHERE id IN (SELECT id FROM expired_observations));
    DELETE FROM tool_index WHERE input_observation IN (SELECT id FROM expired_observations) OR output_observation IN (SELECT id FROM expired_observations);
    CREATE TEMP TABLE expired_entries AS SELECT DISTINCT entry_id,revision FROM ledger_links WHERE observation_id IN (SELECT id FROM expired_observations);
    DELETE FROM ledger_links WHERE (entry_id,revision) IN (SELECT entry_id,revision FROM expired_entries);
    DELETE FROM ledger_memberships WHERE (id,revision) IN (SELECT entry_id,revision FROM expired_entries);
    DELETE FROM ledger_payloads WHERE id NOT IN (SELECT payload_id FROM ledger_memberships);
    DELETE FROM observation_analyses WHERE observation_id IN (SELECT id FROM expired_observations);
    DELETE FROM usage_observations WHERE observation_id IN (SELECT id FROM expired_observations);
    DELETE FROM observations WHERE id IN (SELECT id FROM expired_observations);
    DROP TABLE expired_entries;`);
}

/** Delete monitor-owned data and suppress reimport; the original trace file is never opened for writing. */
export function deleteSource(store: InspectorStore, id: unknown): void {
  if (typeof id !== 'string' || !/^source:[a-f0-9]{64}$/.test(id)) throw new Error('INVALID_SOURCE_ID');
  const cursor = store.getSource(id); if (!cursor) throw new Error('UNKNOWN_SOURCE');
  const scopes = store.dirtyScopes(id);
  store.db.exec('BEGIN IMMEDIATE');
  try {
    clearBudgetHistory(store, new Set([id]));
    clearAgentAnnotations(store, new Set([id]));
    store.db.prepare('DELETE FROM annotations WHERE finding_id IN (SELECT id FROM incidents WHERE source_id=?)').run(id);
    store.db.prepare('INSERT OR REPLACE INTO source_tombstones VALUES(?,?,?,?,?)').run(id, store.workspaceId, cursor.machineId, cursor.path.startsWith('remote:') ? cursor.fileIdentity : null, new Date().toISOString());
    store.db.prepare('INSERT OR REPLACE INTO exclusions VALUES(?,?,?)').run(id, new Date().toISOString(), 'user_delete');
    removeTrialSnapshots(store, cursor.context.threadId);
    if (cursor.context.threadId) {
      store.db.prepare('INSERT OR IGNORE INTO context_exclusions VALUES(?,?,?)').run(store.workspaceId, cursor.machineId, cursor.context.threadId);
      store.db.prepare("DELETE FROM context_records WHERE workspace_id=? AND (client_id,request_id) IN (SELECT client_id,request_id FROM context_records WHERE workspace_id=? AND kind='manifest' AND json_extract(record,'$.machineId')=? AND json_extract(record,'$.threadId')=?)").run(store.workspaceId, store.workspaceId, cursor.machineId, cursor.context.threadId);
    }
    store.db.prepare('DELETE FROM observation_analyses WHERE observation_id IN (SELECT id FROM observations WHERE source_id=?)').run(id);
    store.db.prepare('DELETE FROM source_analysis WHERE source_id=?').run(id);
    store.db.prepare('DELETE FROM tool_index WHERE source_id=?').run(id);
    store.db.prepare('DELETE FROM ledger_links WHERE observation_id IN (SELECT id FROM observations WHERE source_id=?)').run(id);
    store.db.prepare('DELETE FROM ledger_links WHERE (entry_id,revision) IN (SELECT id,revision FROM ledger WHERE source_id=?)').run(id);
    store.db.prepare('DELETE FROM ledger_memberships WHERE source_id=?').run(id);
    store.db.exec('DELETE FROM ledger_payloads WHERE id NOT IN (SELECT payload_id FROM ledger_memberships);');
    store.db.prepare('DELETE FROM usage_observations WHERE observation_id IN (SELECT id FROM observations WHERE source_id=?)').run(id);
    store.db.prepare('DELETE FROM observations WHERE source_id=?').run(id);
    store.db.prepare('DELETE FROM sources WHERE id=? AND workspace_id=?').run(id, store.workspaceId);
    for (const scope of scopes) store.db.prepare('INSERT OR IGNORE INTO dirty_scopes VALUES(?,?)').run(scope, store.workspaceId);
    // Saved trial snapshots containing this run are monitor-owned derived data too.
    bumpPrivacyVersion(store); store.audit('source.delete', id); store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  store.reconcileDirty();
}

export function hasExpiredRetention(store: InspectorStore, now = Date.now()): boolean {
  const global = retention(store), policies = projectPolicies(store);
  const earliest = Math.min(global.eventDays, global.usageDays, ...[...policies.values()].map(p => p.metadataDays ?? global.eventDays), ...[...policies.values()].map(p => p.usageDays ?? global.usageDays));
  for (const row of store.db.prepare("SELECT o.received_at,COALESCE(json_extract(o.normalized,'$.context.projectId'),'(unknown)') AS project_id,EXISTS(SELECT 1 FROM usage_observations u WHERE u.observation_id=o.id) AS has_usage FROM observations o WHERE o.workspace_id=? AND o.received_at<?").iterate(store.workspaceId, new Date(now - earliest * 86400000).toISOString())) {
    const policy = policies.get(String(row.project_id)) ?? projectPolicy(store, String(row.project_id));
    if (String(row.received_at) < new Date(now - (policy.usageDays ?? global.usageDays) * 86400000).toISOString() || !row.has_usage && String(row.received_at) < new Date(now - (policy.metadataDays ?? global.eventDays) * 86400000).toISOString()) return true;
  }
  return false;
}
export function applyRetention(store: InspectorStore): void {
  const policy = retention(store); const now = Date.now(); const cutoff = new Date(now - policy.eventDays * 86400000).toISOString();
  const usageCutoff = new Date(now - policy.usageDays * 86400000).toISOString();
  const scopes = new Set<string>();
  store.db.exec('BEGIN IMMEDIATE');
  try {
    pruneContent(store, now);
    store.db.exec('CREATE TEMP TABLE expired_observations(id TEXT PRIMARY KEY); CREATE TEMP TABLE expired_usage(id TEXT PRIMARY KEY);');
    const policies = projectPolicies(store);
    const earliest = Math.min(policy.eventDays, policy.usageDays, ...[...policies.values()].map(p => p.metadataDays ?? policy.eventDays), ...[...policies.values()].map(p => p.usageDays ?? policy.usageDays));
    for (const row of store.db.prepare(`SELECT o.id,o.received_at,COALESCE(json_extract(o.normalized,'$.context.projectId'),'(unknown)') AS project_id,EXISTS(SELECT 1 FROM usage_observations u WHERE u.observation_id=o.id) AS has_usage FROM observations o WHERE o.workspace_id=? AND o.received_at<?`).iterate(store.workspaceId, new Date(now - earliest * 86400000).toISOString())) {
      const project = policies.get(String(row.project_id)) ?? projectPolicy(store, String(row.project_id)); const expiredUsage = String(row.received_at) < new Date(now - (project.usageDays ?? policy.usageDays) * 86400000).toISOString();
      if (expiredUsage || !row.has_usage && String(row.received_at) < new Date(now - (project?.metadataDays ?? policy.eventDays) * 86400000).toISOString()) { store.db.prepare('INSERT INTO expired_observations VALUES(?)').run(row.id); if (expiredUsage) store.db.prepare('INSERT INTO expired_usage VALUES(?)').run(row.id); }
    }
    const expiredCount=Number(store.db.prepare('SELECT COUNT(*) AS n FROM expired_observations').get()!.n);
    if (expiredCount) {
      rememberProjectExpiry(store);
      for (const row of store.db.prepare(`SELECT DISTINCT u.scope_id FROM usage_observations u JOIN expired_observations e ON e.id=u.observation_id`).iterate()) scopes.add(String(row.scope_id));
      const affected = store.db.prepare(`SELECT DISTINCT source_id FROM observations o JOIN expired_usage e ON e.id=o.id WHERE NOT EXISTS(SELECT 1 FROM project_source_links p JOIN project_policies c ON c.workspace_id=p.workspace_id AND c.project_id=p.project_id WHERE p.workspace_id=? AND p.source_id=o.source_id) AND NOT EXISTS(SELECT 1 FROM collector_project_constraints c WHERE c.workspace_id=? AND (c.project_id='*' OR c.project_id IN (SELECT project_id FROM project_source_links WHERE workspace_id=? AND source_id=o.source_id)))`).all(store.workspaceId, store.workspaceId, store.workspaceId);
      for (const row of affected) {
        const id = String(row.source_id); const cursor = store.getSource(id); if (!cursor) continue;
        const last = store.db.prepare(`SELECT o.generation,o.line,o.byte_end FROM observations o JOIN expired_observations e ON e.id=o.id WHERE o.source_id=? ORDER BY o.generation DESC,o.byte_end DESC LIMIT 1`).get(id)!;
        const floor = { generation: Number(last.generation), line: Number(last.line), byteEnd: Number(last.byte_end), removedAt: new Date().toISOString() };
        if (!cursor.retentionFloor || floor.generation > cursor.retentionFloor.generation || floor.generation === cursor.retentionFloor.generation && floor.byteEnd > cursor.retentionFloor.byteEnd) cursor.retentionFloor = floor;
        if (!cursor.issues.includes('USAGE_RETENTION_GAP')) cursor.issues.push('USAGE_RETENTION_GAP');
        store.db.prepare('UPDATE sources SET cursor=? WHERE id=? AND workspace_id=?').run(JSON.stringify(cursor), id, store.workspaceId);
        removeTrialSnapshots(store, cursor.context.threadId);
        store.audit('retention.usage_expired', id);
      }
      purgeSelectedObservations(store);
    }
    store.db.prepare("DELETE FROM context_records WHERE workspace_id=? AND (client_id,request_id) IN (SELECT client_id,request_id FROM context_records WHERE workspace_id=? AND kind='manifest' AND received_at<?)").run(store.workspaceId, store.workspaceId, usageCutoff);
    store.db.prepare('DELETE FROM annotations WHERE workspace_id=? AND created_at<?').run(store.workspaceId, cutoff);
    store.db.exec('DROP TABLE expired_usage; DROP TABLE expired_observations;');
    for (const scope of scopes) store.db.prepare('INSERT OR IGNORE INTO dirty_scopes VALUES(?,?)').run(scope, store.workspaceId);
    store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK; DROP TABLE IF EXISTS expired_entries; DROP TABLE IF EXISTS expired_usage; DROP TABLE IF EXISTS expired_observations;'); throw error; }
  store.reconcile(scopes);
}

function rememberProjectExpiry(store: InspectorStore): void {
  store.db.prepare(`INSERT OR IGNORE INTO usage_retention_gaps SELECT u.workspace_id,u.source_id,u.scope_id,u.generation,u.sequence,CAST(u.semantic_sequence AS INTEGER) FROM usage_observations u JOIN expired_observations e ON e.id=u.observation_id WHERE u.workspace_id=?`).run(store.workspaceId);
  for (const row of store.db.prepare('SELECT DISTINCT u.source_id FROM usage_observations u JOIN expired_observations e ON e.id=u.observation_id').all()) { const cursor = store.getSource(String(row.source_id)); if (cursor && !cursor.issues.includes('PROJECT_RETENTION_GAP')) { cursor.issues.push('PROJECT_RETENTION_GAP'); store.db.prepare('UPDATE sources SET cursor=? WHERE id=?').run(JSON.stringify(cursor), cursor.id); } }
  const rows = store.db.prepare(`SELECT o.source_id,COALESCE(json_extract(o.normalized,'$.context.projectId'),'(unknown)') AS project_id,o.generation,MAX(o.byte_end) AS byte_end FROM observations o JOIN expired_observations e ON e.id=o.id WHERE o.workspace_id=? GROUP BY o.source_id,project_id,o.generation ORDER BY o.generation`);
  for (const row of rows.iterate(store.workspaceId)) store.db.prepare(`INSERT INTO project_retention_floors VALUES(?,?,?,?,?) ON CONFLICT(workspace_id,source_id,project_id) DO UPDATE SET generation=excluded.generation,byte_end=excluded.byte_end WHERE excluded.generation>generation OR excluded.generation=generation AND excluded.byte_end>byte_end`).run(store.workspaceId, row.source_id, row.project_id, row.generation, row.byte_end);
}

export function projectDeletionPlan(store: InspectorStore, input: unknown): ProjectDeletionPlan {
  const id = projectId(input); if (id === '(unknown)') throw new Error('PROJECT_IDENTITY_REQUIRED');
  const stats = store.db.prepare(`SELECT COUNT(*) AS observations,COUNT(DISTINCT source_id) AS sources FROM observations WHERE workspace_id=? AND json_extract(normalized,'$.context.projectId')=?`).get(store.workspaceId, id)!;
  if (!Number(stats.observations) && !projectPolicy(store, id).updatedAt) throw new Error('UNKNOWN_PROJECT');
  const usage = store.db.prepare(`SELECT COUNT(*) AS n FROM usage_observations u JOIN observations o ON o.id=u.observation_id WHERE o.workspace_id=? AND json_extract(o.normalized,'$.context.projectId')=?`).get(store.workspaceId, id)!;
  const mixed = store.db.prepare(`SELECT COUNT(*) AS n FROM (SELECT source_id FROM observations WHERE workspace_id=? GROUP BY source_id HAVING COUNT(DISTINCT COALESCE(json_extract(normalized,'$.context.projectId'),'(unknown)'))>1 AND SUM(json_extract(normalized,'$.context.projectId')=?)>0)`).get(store.workspaceId, id)!;
  return { projectId: id, observations: Number(stats.observations), usageObservations: Number(usage.n), sources: Number(stats.sources), mixedSources: Number(mixed.n), revision: store.revision() };
}
export function deleteProject(store: InspectorStore, input: unknown): void {
  const plan = projectDeletionPlan(store, input); const scopes = new Set<string>();
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const policy = { ...projectPolicy(store, plan.projectId), excluded: true, allowExports: false, allowSourcePreview: false, updatedAt: new Date().toISOString() };
    store.db.prepare('INSERT INTO project_policies VALUES(?,?,?) ON CONFLICT(workspace_id,project_id) DO UPDATE SET record=excluded.record').run(store.workspaceId, plan.projectId, JSON.stringify(policy));
    store.db.exec('CREATE TEMP TABLE expired_observations(id TEXT PRIMARY KEY);');
    store.db.prepare(`INSERT INTO expired_observations SELECT id FROM observations WHERE workspace_id=? AND json_extract(normalized,'$.context.projectId')=?`).run(store.workspaceId, plan.projectId);
    for (const row of store.db.prepare('SELECT DISTINCT u.scope_id FROM usage_observations u JOIN expired_observations e ON e.id=u.observation_id').iterate()) scopes.add(String(row.scope_id));
    rememberProjectExpiry(store); purgeSelectedObservations(store);
    store.db.exec('DROP TABLE expired_observations;');
    for (const scope of scopes) store.db.prepare('INSERT OR IGNORE INTO dirty_scopes VALUES(?,?)').run(scope, store.workspaceId);
    bumpPrivacyVersion(store); store.setSetting(`project-control-version:${plan.projectId}`, privacyVersion(store)); store.audit('project.delete', plan.projectId); store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK; DROP TABLE IF EXISTS expired_entries; DROP TABLE IF EXISTS expired_observations;'); throw error; }
  store.reconcileDirty();
}
