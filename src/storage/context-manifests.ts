import { randomUUID } from 'node:crypto';
import { InspectorStore, validateQuery, withinDates } from './InspectorStore';
import { digest, object } from '../accounting/codex-observations';
import { integer, metric } from '../accounting/integers';
import { contextFacets } from '../accounting/context-facets';
import type { LedgerEntry } from '../shared/inspector';
import { CONTEXT_ORIGINS, type ContextFacets, type ContextItem, type ContextManifest, type ContextResult, type ManifestConsent, type ManifestsView, type ManifestView } from '../shared/context-manifests';

function record(value: unknown, keys: string[]): Record<string, unknown> {
  const input = object(value);
  if (!input || Object.keys(input).some(key => !keys.includes(key))) throw new Error('INVALID_MANIFEST');
  return input;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.:-]{1,256}$/.test(value)) throw new Error('INVALID_MANIFEST');
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('INVALID_MANIFEST');
  if (new Date(value).toISOString() !== value) throw new Error('INVALID_MANIFEST');
  return value;
}
function item(value: unknown, order: number, version: 1 | 2): ContextItem {
  const input = record(value, ['id', 'order', 'origin', 'bytes', 'estimate', 'operations', ...(version === 2 ? ['facets'] : [])]);
  if (input.order !== order || !['instructions', 'user', 'history', 'tool', 'file', 'other'].includes(String(input.origin))) throw new Error('INVALID_MANIFEST');
  let estimate: ContextItem['estimate'] = null;
  if (input.estimate !== null) {
    const next = record(input.estimate, ['tokens', 'tokenizer', 'version']);
    estimate = { tokens: integer(next.tokens), tokenizer: id(next.tokenizer), version: id(next.version) };
  }
  if (!Array.isArray(input.operations) || input.operations.length > 20) throw new Error('INVALID_MANIFEST');
  const operations: ContextItem['operations'] = input.operations.map(value => {
    const next = record(value, ['kind', 'beforeBytes', 'afterBytes']);
    if (!['truncated', 'summarized'].includes(String(next.kind))) throw new Error('INVALID_MANIFEST');
    return { kind: next.kind as 'truncated' | 'summarized', beforeBytes: integer(next.beforeBytes), afterBytes: integer(next.afterBytes) };
  });
  const detail = version === 2 ? contextFacets(input.facets) : undefined;
  const bytes = detail?.media !== 'text' && detail ? input.bytes === null ? null : integer(input.bytes) : integer(input.bytes);
  if (detail && detail.media !== 'text' && estimate !== null || detail && !detail.included && (bytes !== '0' || estimate !== null)) throw new Error('INVALID_MANIFEST');
  if (operations.some((op, index) => index > 0 && op.beforeBytes !== operations[index - 1].afterBytes) || operations.length && operations.at(-1)!.afterBytes !== bytes) throw new Error('INVALID_MANIFEST');
  if (detail?.originalBytes !== null && detail?.originalBytes !== undefined && operations.length && detail.originalBytes !== operations[0].beforeBytes) throw new Error('INVALID_MANIFEST');
  return { id: id(input.id), order, origin: input.origin as ContextItem['origin'], bytes, estimate, operations, ...(detail ? { facets: detail } : {}) };
}

export function setManifestConsent(store: InspectorStore, enabled: unknown): void {
  if (typeof enabled !== 'boolean') throw new Error('INVALID_MANIFEST_CONSENT');
  const consent: ManifestConsent | null = enabled ? { id: randomUUID(), workspaceId: store.workspaceId, machineId: store.machineId,
    approvedAt: new Date().toISOString(), boundary: 'owned_client', metadataOnly: true } : null;
  store.setSetting('context_manifest_consent', JSON.stringify(consent));
  store.audit(enabled ? 'manifest.enable' : 'manifest.disable', store.workspaceId);
}
function consent(store: InspectorStore): ManifestConsent | null { return JSON.parse(store.getSetting('context_manifest_consent') ?? 'null') as ManifestConsent | null; }

