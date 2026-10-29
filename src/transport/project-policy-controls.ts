import type { InspectorStore } from '../storage/InspectorStore';
import { digest, object } from '../accounting/codex-observations';
import { integer } from '../accounting/integers';
import { projectId, bumpPrivacyVersion, projectPolicy, setProjectPolicy } from '../storage/project-privacy';
import { applyRetention, deleteProject } from '../storage/privacy';
import type { ProjectPolicyConstraint, ProjectPolicyControl } from './protocol';
import type { ProjectPolicySyncView } from '../shared/inspector';

const receiptKey = (device: string, id: string) => `project-policy-receipt:${device}:${id}`;
export const localPolicyReceiptKey = (id: string) => `collector-project-applied:${id}`;
function identity(workspace: string, version: string, policy: ProjectPolicyConstraint): string { return `policy:${digest(JSON.stringify([workspace, version, policy]))}`; }
export function validateProjectControl(workspace: string, input: unknown): ProjectPolicyControl {
  const row = object(input), value = object(row?.policy);
  if (!row || Object.keys(row).some(key => !['version','controlId','policy'].includes(key)) || typeof row.version !== 'string' || row.version.length > 32 || integer(row.version) !== row.version || !value || Object.keys(value).some(key => !['projectId','metadataDays','usageDays','contentDays','allowExports','allowSourcePreview','excluded'].includes(key))) throw new Error('INVALID_PROJECT_POLICY_CONTROL');
  const id = value.projectId === '*' ? '*' : projectId(value.projectId);
  if (!Number.isInteger(value.metadataDays) || Number(value.metadataDays) < 1 || Number(value.metadataDays) > 3650 || !Number.isInteger(value.usageDays) || Number(value.usageDays) < Number(value.metadataDays) || Number(value.usageDays) > 3650 || typeof value.allowExports !== 'boolean' || typeof value.allowSourcePreview !== 'boolean' || typeof value.excluded !== 'boolean') throw new Error('INVALID_PROJECT_POLICY_CONTROL');
  if (id === '*' ? value.contentDays !== null || value.excluded : !Number.isInteger(value.contentDays) || Number(value.contentDays) < 0 || Number(value.contentDays) > Math.min(30, Number(value.metadataDays)) || id === '(unknown)' && (value.excluded || value.contentDays !== 0)) throw new Error('INVALID_PROJECT_POLICY_CONTROL');
  const policy: ProjectPolicyConstraint = { projectId: id, metadataDays: Number(value.metadataDays), usageDays: Number(value.usageDays), contentDays: value.contentDays as number | null, allowExports: value.allowExports, allowSourcePreview: value.allowSourcePreview, excluded: value.excluded };
  if (row.controlId !== identity(workspace, row.version, policy)) throw new Error('INVALID_PROJECT_POLICY_CONTROL');
  return { version: row.version, controlId: row.controlId as string, policy };
}

