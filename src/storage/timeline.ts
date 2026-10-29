import { timelineLaneSql } from './timeline-lanes';
import type { SQLInputValue } from 'node:sqlite';
import { InspectorStore, validateQuery } from './InspectorStore';
import { digest, object, timestamp, type NormalizedObservation } from '../accounting/codex-observations';
import { integer } from '../accounting/integers';
import { privacyVersion } from './project-privacy';
import type { TimelineQuery, TimelinePage, TimelineEvent, TimelineState } from '../shared/inspector';

const extraKeys = ['lane', 'search', 'eventKind', 'toolName', 'fileIdentity', 'callId', 'findingId', 'evidenceRef', 'includeUnknownTime', 'order', 'direction'];
function queryValue(input: unknown): TimelineQuery {
  const value = input === undefined ? {} : object(input); if (!value) throw new Error('INVALID_TIMELINE_QUERY');
  const base = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'cursor' && !extraKeys.includes(key))); const query: TimelineQuery = validateQuery(base);
  if (value.cursor !== undefined) { if (typeof value.cursor !== 'string' || !value.cursor || value.cursor.length > 32768) throw new Error('INVALID_CURSOR'); query.cursor = value.cursor; }
  for (const key of ['search', 'eventKind', 'toolName', 'fileIdentity', 'callId', 'findingId', 'evidenceRef'] as const) {
    if (value[key] === undefined || value[key] === '') continue;
    if (typeof value[key] !== 'string' || value[key].length > (key === 'search' ? 256 : 512) || /[\x00-\x1f]/.test(value[key])) throw new Error('INVALID_TIMELINE_QUERY'); query[key] = value[key].trim();
  }
  if (value.lane !== undefined) { if (!['usage','tools','messages','errors','compaction','gaps','other'].includes(String(value.lane))) throw new Error('INVALID_TIMELINE_QUERY'); query.lane = value.lane as TimelineQuery['lane']; }
  if (query.fileIdentity && !/^[a-f0-9]{64}$/.test(query.fileIdentity) || query.findingId && !/^finding:[a-f0-9]{64}$/.test(query.findingId) || query.evidenceRef && !/^evidence:[a-f0-9]{64}$/.test(query.evidenceRef)) throw new Error('INVALID_TIMELINE_QUERY');
  for (const key of ['from', 'to'] as const) if (value[key] !== undefined && value[key] !== '') { const at = timestamp(value[key]); if (!at) throw new Error('INVALID_TIMELINE_TIME'); query[key] = at; }
  if (query.from && query.to && query.from >= query.to) throw new Error('INVALID_TIMELINE_TIME');
  if (value.includeUnknownTime !== undefined && typeof value.includeUnknownTime !== 'boolean') throw new Error('INVALID_TIMELINE_QUERY');
  query.includeUnknownTime = value.includeUnknownTime as boolean | undefined ?? !(query.days || query.from || query.to);
  for (const [key, allowed, fallback] of [['order', ['source', 'time'], 'source'], ['direction', ['asc', 'desc'], 'asc'], ['agentMode', ['exclusive', 'inclusive'], 'exclusive']] as const) { if (value[key] !== undefined && !allowed.includes(value[key] as never)) throw new Error('INVALID_TIMELINE_QUERY'); query[key] = (value[key] ?? fallback) as never; }
  return query;
}