/** An explicitly chosen JSON bundle contains metadata only; unknown fields are rejected. */
export function importManifests(store: InspectorStore, value: unknown): { imported: number } {
  const approved = consent(store); if (!approved) throw new Error('MANIFESTS_DISABLED');
  const bundle = record(value, ['schema', 'records']);
  if (bundle.schema !== 'owned-context-bundle/1' || !Array.isArray(bundle.records) || !bundle.records.length || bundle.records.length > 200 || Buffer.byteLength(JSON.stringify(bundle)) > 2 * 1024 * 1024) throw new Error('INVALID_MANIFEST');
  let imported = 0;
  store.db.exec('BEGIN IMMEDIATE');
  try {
    for (const value of bundle.records) {
      const schema = object(value)?.schema; const isManifest = schema === 'owned-context/1' || schema === 'owned-context/2';
      const input = record(value, isManifest ? ['schema', 'clientId', 'requestId', 'consentId', 'workspaceId', 'machineId', 'threadId', 'turnId', 'capturedAt', 'capture', 'items', ...(schema === 'owned-context/2' ? ['contextEpoch'] : [])]
        : ['schema', 'clientId', 'requestId', 'consentId', 'completedAt', 'status', 'responseId']);
      if (input.consentId !== approved.id) throw new Error('MANIFEST_CONSENT_MISMATCH');
      const clientId = id(input.clientId); const requestId = id(input.requestId);
      let normalized: ContextManifest | ContextResult;
      if (isManifest) {
        if (input.workspaceId !== store.workspaceId || input.machineId !== store.machineId || input.capture !== 'client_visible_before_send' || !Array.isArray(input.items) || input.items.length > 2000) throw new Error('INVALID_MANIFEST');
        const threadId = id(input.threadId);
        if (store.db.prepare(`SELECT 1 FROM sources s JOIN project_source_links p ON p.workspace_id=s.workspace_id AND p.source_id=s.id JOIN project_policies c ON c.workspace_id=p.workspace_id AND c.project_id=p.project_id WHERE s.workspace_id=? AND s.machine_id=? AND s.thread_id=? AND json_extract(c.record,'$.excluded')=1 LIMIT 1`).get(store.workspaceId, store.machineId, threadId)) throw new Error('MANIFEST_PROJECT_EXCLUDED');
        if (store.db.prepare('SELECT 1 FROM context_exclusions WHERE workspace_id=? AND machine_id=? AND thread_id=?').get(store.workspaceId, store.machineId, threadId)) throw new Error('MANIFEST_RUN_EXCLUDED');
        const items = input.items.map((value, order) => item(value, order, schema === 'owned-context/2' ? 2 : 1));
        if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('INVALID_MANIFEST');
        integer(items.reduce((sum, item) => sum + BigInt(item.bytes ?? '0'), 0n));
        integer(items.reduce((sum, item) => sum + BigInt(item.estimate?.tokens ?? '0'), 0n));
        const capturedAt = timestamp(input.capturedAt);
        if (capturedAt < approved.approvedAt) throw new Error('MANIFEST_CONSENT_MISMATCH');
        normalized = { schema: schema as ContextManifest['schema'], clientId, requestId, consentId: approved.id, workspaceId: store.workspaceId, machineId: store.machineId,
          threadId, turnId: input.turnId === null ? null : id(input.turnId), capturedAt, capture: 'client_visible_before_send', items,
          ...(schema === 'owned-context/2' ? { contextEpoch: input.contextEpoch === null ? null : id(input.contextEpoch) } : {}) };
      } else {
        if (input.schema !== 'owned-result/1' || !['completed', 'failed', 'cancelled'].includes(String(input.status))) throw new Error('INVALID_MANIFEST');
        const before = store.db.prepare("SELECT record FROM context_records WHERE workspace_id=? AND client_id=? AND request_id=? AND kind='manifest'").get(store.workspaceId, clientId, requestId);
        if (!before) throw new Error('MANIFEST_REQUEST_MISSING');
        const manifest = JSON.parse(String(before.record)) as ContextManifest;
        const completedAt = timestamp(input.completedAt);
        if (manifest.consentId !== approved.id || completedAt < manifest.capturedAt || input.status !== 'completed' && input.responseId !== null) throw new Error('INVALID_MANIFEST');
        normalized = { schema: 'owned-result/1', clientId, requestId, consentId: approved.id, completedAt,
          status: input.status as ContextResult['status'], responseId: input.responseId === null ? null : id(input.responseId) };
      }
      const kind = isManifest ? 'manifest' : 'result'; const body = JSON.stringify(normalized); const hash = digest(body);
      const existing = store.db.prepare('SELECT digest FROM context_records WHERE workspace_id=? AND client_id=? AND request_id=? AND kind=?').get(store.workspaceId, clientId, requestId, kind);
      if (existing) { if (existing.digest !== hash) throw new Error('MANIFEST_ID_CONFLICT'); continue; }
      store.db.prepare('INSERT INTO context_records VALUES(?,?,?,?,?,?,?)').run(store.workspaceId, clientId, requestId, kind, hash, body, new Date().toISOString()); imported++;
    }
    store.audit('manifest.import', String(imported)); store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  return { imported };
}

function view(store: InspectorStore, manifest: ContextManifest): ManifestView {
  const key = `manifest:${digest(`${manifest.clientId}:${manifest.requestId}`)}`;
  const row = store.db.prepare("SELECT record FROM context_records WHERE workspace_id=? AND client_id=? AND request_id=? AND kind='result'").get(store.workspaceId, manifest.clientId, manifest.requestId);
  const result = row ? JSON.parse(String(row.record)) as ContextResult : null;
  const included = manifest.items.filter(item => item.facets?.included !== false);
  const tokenizers = new Set(included.filter(item => item.estimate).map(item => `${item.estimate!.tokenizer}:${item.estimate!.version}`));
  const nontext = included.some(item => item.facets && item.facets.media !== 'text');
  const complete = !nontext && included.every(item => item.estimate !== null) && tokenizers.size <= 1;
  const known = tokenizers.size <= 1 ? integer(included.reduce((sum, item) => sum + BigInt(item.estimate?.tokens ?? '0'), 0n)) : null;
  const estimate = complete ? known : null;
  const visibleEstimate = metric(estimate, 'estimated', 'tokenizer', [key], ['Client-visible items only; server additions and cache spans are unobserved.', ...(!complete ? ['A common tokenizer estimate is missing.'] : [])]);
  let matches: LedgerEntry[] = [];
  if (result?.status === 'completed' && result.responseId) {
    const query = store.db.prepare(`SELECT l.entry FROM ledger l JOIN scope_state s ON s.scope_id=l.scope_id AND s.active_revision=l.revision
      WHERE l.workspace_id=? AND l.machine_id=? AND l.thread_id=? AND json_extract(l.entry,'$.identity.responseId')=?
      ${manifest.turnId ? "AND json_extract(l.entry,'$.identity.turnId')=?" : ''} LIMIT 2`);
    matches = query.all(store.workspaceId, manifest.machineId, manifest.threadId, result.responseId, ...(manifest.turnId ? [manifest.turnId] : [])).map(row => JSON.parse(String(row.entry)) as LedgerEntry);
  }
  const matched = matches.length === 1 ? matches[0] : null;
  const duplicateResult = matched && result?.responseId ? Number(store.db.prepare(`SELECT COUNT(*) AS n FROM context_records r JOIN context_records m ON m.workspace_id=r.workspace_id AND m.client_id=r.client_id AND m.request_id=r.request_id AND m.kind='manifest'
    WHERE r.workspace_id=? AND r.kind='result' AND json_extract(r.record,'$.status')='completed' AND json_extract(r.record,'$.responseId')=?
    AND json_extract(m.record,'$.machineId')=? AND json_extract(m.record,'$.threadId')=? AND (json_extract(m.record,'$.turnId') IS NULL OR json_extract(m.record,'$.turnId') IS ?)`)
    .get(store.workspaceId, result.responseId, manifest.machineId, manifest.threadId, matched.identity.turnId)!.n) > 1 : false;
  const linkage = !result ? 'pending' : result.status !== 'completed' ? result.status : matches.length > 1 || duplicateResult ? 'ambiguous' : !matched ? 'usage_missing' : matched.selectionStatus !== 'selected' ? 'conflicted' : 'matched';
  const observedInput = linkage === 'matched' ? matched!.usage.input : metric(null, linkage === 'conflicted' ? 'conflicted' : 'unknown', 'provider_response');
  const categories: ManifestView['categories'] = [];
  const legacyOrigin = { instructions: 'visible_instruction', user: 'user_instruction', history: 'unknown', tool: 'unknown', file: 'project_file', other: 'other' } as const;
  for (const origin of CONTEXT_ORIGINS) {
    const items = included.filter(item => (item.facets?.origin ?? legacyOrigin[item.origin]) === origin); if (!items.length) continue;
    const valid = items.every(item => item.estimate !== null) && tokenizers.size <= 1;
    categories.push({ origin, items: items.length, bytes: items.every(item => item.bytes !== null) ? integer(items.reduce((sum, item) => sum + BigInt(item.bytes!), 0n)) : null,
      estimate: metric(valid ? integer(items.reduce((sum, item) => sum + BigInt(item.estimate!.tokens), 0n)) : null, 'estimated', 'tokenizer', [key], ['One primary origin per included occurrence; no allocation of aggregate cache to items.']) });
  }
  return { id: key, manifest, result, linkage, visibleEstimate, observedInput,
    discrepancy: estimate !== null && observedInput.value !== null ? (BigInt(observedInput.value) - BigInt(estimate)).toString() : null,
    ledgerEntryId: matched?.id ?? null, evidenceRefs: matched?.evidenceRefs ?? [], categories,
    knownTextEstimate: metric(known, known === null ? 'unknown' : 'estimated', 'tokenizer', [key], ['Known text subtotal; missing/nontext items and server additions are not zero. Mixed tokenizers are not combined.']),
    reconstructionState: nontext ? 'nontext_unestimated' : tokenizers.size > 1 ? 'mixed_tokenizers' : complete ? 'complete_estimate' : 'partial' };
}

export function manifests(store: InspectorStore, queryValue: unknown = {}): ManifestsView {
  const query = validateQuery(queryValue); const approved = consent(store); const limit = query.limit ?? 20;
  const filter = digest(JSON.stringify({ ...query, cursor: undefined, limit: undefined }));
  let after = 0;
  if (query.cursor) {
    let cursor; try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); } catch { throw new Error('INVALID_CURSOR'); }
    if (cursor.filter !== filter || !Number.isSafeInteger(cursor.after) || cursor.after < 0) throw new Error('INVALID_CURSOR'); after = cursor.after;
  }
  const threads = query.runId || query.agentId && query.agentMode === 'inclusive' ? new Set([query.agentId ?? query.runId, ...store.sources({ runId: query.runId, agentId: query.agentId, agentMode: query.agentMode, machineId: query.machineId }).map(source => source.threadId)]) : null;
  const matches: { rowid: number; value: ManifestView }[] = [];
  for (const row of store.db.prepare("SELECT rowid,record FROM context_records WHERE workspace_id=? AND kind='manifest' AND rowid>? ORDER BY rowid").iterate(store.workspaceId, after)) {
    const manifest = JSON.parse(String(row.record)) as ContextManifest;
    if (query.machineId && manifest.machineId !== query.machineId || query.agentId && query.agentMode !== 'inclusive' && manifest.threadId !== query.agentId || threads && !threads.has(manifest.threadId)
      || !withinDates(manifest.capturedAt, query)) continue;
    const value = view(store, manifest);
    if (query.requestedModel || query.attributedModel || query.projectId || query.provider !== undefined || query.serviceTier !== undefined || query.agentId && query.agentMode === 'inclusive') {
      const filter = store.queryFilter({ ...query, days: undefined, from: undefined, to: undefined }, 'l');
      const linked = value.ledgerEntryId ? store.db.prepare(`SELECT 1 FROM scope_state a CROSS JOIN ledger l ON a.scope_id=l.scope_id AND a.active_revision=l.revision WHERE ${filter.sql} AND l.id=?`).get(...filter.args, value.ledgerEntryId) : null;
      if (!linked) continue;
    }
    matches.push({ rowid: Number(row.rowid), value }); if (matches.length > limit) break;
  }
  const selected = matches.slice(0, limit);
  return { enabled: !!approved, consent: approved, revision: store.revision(), items: selected.map(item => item.value),
    nextCursor: matches.length > limit ? Buffer.from(JSON.stringify({ filter, after: selected.at(-1)!.rowid })).toString('base64url') : null,
    notes: ['Opt-in metadata from an owned client; passive Desktop sessions are not intercepted.',
      'Request/response matching uses client identity, exact thread/turn/response IDs and the active ledger; it does not add usage.',
      'Client-visible estimates and provider input may differ. Negative differences are discrepancies, not negative hidden context or measured savings.'] };
}