/** Global bounds plus all explicit policies are paged; receipts identify the current exact control. */
export function projectControls(store: InspectorStore, deviceId: string): (ProjectPolicyControl & { applied: boolean; appliedAt: string | null })[] {
  const global = JSON.parse(store.getSetting('retention_policy') ?? '{"eventDays":30,"usageDays":180}');
  const policies: ProjectPolicyConstraint[] = [{ projectId: '*', metadataDays: global.eventDays, usageDays: global.usageDays, contentDays: null, allowExports: true, allowSourcePreview: true, excluded: false }];
  for (const raw of store.db.prepare('SELECT record FROM project_policies WHERE workspace_id=? ORDER BY project_id').all(store.workspaceId)) {
    const value = JSON.parse(String(raw.record));
    policies.push({ projectId: value.projectId, metadataDays: value.metadataDays ?? global.eventDays, usageDays: value.usageDays ?? global.usageDays, contentDays: value.excluded ? 0 : value.contentDays, allowExports: value.allowExports, allowSourcePreview: value.allowSourcePreview, excluded: value.excluded });
  }
  return policies.map(policy => {
    const ownVersion = store.getSetting(`project-control-version:${policy.projectId}`) ?? '0', globalVersion = store.getSetting('project-control-version:*') ?? '0';
    const version = BigInt(ownVersion) > BigInt(globalVersion) ? ownVersion : globalVersion;
    const controlId = identity(store.workspaceId, version, policy), saved = store.getSetting(receiptKey(deviceId, policy.projectId));
    const receipt = saved ? JSON.parse(saved) : null, applied = receipt?.controlId === controlId && receipt.version === version;
    return { version, controlId, policy, applied, appliedAt: applied ? receipt.appliedAt : null };
  });
}
export function projectPolicySync(store: InspectorStore, deviceId: string, state: string): ProjectPolicySyncView {
  const controls = projectControls(store, deviceId), version = controls.reduce((highest, control) => BigInt(control.version) > BigInt(highest) ? control.version : highest, '0');
  if (state === 'local' || state === 'revoked') return { state: state === 'local' ? 'local' : 'revoked', version, applied: 0, pending: 0, lastAppliedAt: null };
  const applied = controls.filter(control => control.applied);
  return { state: applied.length === controls.length ? 'applied' : 'pending', version, applied: applied.length, pending: controls.length - applied.length, lastAppliedAt: applied.map(control => control.appliedAt!).sort().at(-1) ?? null };
}
export function acknowledgeProjectControls(store: InspectorStore, deviceId: string, input: unknown): void {
  const value = object(input); if (!value || Object.keys(value).some(key => !['workspaceId','controls'].includes(key)) || value.workspaceId !== store.workspaceId || !Array.isArray(value.controls) || !value.controls.length || value.controls.length > 50) throw new Error('INVALID_PROJECT_POLICY_RECEIPT');
  const current = projectControls(store, deviceId);
  const receipts = value.controls.map(raw => { const row = object(raw); if (!row || Object.keys(row).some(key => !['projectId','version','controlId'].includes(key))) throw new Error('INVALID_PROJECT_POLICY_RECEIPT'); const command = current.find(control => control.policy.projectId === row.projectId && control.controlId === row.controlId && control.version === row.version); if (!command) throw new Error('PROJECT_POLICY_CHANGED'); return command; });
  if (new Set(receipts.map(receipt => receipt.policy.projectId)).size !== receipts.length) throw new Error('INVALID_PROJECT_POLICY_RECEIPT');
  store.db.exec('BEGIN IMMEDIATE');
  try { for (const command of receipts) if (!command.applied) { store.setSetting(receiptKey(deviceId, command.policy.projectId), JSON.stringify({ version: command.version, controlId: command.controlId, appliedAt: new Date().toISOString() })); store.audit('device.project_policy_applied', command.controlId); } store.db.exec('COMMIT'); }
  catch (error) { store.db.exec('ROLLBACK'); throw error; }
}

/** Separate constraints preserve local choices. Raising a hub limit grants no local content consent. */
export function checkedProjectControls(store: InspectorStore, inputs: unknown[]): ProjectPolicyControl[] {
  const controls = inputs.map(input => validateProjectControl(store.workspaceId, input));
  if (!controls.length || controls.length > 50 || new Set(controls.map(c => c.policy.projectId)).size !== controls.length) throw new Error('INVALID_PROJECT_POLICY_CONTROL');
  for (const control of controls) { const saved = store.db.prepare('SELECT record FROM collector_project_constraints WHERE workspace_id=? AND project_id=?').get(store.workspaceId, control.policy.projectId); if (saved) { const old = JSON.parse(String(saved.record)) as ProjectPolicyControl; if (BigInt(control.version) < BigInt(old.version)) throw new Error('STALE_PROJECT_POLICY_CONTROL'); if (old.version === control.version && old.controlId !== control.controlId) throw new Error('PROJECT_POLICY_CONTROL_CONFLICT'); } }
  return controls;
}
export function applyProjectControls(store: InspectorStore, inputs: unknown[]): ProjectPolicyControl[] {
  const controls = checkedProjectControls(store, inputs);
  store.db.exec('BEGIN IMMEDIATE');
  try {
    for (const control of controls) store.db.prepare('INSERT INTO collector_project_constraints VALUES(?,?,?) ON CONFLICT(workspace_id,project_id) DO UPDATE SET record=excluded.record').run(store.workspaceId, control.policy.projectId, JSON.stringify(control));
    bumpPrivacyVersion(store); store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  for (const control of controls) if (control.policy.excluded) {
    const id = control.policy.projectId, original = store.db.prepare('SELECT record FROM project_policies WHERE workspace_id=? AND project_id=?').get(store.workspaceId, id);
    if (original && JSON.parse(String(original.record)).excluded) continue;
    if (store.db.prepare("SELECT 1 FROM observations WHERE workspace_id=? AND json_extract(normalized,'$.context.projectId')=? LIMIT 1").get(store.workspaceId, id)) deleteProject(store, id);
    else setProjectPolicy(store, { ...projectPolicy(store, id), contentDays: 0, excluded: true, allowExports: false, allowSourcePreview: false });
  }
  applyRetention(store);
  return controls;
}
