import { randomUUID } from 'node:crypto';
import { InspectorStore, validateQuery } from './InspectorStore';
import { privacyVersion } from './project-privacy';
import { object, type UsageMeasurement } from '../accounting/codex-observations';
import { entryUsdEstimate, manualUsd, manualUsdPrice } from '../accounting/manual-usd';
import type { LedgerEntry, TotalExplanation, TotalExplanationPage, TotalExplanationRequest, TotalSourceRole } from '../shared/inspector';

interface MemberRef { id: string; revision: number; status: 'selected' | 'quarantined'; grain: LedgerEntry['grain']; }
interface SourceRef { id: string; role: TotalSourceRole; members: string[]; }
interface Snapshot { result: TotalExplanation; privacy: string; analysis: string; members: MemberRef[]; sources: SourceRef[]; }
const caches = new WeakMap<InspectorStore, Map<string, Snapshot>>();
const TTL = 20 * 60000; const PAGE_SIZE = 50;
function cache(store: InspectorStore): Map<string, Snapshot> {
  let result = caches.get(store); if (!result) { result = new Map(); caches.set(store, result); }
  for (const [id, value] of result) if (Date.parse(value.result.expiresAt) <= Date.now()) result.delete(id);
  return result;
}
export function explainTotal(store: InspectorStore, input: unknown): TotalExplanation {
  const value = object(input);
  if (!value || Object.keys(value).some(key => !['query','revision','usdPriceId','expectedTotal','expectedUsd'].includes(key)) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
    || value.usdPriceId !== undefined && value.usdPriceId !== null && (typeof value.usdPriceId !== 'string' || value.usdPriceId.length > 256)) throw new Error('INVALID_TOTAL_EXPLANATION');
  if (value.expectedTotal !== undefined && value.expectedTotal !== null && (typeof value.expectedTotal !== 'string' || !/^\d{1,19}$/.test(value.expectedTotal))) throw new Error('INVALID_TOTAL_EXPLANATION');
  if (value.expectedUsd !== undefined) { const usd = object(value.expectedUsd); if (!usd || Object.keys(usd).some(key => !['amount','upperAmount'].includes(key)) || ['amount','upperAmount'].some(key => usd[key] !== null && (typeof usd[key] !== 'string' || !/^\d{1,30}\.\d{12}$/.test(String(usd[key]))))) throw new Error('INVALID_TOTAL_EXPLANATION'); }
  const request = value as unknown as TotalExplanationRequest; const query = validateQuery(request.query);
  if (query.cursor || query.limit || query.includeQuarantined !== undefined) throw new Error('INVALID_TOTAL_SCOPE');
  if (store.revision() !== request.revision) throw new Error('TOTAL_REVISION_CHANGED');
  if (request.usdPriceId !== undefined && manualUsdPrice(store)?.id !== (request.usdPriceId ?? undefined)) throw new Error('TOTAL_PRICE_CHANGED');
  // Convert the moving day window to a fixed lower bound before all reads.
  if (query.days) { const cutoff = new Date(Date.now() - query.days * 86400000).toISOString(); query.from = query.from && query.from > cutoff ? query.from : cutoff; query.days = 0; }
  const filter = store.queryFilter(query, 'l');
  const members: MemberRef[] = []; const responses = new Map<string, MemberRef>(); let additional = 0;
  const memberSql = `SELECT l.id,l.revision,l.status,l.response_key,l.entry FROM scope_state a CROSS JOIN ledger l ON a.scope_id=l.scope_id AND a.active_revision=l.revision WHERE ${filter.sql}`;
  for (const row of store.db.prepare(memberSql).iterate(...filter.args)) {
    if (members.length >= 100000) throw new Error('TOTAL_MEMBERSHIP_LIMIT');
    const entry = JSON.parse(String(row.entry)) as LedgerEntry; const ref: MemberRef = { id: entry.id, revision: entry.revision, status: entry.selectionStatus, grain: entry.grain }; members.push(ref);
    if (row.response_key !== null) { responses.set(String(row.response_key), ref); additional += Math.max(0, entry.evidenceCount - 1); }
  }
  members.sort((a,b) => a.id.localeCompare(b.id)); const memberMap = new Map(members.map(ref => [ref.id, ref]));
  const linked = new Map<string, Set<string>>();
  for (const row of store.db.prepare(`WITH members AS (${memberSql}) SELECT k.observation_id,k.entry_id FROM members m JOIN ledger_links k ON k.entry_id=m.id AND k.revision=m.revision`).iterate(...filter.args)) {
    const id = String(row.observation_id); let refs = linked.get(id); if (!refs) { refs = new Set(); linked.set(id,refs); } refs.add(String(row.entry_id));
  }
  // Raw metadata uses its own timestamp/model attribution. Linked support also
  // includes interval endpoints outside that metadata scope, explicitly labeled.
  const raw = `SELECT u.*,json_extract(u.measurement,'$.identity.originMachineId') AS machine_id,json_extract(u.measurement,'$.identity.threadId') AS thread_id,
    json_object('identity',json_extract(u.measurement,'$.identity'),'model',json_extract(u.measurement,'$.model'),'endAt',u.timestamp) AS entry FROM usage_observations u`;
  const sources: SourceRef[] = []; const roles = new Map<TotalSourceRole, number>();
  const rawFilter = store.queryFilter(query, 'l');
  if (Number(store.db.prepare(`SELECT COUNT(*) AS n FROM (${raw}) l WHERE ${rawFilter.sql}`).get(...rawFilter.args)!.n) > 200000) throw new Error('TOTAL_SOURCE_LIMIT');
  const matched = new Set(store.db.prepare(`SELECT l.id FROM (${raw}) l WHERE ${rawFilter.sql}`).all(...rawFilter.args).map(row => String(row.id)));
  for (const row of store.db.prepare('SELECT id,observation_id,kind,response_key FROM usage_observations WHERE workspace_id=? ORDER BY id').iterate(store.workspaceId)) {
    const sourceMembers = [...(linked.get(String(row.observation_id)) ?? [])]; if (!matched.has(String(row.id)) && !sourceMembers.length) continue;
    if (sources.length >= 200000) throw new Error('TOTAL_SOURCE_LIMIT');
    const response = row.response_key === null ? undefined : responses.get(String(row.response_key));
    const role: TotalSourceRole = row.kind === 'response' ? response ? response.status === 'selected' ? 'response_support' : 'quarantined_response' : 'not_in_membership'
      : row.kind === 'thread_counter' && sourceMembers.some(id => memberMap.get(id)?.status === 'selected' && memberMap.get(id)?.grain !== 'response') ? 'counter_support'
      : row.kind === 'thread_counter' && sourceMembers.some(id => memberMap.get(id)?.status === 'quarantined' && memberMap.get(id)?.grain !== 'response') ? 'quarantined_counter' : 'control_only';
    sources.push({ id: String(row.id), role, members: sourceMembers }); roles.set(role, (roles.get(role) ?? 0) + 1);
  }
  const result: TotalExplanation = { snapshotId: randomUUID(), capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+TTL).toISOString(), query, revision: request.revision,
    summary: store.summary(query), usd: manualUsd(store, query), membershipCount: members.length, sourceMeasurementCount: sources.length, additionalResponseSupports: additional,
    roles: [...roles].map(([role, measurements]) => ({ role, measurements })) };
  if (request.expectedTotal !== undefined && result.summary.usage.total.value !== request.expectedTotal || request.expectedUsd && (result.usd.amount !== request.expectedUsd.amount || result.usd.upperAmount !== request.expectedUsd.upperAmount)) throw new Error('TOTAL_VALUE_CHANGED');
  const active = cache(store); while (active.size >= 4) active.delete(active.keys().next().value!);
  active.set(result.snapshotId, { result, privacy: privacyVersion(store), analysis: store.getSetting('timeline_analysis_epoch') ?? '0', members, sources }); return result;
}
export function explainTotalPage(store: InspectorStore, input: unknown): TotalExplanationPage {
  const value = object(input);
  if (!value || Object.keys(value).some(key => !['snapshotId','section','page','status'].includes(key)) || typeof value.snapshotId !== 'string' || value.snapshotId.length > 64
    || !['members','sources'].includes(String(value.section)) || !Number.isSafeInteger(value.page) || Number(value.page) < 0 || Number(value.page) > 4000
    || value.status !== undefined && !['selected','quarantined'].includes(String(value.status)) || value.section === 'sources' && value.status !== undefined) throw new Error('INVALID_TOTAL_PAGE');
  const snapshot = cache(store).get(value.snapshotId); if (!snapshot) throw new Error('TOTAL_SNAPSHOT_UNAVAILABLE');
  if (snapshot.privacy !== privacyVersion(store) || snapshot.analysis !== (store.getSetting('timeline_analysis_epoch') ?? '0')) { cache(store).delete(value.snapshotId); throw new Error('TOTAL_SNAPSHOT_INVALIDATED'); }
  const section = value.section as TotalExplanationPage['section']; const page = Number(value.page); const refs = section === 'members' ? snapshot.members.filter(ref => value.status === undefined || ref.status === value.status) : snapshot.sources;
  const result: TotalExplanationPage = { snapshotId: value.snapshotId, section, page, total: refs.length, hasNext: (page+1)*PAGE_SIZE < refs.length, members: [], sources: [] };
  const selected = refs.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
  if (section === 'members') for (const ref of selected as MemberRef[]) {
    const row = store.db.prepare('SELECT p.entry FROM ledger_memberships l JOIN ledger_payloads p ON p.id=l.payload_id WHERE l.workspace_id=? AND l.id=? AND l.revision=?').get(store.workspaceId, ref.id, ref.revision);
    if (!row) throw new Error('TOTAL_SNAPSHOT_INVALIDATED');
    const entry = { ...JSON.parse(String(row.entry)), revision: ref.revision } as LedgerEntry;
    const estimate = ref.status === 'selected' && snapshot.result.usd.price ? entryUsdEstimate(entry, snapshot.result.usd.price) : { reason: ref.status === 'selected' ? 'CONVERSION_DISABLED' : 'QUARANTINED_NOT_PRICED' };
    result.members.push({ entry, usdUnits: 'reason' in estimate ? null : estimate.lower.toString(), usdUpperUnits: 'reason' in estimate ? null : estimate.upper.toString(), unpricedReason: 'reason' in estimate ? estimate.reason : null });
  } else for (const ref of selected as SourceRef[]) {
    const row = store.db.prepare(`SELECT u.measurement,u.kind,u.timestamp,u.evidence_ref,u.source_id,s.machine_id FROM usage_observations u JOIN sources s ON s.id=u.source_id AND s.workspace_id=u.workspace_id WHERE u.workspace_id=? AND u.id=?`).get(store.workspaceId, ref.id);
    if (!row) throw new Error('TOTAL_SNAPSHOT_INVALIDATED'); const m = JSON.parse(String(row.measurement)) as UsageMeasurement;
    result.sources.push({ id: ref.id, evidenceRef: String(row.evidence_ref), sourceId: String(row.source_id), recordingMachineId: String(row.machine_id), timestamp: row.timestamp === null ? null : String(row.timestamp), kind: String(row.kind), role: ref.role,
      values: m.values, nativeTotal: m.nativeTotal, issues: m.issues, memberIds: ref.members.slice(0,20), memberCount: ref.members.length });
  }
  return result;
}