interface Snapshot { watermark: string; revision: number; privacy: string; analysis: string; at: string; cutoff: string | null; findingRefs: string[] | null; }
interface Cursor extends Snapshot { hash: string; after: string; time: string | null; missing: boolean; begin?: true; }
const cachedScopes = new WeakMap<InspectorStore['db'], string>();
export function timelineState(store: InspectorStore): TimelineState { return { watermark: String(store.db.prepare('SELECT CAST(COALESCE(MAX(sequence),0) AS TEXT) AS n FROM timeline_events WHERE workspace_id=?').get(store.workspaceId)!.n), privacyVersion: privacyVersion(store), analysisEpoch: store.getSetting('timeline_analysis_epoch') ?? '0' }; }
function snapshot(store: InspectorStore, query: TimelineQuery, now: number): Snapshot {
  let findingRefs: string[] | null = null;
  if (query.findingId) { const row = store.db.prepare('SELECT record FROM incidents WHERE workspace_id=? AND id=?').get(store.workspaceId, query.findingId); if (!row) throw new Error('FINDING_NOT_RETAINED'); const refs = object(JSON.parse(String(row.record)))?.evidenceRefs; if (!Array.isArray(refs) || refs.length > 100 || refs.some(id => typeof id !== 'string' || !/^evidence:[a-f0-9]{64}$/.test(id))) throw new Error('FINDING_EVIDENCE_UNAVAILABLE'); findingRefs = refs; }
  return { watermark: String(store.db.prepare('SELECT CAST(COALESCE(MAX(sequence),0) AS TEXT) AS n FROM timeline_events WHERE workspace_id=?').get(store.workspaceId)!.n), revision: store.revision(), privacy: privacyVersion(store), analysis: store.getSetting('timeline_analysis_epoch') ?? '0', at: new Date(now).toISOString(), cutoff: query.days ? new Date(now - query.days * 86400000).toISOString() : null, findingRefs };
}

