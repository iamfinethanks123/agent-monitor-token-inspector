import { InspectorStore } from './InspectorStore';
import type { ScopeOptions } from '../shared/inspector';

export function scopeOptions(store: InspectorStore): ScopeOptions {
  const rows = store.db.prepare(`SELECT DISTINCT json_extract(p.entry,'$.model.providerRoute') AS provider,json_extract(p.entry,'$.model.serviceTier') AS tier FROM scope_state a CROSS JOIN ledger_memberships l ON a.scope_id=l.scope_id AND a.active_revision=l.revision JOIN ledger_payloads p ON p.id=l.payload_id WHERE l.workspace_id=?`).all(store.workspaceId);
  const values = (key: 'provider' | 'tier') => [...new Set(rows.map(row => row[key] === null ? null : String(row[key])))].sort((a, b) => (a ?? '').localeCompare(b ?? ''));
  const agents = store.db.prepare('SELECT DISTINCT thread_id,machine_id,parent_thread_id FROM sources WHERE workspace_id=? AND thread_id IS NOT NULL ORDER BY machine_id,thread_id').all(store.workspaceId).map(row => ({ id: String(row.thread_id), machineId: String(row.machine_id), parentId: row.parent_thread_id === null ? null : String(row.parent_thread_id) }));
  return { providers: values('provider'), serviceTiers: values('tier'), agents };
}
