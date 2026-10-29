import type { SQLInputValue } from 'node:sqlite';
import { InspectorStore } from './InspectorStore';
import { object, type NormalizedObservation } from '../accounting/codex-observations';
import { privacyVersion } from './project-privacy';
import type { LedgerEntry, LedgerExplanation, LedgerExplanationQuery } from '../shared/inspector';

interface Cursor { id: string; revision: number; privacy: string; analysis: string; sequence: string; observation: string; relation: string; }
export function explainLedger(store: InspectorStore, input: unknown): LedgerExplanation {
  const value = object(input);
  if (!value || Object.keys(value).some(key => !['id','revision','cursor'].includes(key)) || typeof value.id !== 'string' || !/^ledger:[a-f0-9]{64}$/.test(value.id)
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || value.cursor !== undefined && (typeof value.cursor !== 'string' || !value.cursor || value.cursor.length > 4096)) throw new Error('INVALID_LEDGER_EXPLANATION');
  const query = value as unknown as LedgerExplanationQuery;
  const privacy = privacyVersion(store); const analysis = store.getSetting('timeline_analysis_epoch') ?? '0';
  let cursor: Cursor | undefined;
  if (query.cursor) {
    try {
      const decoded = object(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
      if (!decoded || Object.keys(decoded).length !== 7 || decoded.id !== query.id || decoded.revision !== query.revision
        || typeof decoded.privacy !== 'string' || typeof decoded.analysis !== 'string' || typeof decoded.sequence !== 'string' || !/^\d{1,19}$/.test(decoded.sequence)
        || BigInt(decoded.sequence) > 9223372036854775807n || typeof decoded.observation !== 'string' || decoded.observation.length > 128 || !['support','control'].includes(String(decoded.relation))) throw new Error('INVALID_CURSOR');
      cursor = decoded as unknown as Cursor;
    } catch { throw new Error('INVALID_CURSOR'); }
    if (cursor.privacy !== privacy || cursor.analysis !== analysis) throw new Error('LEDGER_EXPLANATION_INVALIDATED');
  }
  const member = store.db.prepare(`SELECT p.entry,s.active_revision FROM ledger_memberships l JOIN ledger_payloads p ON p.id=l.payload_id
    JOIN scope_state s ON s.scope_id=l.scope_id AND s.workspace_id=l.workspace_id WHERE l.workspace_id=? AND l.id=? AND l.revision=?`).get(store.workspaceId, query.id, query.revision);
  if (!member) throw new Error('LEDGER_ENTRY_UNAVAILABLE');
  const entry = { ...JSON.parse(String(member.entry)), revision: query.revision } as LedgerEntry;
  const counts = store.db.prepare(`SELECT COUNT(*) AS n,SUM(k.relation='support') AS support,SUM(k.relation='control') AS control
    FROM ledger_links k JOIN observations o ON o.id=k.observation_id WHERE k.entry_id=? AND k.revision=? AND o.workspace_id=?`).get(query.id, query.revision, store.workspaceId)!;
  const args: SQLInputValue[] = [query.revision, query.id, query.revision, store.workspaceId];
  let after = '';
  if (cursor) {
    after = ' AND (o.sequence>? OR o.sequence=? AND (o.id>? OR o.id=? AND k.relation>?))';
    args.push(BigInt(cursor.sequence), BigInt(cursor.sequence), cursor.observation, cursor.observation, cursor.relation);
  }
  // Interpret support using the parser analysis that existed for this ledger
  // revision, rather than combining an old accounting entry with a new reparse.
  const rows = store.db.prepare(`SELECT o.*,CAST(o.sequence AS TEXT) AS sequence_text,s.machine_id,k.relation,
    COALESCE((SELECT a.normalized FROM observation_analyses a WHERE a.observation_id=o.id AND a.revision<=? ORDER BY a.revision DESC LIMIT 1),o.normalized) AS analysis_normalized
    FROM ledger_links k JOIN observations o ON o.id=k.observation_id JOIN sources s ON s.id=o.source_id AND s.workspace_id=o.workspace_id
    WHERE k.entry_id=? AND k.revision=? AND o.workspace_id=?${after} ORDER BY o.sequence,o.id,k.relation LIMIT 51`).all(...args);
  const observations: LedgerExplanation['observations'] = rows.slice(0, 50).map(row => {
    const n = JSON.parse(String(row.analysis_normalized)) as NormalizedObservation;
    return { id: String(row.id), evidenceRef: String(row.evidence_ref), sourceId: String(row.source_id), recordingMachineId: String(row.machine_id), relation: String(row.relation) as 'support' | 'control',
      sequence: String(row.sequence_text), generation: Number(row.generation), line: Number(row.line), byteStart: String(row.byte_start), byteEnd: String(row.byte_end), timestamp: row.timestamp === null ? null : String(row.timestamp), kind: String(row.kind), issues: n.issues,
      measurements: n.measurements.map(m => ({ kind: m.kind, responseId: m.identity.responseId, values: m.values, nativeTotal: m.nativeTotal, issues: m.issues })) };
  });
  const last = observations.at(-1);
  const nextCursor = rows.length > 50 && last ? Buffer.from(JSON.stringify({ id: query.id, revision: query.revision, privacy, analysis, sequence: last.sequence, observation: last.id, relation: last.relation } satisfies Cursor)).toString('base64url') : null;
  const historyCount = Number(store.db.prepare('SELECT COUNT(*) AS n FROM ledger_memberships WHERE workspace_id=? AND id=? AND revision<=?').get(store.workspaceId, query.id, query.revision)!.n);
  const history = store.db.prepare(`SELECT l.revision,p.entry,r.created_at FROM ledger_memberships l JOIN ledger_payloads p ON p.id=l.payload_id JOIN revisions r ON r.id=l.revision
    WHERE l.workspace_id=? AND l.id=? AND l.revision<=? ORDER BY l.revision DESC LIMIT 20`).all(store.workspaceId, query.id, query.revision).map(row => {
    const prior = JSON.parse(String(row.entry)) as LedgerEntry;
    return { revision: Number(row.revision), createdAt: String(row.created_at), policyVersion: prior.policyVersion, selectionStatus: prior.selectionStatus, grain: prior.grain, total: prior.usage.total.value, evidenceCount: prior.evidenceCount, issues: prior.issues };
  });
  return { entry, activeRevision: Number(member.active_revision), privacyVersion: privacy, analysisEpoch: analysis, observationCount: Number(counts.n), supportCount: Number(counts.support ?? 0), controlCount: Number(counts.control ?? 0), observations, nextCursor, historyCount, history };
}