export function timeline(store: InspectorStore, input: unknown = {}, now = Date.now()): TimelinePage {
  const query = queryValue(input); const identity = { ...query, cursor: undefined, limit: undefined }; const hash = digest(JSON.stringify(identity));
  let state: Snapshot; let cursor: Cursor | undefined;
  if (query.cursor) {
    if (query.cursor.length > 32768) throw new Error('INVALID_CURSOR');
    try { const value = object(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'))); if (!value || value.hash !== hash || typeof value.after !== 'string' || typeof value.watermark !== 'string' || !Number.isInteger(value.revision) || typeof value.at !== 'string' || typeof value.privacy !== 'string' || typeof value.analysis !== 'string' || typeof value.missing !== 'boolean' || value.time !== null && typeof value.time !== 'string' || value.cutoff !== null && typeof value.cutoff !== 'string' || value.findingRefs !== null && (!Array.isArray(value.findingRefs) || value.findingRefs.length > 100 || value.findingRefs.some(ref => typeof ref !== 'string' || !/^evidence:[a-f0-9]{64}$/.test(ref)))) throw new Error('INVALID_CURSOR'); integer(value.after); integer(value.watermark); cursor = value as unknown as Cursor; }
    catch { throw new Error('INVALID_CURSOR'); }
    if (cursor.privacy !== privacyVersion(store) || cursor.analysis !== (store.getSetting('timeline_analysis_epoch') ?? '0')) throw new Error('TIMELINE_SNAPSHOT_INVALIDATED');
    if (BigInt(cursor.after) > BigInt(cursor.watermark) || cursor.begin !== undefined && cursor.begin !== true || cursor.missing !== (cursor.time === null)) throw new Error('INVALID_CURSOR');
    state = { watermark: cursor.watermark, revision: cursor.revision, privacy: cursor.privacy, analysis: cursor.analysis, at: cursor.at, cutoff: cursor.cutoff, findingRefs: cursor.findingRefs };
  } else state = snapshot(store, query, now);
  const args: SQLInputValue[] = [store.workspaceId, BigInt(state.watermark)]; const parts = ['e.workspace_id=?', 'e.sequence<=?'];
  const equal = (column: string, value: string | null | undefined) => { if (value !== undefined) { parts.push(`${column}${value === null ? ' IS NULL' : '=?'}`); if (value !== null) args.push(value); } };
  equal('e.machine_id', query.machineId); equal('e.project_id', query.projectId); equal('e.requested_model', query.requestedModel); equal('COALESCE(e.observed_model,e.requested_model)', query.attributedModel);
  equal('e.kind', query.eventKind); equal('e.tool_name', query.toolName); equal('e.file_identity', query.fileIdentity); equal('e.call_id', query.callId); equal('e.provider', query.provider); equal('e.service_tier', query.serviceTier);
  equal('o.evidence_ref', query.evidenceRef);
  let cte = ''; const treeNames: string[] = [];
  const subtree = (id: string, name: string) => {
    treeNames.push(name);
    if (!cte) cte = `WITH RECURSIVE ancestry AS MATERIALIZED (SELECT e.machine_id,e.thread_id,e.parent_thread_id FROM timeline_events e JOIN (SELECT machine_id,thread_id,MAX(sequence) AS last_sequence FROM timeline_events WHERE workspace_id=? AND sequence<=? AND thread_id IS NOT NULL GROUP BY machine_id,thread_id) latest ON latest.last_sequence=e.sequence)`;
    cte += `,${name}(machine_id,thread_id) AS (SELECT machine_id,thread_id FROM ancestry WHERE thread_id=? UNION SELECT a.machine_id,a.thread_id FROM ancestry a JOIN ${name} d ON a.machine_id=d.machine_id AND a.parent_thread_id=d.thread_id)`;
    parts.push(`(EXISTS(SELECT 1 FROM ${name} d WHERE d.machine_id=e.machine_id AND d.thread_id=e.thread_id) OR e.thread_id IS NULL AND EXISTS(SELECT 1 FROM timeline_events known JOIN ${name} d ON d.machine_id=known.machine_id AND d.thread_id=known.thread_id WHERE known.workspace_id=e.workspace_id AND known.source_id=e.source_id AND known.sequence<=?))`); args.push(BigInt(state.watermark));
  };
  const treeArgs: SQLInputValue[] = [];
  if (query.runId) { subtree(query.runId, 'run_tree'); treeArgs.push(query.runId); }
  if (query.agentId) { if (query.agentMode === 'inclusive') { subtree(query.agentId, 'agent_tree'); treeArgs.push(query.agentId); } else equal('e.thread_id', query.agentId); }
  if (cte) treeArgs.unshift(store.workspaceId, BigInt(state.watermark));
  const from = query.from && state.cutoff ? query.from > state.cutoff ? query.from : state.cutoff : query.from ?? state.cutoff;
  const to = query.to ?? (query.days ? state.at : null); const times: string[] = []; const timeArgs: SQLInputValue[] = [];
  if (from) { times.push('e.timestamp>=?'); timeArgs.push(from); } if (to) { times.push('e.timestamp<?'); timeArgs.push(to); }
  if (times.length) { parts.push(`(${times.join(' AND ')}${query.includeUnknownTime ? ' OR e.timestamp IS NULL' : ''})`); args.push(...timeArgs); } else if (!query.includeUnknownTime) parts.push('e.timestamp IS NOT NULL');
  for (const term of query.search?.toLowerCase().split(/\s+/).filter(Boolean) ?? []) { parts.push('instr(e.search_metadata,?)>0'); args.push(term); }
  if (state.findingRefs !== null) { parts.push(state.findingRefs.length ? `o.evidence_ref IN (${state.findingRefs.map(() => '?').join(',')})` : '0'); args.push(...state.findingRefs); }
  const categoryFilter = parts.join(' AND ');
  const metadataJoin = query.evidenceRef || state.findingRefs !== null ? 'JOIN observations o ON o.id=e.observation_id' : '';
  const scopeKey = JSON.stringify([store.workspaceId, hash, state.watermark, state.revision, state.privacy, state.analysis, state.cutoff, query.days ? state.at : null, state.findingRefs]);
  if (cachedScopes.get(store.db) !== scopeKey) {
    cachedScopes.delete(store.db);
    store.db.exec(`CREATE TEMP TABLE IF NOT EXISTS timeline_scope_cache(name TEXT NOT NULL,machine_id TEXT NOT NULL,thread_id TEXT NOT NULL,PRIMARY KEY(name,machine_id,thread_id)) WITHOUT ROWID;
      CREATE TEMP TABLE IF NOT EXISTS timeline_facet_cache(machine_id TEXT NOT NULL,thread_id TEXT,kind TEXT NOT NULL,lane TEXT NOT NULL,n INTEGER NOT NULL,missing INTEGER NOT NULL);
      DELETE FROM timeline_scope_cache; DELETE FROM timeline_facet_cache;`);
    if (cte) store.db.prepare(`${cte} INSERT INTO timeline_scope_cache ${treeNames.map(name => `SELECT '${name}',machine_id,thread_id FROM ${name}`).join(' UNION ALL ')}`).run(...treeArgs);
  }
  cte = treeNames.length ? `WITH ${treeNames.map(name => `${name} AS (SELECT machine_id,thread_id FROM timeline_scope_cache WHERE name='${name}')`).join(',')}` : '';
  treeArgs.length = 0;
  if (cachedScopes.get(store.db) !== scopeKey) {
    store.db.prepare(`${cte} INSERT INTO timeline_facet_cache SELECT e.machine_id,e.thread_id,e.kind,${timelineLaneSql('e')} AS lane,COUNT(*) AS n,SUM(e.timestamp IS NULL) AS missing FROM timeline_events e ${metadataJoin} WHERE ${categoryFilter} GROUP BY e.machine_id,e.thread_id,e.kind,lane`).run(...args);
    cachedScopes.set(store.db, scopeKey);
  }
  if (query.lane) { parts.push(`${timelineLaneSql('e')}=?`); args.push(query.lane); }
  const filter = parts.join(' AND '); const allArgs = [...treeArgs, ...args];
  const laneFilter = query.lane ? 'WHERE lane=?' : ''; const laneArgs: SQLInputValue[] = query.lane ? [query.lane] : [];
  const counts = store.db.prepare(`SELECT COALESCE(SUM(n),0) AS n,COALESCE(SUM(missing),0) AS missing FROM timeline_facet_cache ${laneFilter}`).get(...laneArgs)!;
  const kinds = store.db.prepare(`SELECT DISTINCT kind FROM timeline_facet_cache ${laneFilter} ORDER BY kind`).all(...laneArgs).map(row => String(row.kind));
  const agents = store.db.prepare(`SELECT machine_id,thread_id,SUM(n) AS n FROM timeline_facet_cache ${laneFilter} GROUP BY machine_id,thread_id ORDER BY n DESC LIMIT 100`).all(...laneArgs).map(row => ({ id: row.thread_id === null ? '(unknown)' : String(row.thread_id), machineId: String(row.machine_id), events: Number(row.n) }));
  const laneCounts = store.db.prepare('SELECT lane,SUM(n) AS n FROM timeline_facet_cache GROUP BY lane ORDER BY lane').all().map(row => ({ lane: String(row.lane) as NonNullable<TimelineQuery['lane']>, events: Number(row.n) }));
  const direction = query.direction === 'desc' ? 'DESC' : 'ASC'; const operator = query.direction === 'desc' ? '<' : '>';
  const pageParts: string[] = []; const pageArgs: SQLInputValue[] = [];
  if (cursor && !cursor.begin) {
    if (query.order === 'source') { pageParts.push(`e.sequence${operator}?`); pageArgs.push(BigInt(cursor.after)); }
    else if (cursor.missing) { pageParts.push(`e.timestamp IS NULL AND e.sequence${operator}?`); pageArgs.push(BigInt(cursor.after)); }
    else { pageParts.push(`(e.timestamp IS NULL OR e.timestamp${operator}? OR e.timestamp=? AND e.sequence${operator}?)`); pageArgs.push(cursor.time, cursor.time, BigInt(cursor.after)); }
  }
  const order = query.order === 'source' ? `e.sequence ${direction}` : `(e.timestamp IS NULL) ASC,e.timestamp ${direction},e.sequence ${direction}`;
  const limit = query.limit ?? 200;
  const rows = store.db.prepare(`${cte} SELECT e.*,${timelineLaneSql('e')} AS event_lane,CAST(e.sequence AS TEXT) AS sequence_text,o.evidence_ref,o.byte_start,o.byte_end,o.line,COALESCE(a.normalized,o.normalized) AS normalized FROM timeline_events e JOIN observations o ON o.id=e.observation_id LEFT JOIN source_analysis r ON r.source_id=e.source_id LEFT JOIN observation_analyses a ON a.observation_id=o.id AND a.revision=r.revision WHERE ${filter}${pageParts.length ? ` AND ${pageParts.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ?`).all(...allArgs, ...pageArgs, limit + 1);
  const scopeRevisions = new Map<string, number>();
  const items: TimelineEvent[] = rows.slice(0, limit).map(row => {
    const n = JSON.parse(String(row.normalized)) as NormalizedObservation;
    const scope = String(row.scope_id); let scopeRevision = scopeRevisions.get(scope);
    if (scopeRevision === undefined) { scopeRevision = Number(store.db.prepare('SELECT COALESCE(MAX(revision),0) AS n FROM ledger_memberships WHERE workspace_id=? AND scope_id=? AND revision<=?').get(store.workspaceId, scope, state.revision)!.n); scopeRevisions.set(scope, scopeRevision); }
    const ledger = store.db.prepare(`SELECT l.id,l.status,p.entry FROM ledger_links k JOIN ledger_memberships l ON l.id=k.entry_id AND l.revision=k.revision JOIN ledger_payloads p ON p.id=l.payload_id WHERE k.observation_id=? AND k.revision=? AND k.relation='support' AND l.workspace_id=? ORDER BY l.id LIMIT 20`).all(row.observation_id, scopeRevision, store.workspaceId).map(member => { const entry = JSON.parse(String(member.entry)); return { id: String(member.id), grain: String(entry.grain), total: entry.usage.total.value as string | null, status: String(member.status) }; });
    const optional = (key: string) => row[key] === null ? null : String(row[key]);
    return { lane: String(row.event_lane) as NonNullable<TimelineQuery['lane']>, id: String(row.observation_id), sourceId: String(row.source_id), machineId: String(row.machine_id), sequence: String(row.sequence_text), generation: Number(row.generation), threadId: optional('thread_id'), timestamp: optional('timestamp'), kind: String(row.kind), evidenceRef: String(row.evidence_ref), byteStart: String(row.byte_start), byteEnd: String(row.byte_end), line: Number(row.line), supported: n.supported, projectId: optional('project_id'), requestedModel: optional('requested_model'), observedModel: optional('observed_model'), provider: optional('provider'), serviceTier: optional('service_tier'), turnId: optional('turn_id'), toolName: optional('tool_name'), callId: optional('call_id'), fileIdentity: optional('file_identity'), operation: n.metadata.operation ?? null, issues: n.issues, sourceUsage: n.measurements.map(m => ({ kind: m.kind, total: m.values.total, input: m.values.input, output: m.values.output })), ledger };
  });
  const last = items.at(-1); const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({ ...state, hash, after: last.sequence, time: last.timestamp, missing: last.timestamp === null })).toString('base64url') : null;
  const retainedGaps = Number(store.db.prepare('SELECT COUNT(*) AS n FROM usage_retention_gaps WHERE workspace_id=?').get(store.workspaceId)!.n);
  const excludedSources = Number(store.db.prepare('SELECT COUNT(*) AS n FROM source_tombstones WHERE workspace_id=?').get(store.workspaceId)!.n);
  return { revision: state.revision, items, nextCursor, startCursor: Buffer.from(JSON.stringify({ ...state, hash, after: '0', time: null, missing: true, begin: true })).toString('base64url'), snapshotAt: state.at, watermark: state.watermark, privacyVersion: state.privacy, analysisEpoch: state.analysis, matchedEvents: Number(counts.n), unknownTimes: Number(counts.missing ?? 0), eventKinds: kinds, agents, laneCounts, retainedGaps, excludedSources,
    notes: ['Search covers retained metadata identifiers, not raw prompts, code or tool output.', 'Source order is monitor ingestion order; source line/generation is retained. Time order does not establish cross-machine causality.', 'Pagination is pinned to a watermark and ledger revision. Appends appear after refresh; privacy/deletion/reparse changes invalidate the snapshot.', 'Ledger references use captured scope revisions. Never sum references per event: duplicate observations can share an entry. Cumulative source counters are controls, not additional usage. Retention gap/source-exclusion counts describe the workspace, not only these filtered events.', 'Agent lanes show up to 100 matching agents; the result pages still include every matching event.'] };
}
