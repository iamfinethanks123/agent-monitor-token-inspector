import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EMPTY_CONTEXT, POLICY_VERSION, digest, toolIdentity, timestamp, type NormalizedObservation, type SourceContext, type UsageMeasurement } from '../accounting/codex-observations';
import { EMPTY_VALUES, components, metric, integer, subtract, totalFromParts, validateValues } from '../accounting/integers';
import { TOKEN_FIELDS, type TokenValues, type LedgerEntry, type InspectorSummary, type InspectorPage, type InspectorQuery, type InspectorEvent, type SourceHealth, type InspectorAnalytics, type AnalyticsBucket } from '../shared/inspector';
import { createTimelineIndex, indexTimeline } from './timeline-index';
import { createContentTable, retainContent, pruneContent } from './local-content';
import type { ContentExcerpt } from '../shared/inspector';
import { projectPolicy, projectPolicies } from './project-privacy';

const SCHEMA_VERSION = 11;
type Row = Record<string, SQLInputValue>;
export interface SourceCursor {
  id: string; workspaceId: string; machineId: string; path: string; root: string; label: string;
  generation: number; offset: number; line: number; fileIdentity: string; prefixBytes: number; prefixDigest: string;
  checkpointStart: number; checkpointBytes: number; checkpointDigest: string; discarding: boolean;
  waitingForRecord: boolean;
  fileBytes: number; mtime: number; lastSeenAt: string; context: SourceContext; capabilities: string[]; issues: string[];
  retentionFloor?: { generation: number; line: number; byteEnd: number; removedAt: string };
}
export interface PendingObservation {
  id: string; evidenceRef: string; generation: number; byteStart: number; byteEnd: number; line: number;
  recordDigest: string; normalized: NormalizedObservation; content?: ContentExcerpt;
}
interface MeasurementRow {
  id: string; observationId: string; evidenceRef: string; sourceId: string; generation: number; sequence: number;
  semanticSequence: string | null; timestamp: string | null; measurement: UsageMeasurement;
}

export function validateQuery(value: unknown): InspectorQuery {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_QUERY');
  const input = value as Record<string, unknown>;
  const allowed = new Set(['runId', 'machineId', 'agentId', 'cursor', 'limit', 'includeQuarantined', 'days', 'requestedModel', 'attributedModel', 'projectId', 'provider', 'serviceTier', 'agentMode', 'from', 'to']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new Error('INVALID_QUERY');
  const result: InspectorQuery = {};
  for (const key of ['runId', 'machineId', 'agentId', 'cursor', 'requestedModel', 'attributedModel', 'projectId'] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string' || !input[key] || (input[key] as string).length > 2048) throw new Error('INVALID_QUERY');
    result[key] = input[key] as string;
  }
  if (input.limit !== undefined) {
    if (typeof input.limit !== 'number' || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200) throw new Error('INVALID_QUERY');
    result.limit = input.limit;
  }
  if (input.includeQuarantined !== undefined) {
    if (typeof input.includeQuarantined !== 'boolean') throw new Error('INVALID_QUERY');
    result.includeQuarantined = input.includeQuarantined;
  }
  if (input.days !== undefined) {
    if (typeof input.days !== 'number' || !Number.isInteger(input.days) || input.days < 0 || input.days > 366) throw new Error('INVALID_QUERY');
    result.days = input.days;
  }
  for (const key of ['provider', 'serviceTier'] as const) if (input[key] !== undefined) { if (input[key] !== null && (typeof input[key] !== 'string' || !input[key] || input[key].length > 256 || /[\x00-\x1f]/.test(input[key]))) throw new Error('INVALID_QUERY'); result[key] = input[key] as string | null; }
  if (input.agentMode !== undefined) { if (!['exclusive', 'inclusive'].includes(String(input.agentMode))) throw new Error('INVALID_QUERY'); result.agentMode = input.agentMode as 'exclusive' | 'inclusive'; }
  for (const key of ['from', 'to'] as const) if (input[key] !== undefined) { if (typeof input[key] !== 'string' || input[key].length > 128) throw new Error('INVALID_QUERY_TIME'); const value = timestamp(input[key]); if (!value) throw new Error('INVALID_QUERY_TIME'); result[key] = value; }
  if (result.from && result.to && result.from >= result.to) throw new Error('INVALID_QUERY_TIME');
  return result;
}

export function dateFilter(query: InspectorQuery, column: string, now = Date.now()): { sql: string; args: SQLInputValue[] } {
  const parts: string[] = []; const args: SQLInputValue[] = [];
  if (query.days) { parts.push(`${column}>=?`); args.push(new Date(now - query.days * 86400000).toISOString()); }
  if (query.from) { parts.push(`${column}>=?`); args.push(query.from); }
  if (query.to) { parts.push(`${column}<?`); args.push(query.to); }
  return { sql: parts.join(' AND '), args };
}
export function withinDates(value: string | null, query: InspectorQuery, now = Date.now()): boolean {
  if (!query.days && !query.from && !query.to) return true;
  return value !== null && (!query.days || value >= new Date(now - query.days * 86400000).toISOString()) && (!query.from || value >= query.from) && (!query.to || value < query.to);
}

function valuesOf(entry: LedgerEntry): TokenValues {
  return Object.fromEntries(TOKEN_FIELDS.map(field => [field, entry.usage[field].value])) as TokenValues;
}
function measured(row: Row): MeasurementRow {
  return { id: String(row.id), observationId: String(row.observation_id), evidenceRef: String(row.evidence_ref), sourceId: String(row.source_id),
    generation: Number(row.generation), sequence: Number(row.sequence), semanticSequence: row.semantic_sequence === null ? null : String(row.semantic_sequence),
    timestamp: row.timestamp === null ? null : String(row.timestamp), measurement: JSON.parse(String(row.measurement)) as UsageMeasurement };
}
function nonzero(values: TokenValues): boolean { return TOKEN_FIELDS.some(field => values[field] !== null && BigInt(values[field]!) !== 0n); }
function equalKnown(left: TokenValues, right: TokenValues): boolean {
  return TOKEN_FIELDS.every(field => left[field] === null || right[field] === null || left[field] === right[field]);
}

export class InspectorStore {
  readonly db: DatabaseSync;
  readonly workspaceId: string;
  readonly machineId: string;
  compactionPending = false;

  constructor(filename: string, identity?: { workspaceId: string; machineId: string }) {
    if (filename !== ':memory:') { mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 }); }
    this.db = new DatabaseSync(filename);
    if (filename !== ':memory:') chmodSync(filename, 0o600);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;');
    const version = Number((this.db.prepare('PRAGMA user_version').get() as Row).user_version);
    if (version < 0 || version > SCHEMA_VERSION) { this.db.close(); throw new Error('UNSUPPORTED_STORAGE_VERSION'); }
    if (version === 0) this.initialize();
    if (version > 0 && version < SCHEMA_VERSION) {
      if (filename !== ':memory:') { const snapshot = `${filename}.v${version}-backup-${Date.now()}`; this.db.prepare('VACUUM INTO ?').run(snapshot); chmodSync(snapshot, 0o600); }
      this.db.exec('BEGIN IMMEDIATE');
      try {
        if (version <= 2) {
          this.db.exec(`CREATE TABLE IF NOT EXISTS price_snapshots(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,record TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,workspace_id TEXT NOT NULL,operation TEXT NOT NULL,target_id TEXT NOT NULL,created_at TEXT NOT NULL);
          ALTER TABLE observations ADD COLUMN received_at TEXT;
          CREATE TABLE source_roots(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,path TEXT NOT NULL,label TEXT NOT NULL,enabled INTEGER NOT NULL);
          CREATE TABLE source_tombstones(source_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,machine_id TEXT NOT NULL,client_source_id TEXT,deleted_at TEXT NOT NULL);
          `);
          this.db.prepare('UPDATE observations SET received_at=?').run(new Date().toISOString());
        }
        if (version <= 3) this.db.exec(`CREATE TABLE observation_analyses(observation_id TEXT NOT NULL REFERENCES observations(id), revision INTEGER NOT NULL REFERENCES revisions(id), normalized TEXT NOT NULL, PRIMARY KEY(observation_id,revision));
          CREATE TABLE source_analysis(source_id TEXT PRIMARY KEY REFERENCES sources(id), revision INTEGER NOT NULL REFERENCES revisions(id));`);
        if (version <= 4) {
        this.db.exec(`CREATE TABLE ledger_payloads(id TEXT PRIMARY KEY,entry TEXT NOT NULL);
          CREATE TABLE ledger_memberships(id TEXT NOT NULL,revision INTEGER NOT NULL REFERENCES revisions(id),workspace_id TEXT NOT NULL REFERENCES workspaces(id),
            scope_id TEXT NOT NULL,thread_id TEXT,machine_id TEXT,source_id TEXT NOT NULL,sequence INTEGER NOT NULL,response_key TEXT,
            status TEXT NOT NULL CHECK(status IN ('selected','quarantined')),payload_id TEXT NOT NULL REFERENCES ledger_payloads(id),source_generation INTEGER,native_ordinal INTEGER,PRIMARY KEY(id,revision));`);
        const insertPayload = this.db.prepare('INSERT OR IGNORE INTO ledger_payloads VALUES(?,?)');
        const insertMember = this.db.prepare('INSERT INTO ledger_memberships VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
        const pointer = this.db.prepare('SELECT generation,semantic_sequence FROM observations WHERE evidence_ref=? AND source_id=?');
        const positions = new Map<string, { generation: SQLInputValue; ordinal: SQLInputValue }>();
        for (const row of this.db.prepare('SELECT * FROM ledger').iterate()) {
          const entry = JSON.parse(String(row.entry)); delete entry.revision;
          const body = JSON.stringify(entry); const id = digest(body);
          let position = positions.get(id);
          if (!position) {
            const observation = row.response_key ? pointer.get(entry.evidenceRefs[0], row.source_id) : undefined;
            position = { generation: observation?.generation ?? null, ordinal: observation?.semantic_sequence === null || observation?.semantic_sequence === undefined ? null : BigInt(String(observation.semantic_sequence)) }; positions.set(id, position);
          }
          insertPayload.run(id, body); insertMember.run(row.id, row.revision, row.workspace_id, row.scope_id, row.thread_id, row.machine_id, row.source_id, row.sequence, row.response_key, row.status, id, position.generation, position.ordinal);
        }
        this.db.exec(`ALTER TABLE ledger_links RENAME TO ledger_links_v4;
          CREATE TABLE ledger_links(entry_id TEXT NOT NULL,revision INTEGER NOT NULL,observation_id TEXT NOT NULL REFERENCES observations(id),relation TEXT NOT NULL,
            PRIMARY KEY(entry_id,revision,observation_id,relation),FOREIGN KEY(entry_id,revision) REFERENCES ledger_memberships(id,revision));
          INSERT INTO ledger_links SELECT * FROM ledger_links_v4;
          DROP TABLE ledger_links_v4; DROP TABLE ledger;
          CREATE INDEX ledger_page ON ledger_memberships(workspace_id,scope_id,revision,status,sequence,id);
          CREATE INDEX ledger_payload_usage ON ledger_memberships(payload_id);
          CREATE INDEX ledger_response_window ON ledger_memberships(workspace_id,scope_id,revision,source_id,status,source_generation,native_ordinal,sequence);
          CREATE INDEX usage_stream_order ON usage_observations(workspace_id,scope_id,source_id,kind,generation,sequence,semantic_sequence);
          PRAGMA user_version=${SCHEMA_VERSION};`);
        this.createLedgerView();
        }
        if (version <= 5) this.createManifestTables();
        if (version <= 6) this.createDeletionReceipts();
        if (version <= 7) this.createAlertTables();
        if (version <= 8) this.createOfflineKeys();
        if (version <= 8) this.createManualPrices();
        if (version <= 9) this.createProjectPrivacy();
        if (version <= 10) createTimelineIndex(this.db);
        this.db.exec(`PRAGMA user_version=${SCHEMA_VERSION}; COMMIT;`);
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      if (filename !== ':memory:' && version <= 4) { try { this.db.exec('VACUUM;'); } catch { this.compactionPending = true; } }
    }
    this.workspaceId = this.getSetting('workspace_id') ?? identity?.workspaceId ?? randomUUID();
    this.machineId = this.getSetting('machine_id') ?? identity?.machineId ?? randomUUID();
    if (identity && (identity.workspaceId !== this.workspaceId || identity.machineId !== this.machineId)) { this.db.close(); throw new Error('WORKSPACE_IDENTITY_MISMATCH'); }
    this.db.prepare('INSERT OR IGNORE INTO workspaces(id) VALUES(?)').run(this.workspaceId);
    this.setSetting('workspace_id', this.workspaceId);
    this.setSetting('machine_id', this.machineId);
    try { this.ensureToolIdentity(); this.db.exec(`CREATE INDEX IF NOT EXISTS observation_project_privacy ON observations(workspace_id,COALESCE(json_extract(normalized,'$.context.projectId'),'(unknown)'),source_id); CREATE TABLE IF NOT EXISTS collector_project_constraints(workspace_id TEXT NOT NULL,project_id TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(workspace_id,project_id));`); createContentTable(this.db); pruneContent(this); } catch (error) { this.db.close(); throw error; }
  }

  private ensureToolIdentity(): void {
    if (this.getSetting('tool_identity_version') === '2' && !this.db.prepare("SELECT 1 FROM tool_index WHERE workspace_id=? AND id NOT LIKE 'tool:codex:2:%' LIMIT 1").get(this.workspaceId)) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM tool_index WHERE workspace_id=?').run(this.workspaceId);
      const rows = this.db.prepare(`SELECT o.*,COALESCE(a.normalized,o.normalized) AS current_normalized FROM observations o
        LEFT JOIN source_analysis r ON r.source_id=o.source_id LEFT JOIN observation_analyses a ON a.observation_id=o.id AND a.revision=r.revision
        WHERE o.workspace_id=? ORDER BY o.source_id,o.generation,o.byte_start`);
      for (const raw of rows.iterate(this.workspaceId)) this.indexTool(String(raw.source_id), {
        id: String(raw.id), evidenceRef: String(raw.evidence_ref), generation: Number(raw.generation), byteStart: Number(raw.byte_start), byteEnd: Number(raw.byte_end), line: Number(raw.line),
        recordDigest: String(raw.record_digest), normalized: JSON.parse(String(raw.current_normalized)) as NormalizedObservation,
      });
      this.setSetting('tool_identity_version', '2');
      this.setSetting('timeline_analysis_epoch', (BigInt(this.getSetting('timeline_analysis_epoch') ?? '0') + 1n).toString());
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private initialize(): void {
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE workspaces(id TEXT PRIMARY KEY);
      CREATE TABLE sources(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), machine_id TEXT NOT NULL, path TEXT NOT NULL,
        thread_id TEXT, parent_thread_id TEXT, context TEXT NOT NULL, cursor TEXT NOT NULL, UNIQUE(workspace_id,id));
      CREATE TABLE observations(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, source_id TEXT NOT NULL, generation INTEGER NOT NULL,
        byte_start INTEGER NOT NULL, byte_end INTEGER NOT NULL, line INTEGER NOT NULL, sequence INTEGER NOT NULL, semantic_sequence TEXT,
        timestamp TEXT, kind TEXT NOT NULL, evidence_ref TEXT NOT NULL UNIQUE, record_digest TEXT NOT NULL, normalized TEXT NOT NULL, received_at TEXT NOT NULL,
        UNIQUE(source_id,generation,byte_start,byte_end), UNIQUE(workspace_id,id),
        FOREIGN KEY(workspace_id,source_id) REFERENCES sources(workspace_id,id));
      CREATE INDEX event_page ON observations(workspace_id,source_id,sequence,id);
      CREATE TABLE usage_observations(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, observation_id TEXT NOT NULL, scope_id TEXT NOT NULL,
        source_id TEXT NOT NULL, generation INTEGER NOT NULL, sequence INTEGER NOT NULL, semantic_sequence TEXT, timestamp TEXT,
        evidence_ref TEXT NOT NULL, kind TEXT NOT NULL, response_key TEXT, measurement TEXT NOT NULL,
        FOREIGN KEY(workspace_id,observation_id) REFERENCES observations(workspace_id,id));
      CREATE INDEX usage_scope ON usage_observations(workspace_id,scope_id,kind,response_key,sequence);
      CREATE TABLE dirty_scopes(scope_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL);
      CREATE TABLE revisions(id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, policy_version TEXT NOT NULL);
      CREATE TABLE scope_state(scope_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), active_revision INTEGER NOT NULL REFERENCES revisions(id), UNIQUE(workspace_id,scope_id));
      CREATE TABLE ledger_payloads(id TEXT PRIMARY KEY,entry TEXT NOT NULL);
      CREATE TABLE ledger_memberships(id TEXT NOT NULL, revision INTEGER NOT NULL REFERENCES revisions(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        scope_id TEXT NOT NULL, thread_id TEXT, machine_id TEXT, source_id TEXT NOT NULL, sequence INTEGER NOT NULL, response_key TEXT,
        status TEXT NOT NULL CHECK(status IN ('selected','quarantined')), payload_id TEXT NOT NULL REFERENCES ledger_payloads(id), source_generation INTEGER,native_ordinal INTEGER,PRIMARY KEY(id,revision));
      CREATE INDEX ledger_page ON ledger_memberships(workspace_id,scope_id,revision,status,sequence,id);
      CREATE INDEX ledger_payload_usage ON ledger_memberships(payload_id);
      CREATE INDEX ledger_response_window ON ledger_memberships(workspace_id,scope_id,revision,source_id,status,source_generation,native_ordinal,sequence);
      CREATE INDEX usage_stream_order ON usage_observations(workspace_id,scope_id,source_id,kind,generation,sequence,semantic_sequence);
      CREATE TABLE ledger_links(entry_id TEXT NOT NULL, revision INTEGER NOT NULL, observation_id TEXT NOT NULL REFERENCES observations(id), relation TEXT NOT NULL,
        PRIMARY KEY(entry_id,revision,observation_id,relation), FOREIGN KEY(entry_id,revision) REFERENCES ledger_memberships(id,revision));
      CREATE TABLE exclusions(source_id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL, reason TEXT NOT NULL);
      CREATE TABLE tool_index(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES sources(id), thread_id TEXT, call_id TEXT NOT NULL,
        name TEXT, started_at TEXT, completed_at TEXT, input_observation TEXT REFERENCES observations(id), output_observation TEXT REFERENCES observations(id),
        input_metadata TEXT, output_metadata TEXT, context TEXT NOT NULL, conflicted INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX tool_scope ON tool_index(workspace_id,source_id,thread_id,started_at);
      CREATE TABLE annotations(id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL, finding_id TEXT NOT NULL, choice TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX annotation_finding ON annotations(workspace_id,finding_id,id);
      CREATE TABLE task_contracts(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, run_id TEXT NOT NULL, record TEXT NOT NULL);
      CREATE TABLE trials(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, contract_id TEXT NOT NULL REFERENCES task_contracts(id), digest TEXT NOT NULL, record TEXT NOT NULL);
      CREATE TABLE budgets(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, record TEXT NOT NULL);
      CREATE TABLE devices(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, platform TEXT, state TEXT NOT NULL,
        token_hash TEXT, pairing_hash TEXT, pairing_expires INTEGER, last_seen TEXT, ack TEXT NOT NULL DEFAULT '0');
      CREATE TABLE sync_batches(device_id TEXT NOT NULL REFERENCES devices(id), batch_id TEXT NOT NULL, digest TEXT NOT NULL, sequence_start TEXT NOT NULL, sequence_end TEXT NOT NULL,
        received_at TEXT NOT NULL, PRIMARY KEY(device_id,batch_id));
      CREATE TABLE device_gaps(device_id TEXT NOT NULL REFERENCES devices(id), sequence_start TEXT NOT NULL, sequence_end TEXT NOT NULL, reason TEXT NOT NULL, received_at TEXT NOT NULL,
        PRIMARY KEY(device_id,sequence_start,sequence_end));
      CREATE TABLE price_snapshots(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,record TEXT NOT NULL);
      CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,workspace_id TEXT NOT NULL,operation TEXT NOT NULL,target_id TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE source_roots(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,path TEXT NOT NULL,label TEXT NOT NULL,enabled INTEGER NOT NULL);
      CREATE TABLE source_tombstones(source_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,machine_id TEXT NOT NULL,client_source_id TEXT,deleted_at TEXT NOT NULL);
      CREATE TABLE observation_analyses(observation_id TEXT NOT NULL REFERENCES observations(id), revision INTEGER NOT NULL REFERENCES revisions(id), normalized TEXT NOT NULL, PRIMARY KEY(observation_id,revision));
      CREATE TABLE source_analysis(source_id TEXT PRIMARY KEY REFERENCES sources(id), revision INTEGER NOT NULL REFERENCES revisions(id));
      PRAGMA user_version=${SCHEMA_VERSION};`);
    this.createLedgerView();
    this.createManifestTables();
    this.createDeletionReceipts();
    this.createAlertTables();
    this.createOfflineKeys();
    this.createManualPrices();
    this.createProjectPrivacy();
    createTimelineIndex(this.db);
    this.db.exec('COMMIT');
  }

  private createAlertTables(): void {
    this.db.exec(`CREATE TABLE incidents(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,record TEXT NOT NULL);
      CREATE INDEX incident_source ON incidents(workspace_id,source_id);
      CREATE TABLE alert_checkpoints(source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,generation INTEGER NOT NULL,line INTEGER NOT NULL,issues TEXT NOT NULL,started_at TEXT NOT NULL);
      CREATE TABLE alert_suppressions(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,record TEXT NOT NULL);`);
  }

  private createOfflineKeys(): void {
    this.db.exec(`ALTER TABLE devices ADD COLUMN offline_public_key TEXT; ALTER TABLE devices ADD COLUMN offline_registered_at TEXT;
      ALTER TABLE devices ADD COLUMN last_online_seen TEXT; ALTER TABLE devices ADD COLUMN last_ingest_mode TEXT;
      UPDATE devices SET last_online_seen=last_seen,last_ingest_mode='network' WHERE last_seen IS NOT NULL;`);
  }

  private createManualPrices(): void {
    this.db.exec('CREATE TABLE manual_usd_prices(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,record TEXT NOT NULL);');
  }
  private createProjectPrivacy(): void {
    this.db.exec(`CREATE TABLE project_policies(workspace_id TEXT NOT NULL,project_id TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(workspace_id,project_id));
      CREATE TABLE project_retention_floors(workspace_id TEXT NOT NULL,source_id TEXT NOT NULL,project_id TEXT NOT NULL,generation INTEGER NOT NULL,byte_end INTEGER NOT NULL,PRIMARY KEY(workspace_id,source_id,project_id));
      CREATE TABLE usage_retention_gaps(workspace_id TEXT NOT NULL,source_id TEXT NOT NULL,scope_id TEXT NOT NULL,generation INTEGER NOT NULL,sequence INTEGER NOT NULL,native_ordinal INTEGER,PRIMARY KEY(workspace_id,source_id,scope_id,generation,sequence));
      CREATE TABLE project_source_links(workspace_id TEXT NOT NULL,source_id TEXT NOT NULL,project_id TEXT NOT NULL,PRIMARY KEY(workspace_id,source_id,project_id));
      INSERT OR IGNORE INTO project_source_links SELECT DISTINCT workspace_id,source_id,COALESCE(json_extract(normalized,'$.context.projectId'),'(unknown)') FROM observations;
      CREATE INDEX privacy_gap_order ON usage_retention_gaps(workspace_id,source_id,scope_id,generation,sequence);`);
  }

  private createDeletionReceipts(): void {
    this.db.exec(`CREATE TABLE source_deletion_receipts(workspace_id TEXT NOT NULL,machine_id TEXT NOT NULL,source_id TEXT NOT NULL,deletion_id TEXT NOT NULL,applied_at TEXT NOT NULL,PRIMARY KEY(workspace_id,machine_id,source_id,deletion_id));
      ALTER TABLE devices ADD COLUMN credential_confirmed_at TEXT;`);
  }

  private createManifestTables(): void {
    this.db.exec(`CREATE TABLE context_records(workspace_id TEXT NOT NULL REFERENCES workspaces(id),client_id TEXT NOT NULL,request_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('manifest','result')),digest TEXT NOT NULL,record TEXT NOT NULL,received_at TEXT NOT NULL,PRIMARY KEY(workspace_id,client_id,request_id,kind));
      CREATE TABLE context_exclusions(workspace_id TEXT NOT NULL REFERENCES workspaces(id),machine_id TEXT NOT NULL,thread_id TEXT NOT NULL,PRIMARY KEY(workspace_id,machine_id,thread_id));`);
  }

  private createLedgerView(): void {
    this.db.exec(`CREATE VIEW ledger AS SELECT m.id,m.revision,m.workspace_id,m.scope_id,m.thread_id,m.machine_id,m.source_id,m.sequence,m.response_key,m.status,
      json_set(p.entry,'$.revision',m.revision) AS entry FROM ledger_memberships m JOIN ledger_payloads p ON p.id=m.payload_id;`);
  }

  getSetting(key: string): string | null { return (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as Row | undefined)?.value?.toString() ?? null; }
  setSetting(key: string, value: string): void { this.db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
  close(): void { this.db.close(); }
  audit(operation: string, targetId: string): void { this.db.prepare('INSERT INTO audit_events(workspace_id,operation,target_id,created_at) VALUES(?,?,?,?)').run(this.workspaceId, operation, targetId, new Date().toISOString()); }
  revision(): number { return Number((this.db.prepare('SELECT COALESCE(MAX(id),0) AS value FROM revisions').get() as Row).value); }
  getSource(id: string): SourceCursor | null {
    const row = this.db.prepare('SELECT cursor FROM sources WHERE workspace_id=? AND id=?').get(this.workspaceId, id) as Row | undefined;
    return row ? JSON.parse(String(row.cursor)) as SourceCursor : null;
  }
  excluded(id: string): boolean { return !!this.db.prepare('SELECT source_id FROM exclusions WHERE source_id=?').get(id); }

  commit(cursor: SourceCursor, observations: PendingObservation[]): void {
    if (cursor.workspaceId !== this.workspaceId || cursor.machineId !== this.machineId) throw new Error('WORKSPACE_IDENTITY_MISMATCH');
    this.writeObservations(cursor, observations);
  }

  commitAuthenticatedDevice(cursor: SourceCursor, observations: PendingObservation[], deviceId: string): void {
    if (cursor.workspaceId !== this.workspaceId || cursor.machineId !== deviceId || !this.db.prepare("SELECT id FROM devices WHERE id=? AND workspace_id=? AND state='active'").get(deviceId, this.workspaceId)) throw new Error('UNAUTHORIZED');
    const previous = this.getSource(cursor.id);
    if (previous && previous.machineId !== deviceId) throw new Error('FORBIDDEN_SOURCE');
    this.writeObservations(cursor, observations);
  }

  private writeObservations(cursor: SourceCursor, observations: PendingObservation[]): void {
    if (this.excluded(cursor.id)) return;
    const floor = this.getSource(cursor.id)?.retentionFloor;
    if (floor) { cursor.retentionFloor = floor; if (!cursor.issues.includes('USAGE_RETENTION_GAP')) cursor.issues.push('USAGE_RETENTION_GAP'); }
    const insertSource = this.db.prepare(`INSERT INTO sources(id,workspace_id,machine_id,path,thread_id,parent_thread_id,context,cursor) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET thread_id=excluded.thread_id,parent_thread_id=excluded.parent_thread_id,context=excluded.context,cursor=excluded.cursor`);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      insertSource.run(cursor.id, this.workspaceId, cursor.machineId, cursor.path, cursor.context.threadId, cursor.context.parentThreadId, JSON.stringify(cursor.context), JSON.stringify(cursor));
      const insert = this.db.prepare('INSERT OR IGNORE INTO observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      const insertUsage = this.db.prepare('INSERT OR IGNORE INTO usage_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
      const policies = projectPolicies(this);
      const projectFloors = new Map(this.db.prepare('SELECT project_id,generation,byte_end FROM project_retention_floors WHERE workspace_id=? AND source_id=?').all(this.workspaceId, cursor.id).map(floor => [String(floor.project_id), floor]));
      const linkedProjects = this.db.prepare('SELECT project_id FROM project_source_links WHERE workspace_id=? AND source_id=?').all(this.workspaceId, cursor.id).map(link => String(link.project_id));
      for (const row of observations) {
        if (floor && (row.generation < floor.generation || row.generation === floor.generation && row.byteEnd <= floor.byteEnd)) continue;
        const normalized = row.normalized;
        const existing = this.db.prepare('SELECT record_digest,normalized FROM observations WHERE id=?').get(row.id) as Row | undefined;
        if (existing && existing.record_digest !== row.recordDigest) throw new Error('OBSERVATION_PAYLOAD_CONFLICT');
        const projectId = normalized.context.projectId ?? (existing ? (JSON.parse(String(existing.normalized)) as NormalizedObservation).context.projectId : null) ?? '(unknown)'; const projectFloor = projectFloors.get(projectId);
        if ((policies.get(projectId) ?? projectPolicy(this, projectId)).excluded || projectFloor && (row.generation < Number(projectFloor.generation) || row.generation === Number(projectFloor.generation) && row.byteEnd <= Number(projectFloor.byte_end))) continue;
        if (projectId === '(unknown)' && linkedProjects.some(id => { const policy = policies.get(id); return id !== '(unknown)' && policy && (policy.excluded || !policy.allowExports || !policy.allowSourcePreview || policy.metadataDays !== null || policy.usageDays !== null); })) { if (!cursor.issues.includes('PROJECT_IDENTITY_UNAVAILABLE')) cursor.issues.push('PROJECT_IDENTITY_UNAVAILABLE'); continue; }
        this.db.prepare('INSERT OR IGNORE INTO project_source_links VALUES(?,?,?)').run(this.workspaceId, cursor.id, projectId);
        const pointer = this.db.prepare('SELECT record_digest FROM observations WHERE source_id=? AND generation=? AND byte_start=? AND byte_end=?').get(cursor.id, row.generation, row.byteStart, row.byteEnd) as Row | undefined;
        if (pointer && pointer.record_digest !== row.recordDigest) throw new Error('OBSERVATION_PAYLOAD_CONFLICT');
        const changed = insert.run(row.id, this.workspaceId, cursor.id, row.generation, row.byteStart, row.byteEnd, row.line, row.line,
          normalized.semanticSequence, normalized.sourceTimestamp, normalized.kind, row.evidenceRef, row.recordDigest, JSON.stringify(normalized), new Date().toISOString());
        if (!changed.changes) continue;
        indexTimeline(this.db, this.workspaceId, cursor.id, cursor.machineId, row.id, row.generation, normalized);
        retainContent(this, row.id, normalized.context.projectId, cursor.machineId, new Date().toISOString(), row.content);
        this.indexTool(cursor.id, row);
        for (let i = 0; i < normalized.measurements.length; i++) {
          const m = normalized.measurements[i];
          insertUsage.run(`${row.id}:${i}`, this.workspaceId, row.id, m.scopeId, cursor.id, row.generation, row.line,
            normalized.semanticSequence, normalized.sourceTimestamp, row.evidenceRef, m.kind, m.responseKey, JSON.stringify(m));
          if (m.kind === 'response' || m.kind === 'thread_counter') this.db.prepare('INSERT OR IGNORE INTO dirty_scopes VALUES(?,?)').run(m.scopeId, this.workspaceId);
        }
      }
      if (observations.some(row => row.content)) pruneContent(this);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  /** Publish a verified parser revision without changing the original observations or cursor. */
  publishAnalysis(sourceId: string, rows: Iterable<PendingObservation>): number {
    const cursor = this.getSource(sourceId); if (!cursor || this.excluded(sourceId)) throw new Error('UNKNOWN_SOURCE');
    const scopes = new Set(this.dirtyScopes(sourceId));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare('INSERT INTO revisions(created_at,policy_version) VALUES(?,?)').run(new Date().toISOString(), POLICY_VERSION);
      const revision = Number(result.lastInsertRowid);
      this.db.prepare('DELETE FROM tool_index WHERE source_id=?').run(sourceId);
      this.db.prepare('DELETE FROM usage_observations WHERE source_id=?').run(sourceId);
      const insertUsage = this.db.prepare('INSERT INTO usage_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for (const row of rows) {
        const existing = this.db.prepare('SELECT record_digest,received_at FROM observations WHERE id=? AND source_id=?').get(row.id, sourceId);
        if (!existing || existing.record_digest !== row.recordDigest) throw new Error('SOURCE_CHANGED_DURING_REPARSE');
        const n = row.normalized;
        indexTimeline(this.db, this.workspaceId, sourceId, cursor.machineId, row.id, row.generation, n);
        retainContent(this, row.id, n.context.projectId, cursor.machineId, String(existing.received_at), row.content);
        this.db.prepare('INSERT INTO observation_analyses VALUES(?,?,?)').run(row.id, revision, JSON.stringify(n));
        this.indexTool(sourceId, row);
        for (let i = 0; i < n.measurements.length; i++) {
          const m = n.measurements[i];
          insertUsage.run(`${row.id}:${i}`, this.workspaceId, row.id, m.scopeId, sourceId, row.generation, row.line, n.semanticSequence, n.sourceTimestamp, row.evidenceRef, m.kind, m.responseKey, JSON.stringify(m));
          if (m.kind === 'response' || m.kind === 'thread_counter') scopes.add(m.scopeId);
        }
      }
      pruneContent(this);
      this.db.prepare('INSERT INTO source_analysis VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET revision=excluded.revision').run(sourceId, revision);
      for (const scope of scopes) {
        this.reconcileScope(scope, revision);
        this.db.prepare('INSERT INTO scope_state VALUES(?,?,?) ON CONFLICT(scope_id) DO UPDATE SET active_revision=excluded.active_revision').run(scope, this.workspaceId, revision);
        this.db.prepare('DELETE FROM dirty_scopes WHERE scope_id=? AND workspace_id=?').run(scope, this.workspaceId);
      }
      this.setSetting('timeline_analysis_epoch', (BigInt(this.getSetting('timeline_analysis_epoch') ?? '0') + 1n).toString());
      this.audit('source.reparse', sourceId); this.db.exec('COMMIT'); return revision;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private indexTool(sourceId: string, row: PendingObservation): void {
    const n = row.normalized; const meta = n.metadata;
    if (!meta.callId || !n.kind.startsWith('response_item/')) return;
    const result = /(?:output|result|error)$/.test(n.kind);
    const call = /(?:function_call|custom_tool_call|local_shell_call|tool_call)$/.test(n.kind);
    if (!result && !call) return;
    const id = toolIdentity(this.workspaceId, sourceId, row.generation, n.context.threadId, meta.callId);
    const existing = this.db.prepare('SELECT * FROM tool_index WHERE id=?').get(id) as Row | undefined;
    if (!existing) {
      this.db.prepare('INSERT INTO tool_index VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, this.workspaceId, sourceId, n.context.threadId, meta.callId,
        meta.toolName ?? null, call ? n.sourceTimestamp : null, result ? n.sourceTimestamp : null, call ? row.id : null, result ? row.id : null,
        call ? JSON.stringify(meta) : null, result ? JSON.stringify(meta) : null, JSON.stringify(n.context), 0);
    } else {
      const previous = existing[result ? 'output_metadata' : 'input_metadata'];
      if (previous) {
        const old = JSON.parse(String(previous)) as NormalizedObservation['metadata'];
        const field = result ? 'outputFingerprint' : 'argumentsFingerprint';
        if (old[field] && meta[field] && old[field] !== meta[field]) this.db.prepare('UPDATE tool_index SET conflicted=1 WHERE id=?').run(id);
      } else if (result) {
        this.db.prepare('UPDATE tool_index SET completed_at=?,output_observation=?,output_metadata=? WHERE id=?').run(n.sourceTimestamp, row.id, JSON.stringify(meta), id);
      } else {
        this.db.prepare('UPDATE tool_index SET name=?,started_at=?,input_observation=?,input_metadata=?,context=? WHERE id=?').run(meta.toolName ?? null, n.sourceTimestamp, row.id, JSON.stringify(meta), JSON.stringify(n.context), id);
      }
    }
  }

  annotate(findingId: string, choice: unknown): void {
    if (!/^finding:[a-f0-9]{64}$/.test(findingId) || !['actionable', 'intentional', 'not_relevant', 'incorrect', 'resolved'].includes(String(choice))) throw new Error('INVALID_ANNOTATION');
    this.db.prepare('INSERT INTO annotations(workspace_id,finding_id,choice,created_at) VALUES(?,?,?,?)').run(this.workspaceId, findingId, String(choice), new Date().toISOString());
    this.audit('finding.annotate', findingId);
  }

  annotation(findingId: string): string | null { return (this.db.prepare('SELECT choice FROM annotations WHERE workspace_id=? AND finding_id=? ORDER BY id DESC LIMIT 1').get(this.workspaceId, findingId) as Row | undefined)?.choice?.toString() ?? null; }

  queryFilter(query: InspectorQuery, alias: 'l' | 's' | 'e'): { sql: string; args: SQLInputValue[] } { return this.filter(validateQuery(query), alias); }
  metadataFilter(input: InspectorQuery, dateColumn: string, contextColumn: string, prefix = ''): { sql: string; args: SQLInputValue[] } {
    const query = validateQuery(input); const filter = this.filter(query, 's'); const dates = dateFilter(query, dateColumn); if (dates.sql) { filter.sql += ` AND ${dates.sql}`; filter.args.push(...dates.args); }
    const match = (field: string, value: string | null | undefined) => { if (value !== undefined) { filter.sql += ` AND ${field}${value === null ? ' IS NULL' : '=?'}`; if (value !== null) filter.args.push(value); } };
    const json = (field: string) => `json_extract(${contextColumn},'$.${prefix}${field}')`;
    match(json('requestedModel'), query.requestedModel); match(json('projectId'), query.projectId);
    match(prefix === 'context.' ? `COALESCE(json_extract(${contextColumn},'$.measurements[0].model.providerRoute'),${json('providerRoute')})` : json('providerRoute'), query.provider);
    match(prefix === 'context.' ? `COALESCE(json_extract(${contextColumn},'$.measurements[0].model.serviceTier'),${json('serviceTier')})` : json('serviceTier'), query.serviceTier);
    match(prefix === 'context.' ? `COALESCE(json_extract(${contextColumn},'$.measurements[0].model.observedModel'),${json('requestedModel')})` : json('requestedModel'), query.attributedModel);
    return filter;
  }

  private entry(row: MeasurementRow, revision: number, suffix: string, grain: LedgerEntry['grain'], values = row.measurement.values, issues = row.measurement.issues): LedgerEntry {
    const m = row.measurement;
    const origin = grain === 'response' ? 'provider_response' : 'codex_counter';
    const status = issues.length ? 'quarantined' : 'selected';
    const result: LedgerEntry = {
      id: `ledger:${digest(`${m.scopeId}:${suffix}`)}`, revision, scopeId: m.scopeId, identity: { ...m.identity }, grain,
      startAt: grain === 'response' ? row.timestamp : null, endAt: grain === 'response' ? row.timestamp : null, model: { ...m.model },
      usage: components(values, status === 'quarantined' ? 'conflicted' : grain === 'response' ? 'observed' : 'derived', origin, [row.evidenceRef]),
      nativeTotal: metric(m.nativeTotal, 'observed', origin, [row.evidenceRef]), evidenceRefs: [row.evidenceRef], evidenceCount: 1,
      controlObservationRefs: grain === 'response' ? [] : [row.observationId], selectionStatus: status,
      reconciliation: status === 'quarantined' ? 'conflicted' : TOKEN_FIELDS.some(f => values[f] === null) ? 'partial' : 'matched', issues: [...issues],
      coverage: { fromSequence: null, toSequence: row.semanticSequence ?? String(row.sequence), excludesResponses: grain !== 'response', priorHistory: grain === 'aggregate', sourceGeneration: row.generation, recordSequence: String(row.sequence), nativeOrdinal: row.semanticSequence, sequenceBasis: row.semanticSequence === null ? 'source_record' : 'native_ordinal' },
      policyVersion: POLICY_VERSION,
    };
    // Canonical total is deterministic I+O even though the native total remains observed.
    if (status === 'selected' && values.total !== null) result.usage.total.provenance = 'derived';
    return result;
  }

  private insertEntry(entry: LedgerEntry, row: MeasurementRow): void {
    const body = JSON.stringify({ ...entry, revision: undefined }); const payloadId = digest(body);
    this.db.prepare('INSERT OR IGNORE INTO ledger_payloads VALUES(?,?)').run(payloadId, body);
    this.db.prepare('INSERT INTO ledger_memberships VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(entry.id, entry.revision, this.workspaceId, entry.scopeId,
      entry.identity.threadId, entry.identity.originMachineId, row.sourceId, row.sequence, row.measurement.responseKey, entry.selectionStatus, payloadId, row.generation, row.semanticSequence === null ? null : BigInt(row.semanticSequence));
    this.db.prepare('INSERT OR IGNORE INTO ledger_links VALUES(?,?,?,?)').run(entry.id, entry.revision, row.observationId, 'support');
  }

  /** Activate the entire affected accounting set in one transaction; old revisions remain auditable. */
  reconcile(scopeIds: Iterable<string>): void {
    const scopes = [...new Set(scopeIds)];
    if (!scopes.length) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare('INSERT INTO revisions(created_at,policy_version) VALUES(?,?)').run(new Date().toISOString(), POLICY_VERSION);
      const revision = Number(result.lastInsertRowid);
      for (const scope of scopes) {
        this.reconcileScope(scope, revision);
        this.db.prepare('INSERT INTO scope_state VALUES(?,?,?) ON CONFLICT(scope_id) DO UPDATE SET active_revision=excluded.active_revision').run(scope, this.workspaceId, revision);
        this.db.prepare('DELETE FROM dirty_scopes WHERE workspace_id=? AND scope_id=?').run(this.workspaceId, scope);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  dirtyScopes(sourceId: string): string[] {
    return (this.db.prepare('SELECT DISTINCT scope_id FROM usage_observations WHERE workspace_id=? AND source_id=? AND kind IN (\'response\',\'thread_counter\')').all(this.workspaceId, sourceId) as Row[]).map(r => String(r.scope_id));
  }

  reconcileDirty(): void {
    const scopes = (this.db.prepare('SELECT scope_id FROM dirty_scopes WHERE workspace_id=?').all(this.workspaceId) as Row[]).map(r => String(r.scope_id));
    this.reconcile(scopes);
  }

  ensureAccountingPolicy(): void {
    const scopes = this.db.prepare(`SELECT s.scope_id FROM scope_state s JOIN revisions r ON r.id=s.active_revision
      WHERE s.workspace_id=? AND r.policy_version<>?`).all(this.workspaceId, POLICY_VERSION).map(row => String(row.scope_id));
    this.reconcile(scopes);
  }

  private reconcileScope(scope: string, revision: number): void {
    const keys = this.db.prepare("SELECT response_key FROM usage_observations WHERE workspace_id=? AND scope_id=? AND kind='response' GROUP BY response_key ORDER BY MIN(sequence),response_key");
    for (const key of keys.iterate(this.workspaceId, scope)) {
      const rows = this.db.prepare("SELECT * FROM usage_observations WHERE workspace_id=? AND scope_id=? AND kind='response' AND response_key=? ORDER BY generation,sequence,id");
      let first: MeasurementRow | undefined;
      let entry: LedgerEntry | undefined;
      let count = 0;
      for (const raw of rows.iterate(this.workspaceId, scope, String(key.response_key))) {
        const row = measured(raw as Row); count++;
        if (!first) { first = row; entry = this.entry(row, revision, `response:${row.measurement.responseKey}`, 'response'); continue; }
        if (!entry) continue;
        if (!equalKnown(valuesOf(entry), row.measurement.values) || row.measurement.issues.length) {
          entry.issues.push('CONFLICTING_RESPONSE_OBSERVATIONS', ...row.measurement.issues);
          entry.selectionStatus = 'quarantined'; entry.reconciliation = 'conflicted';
          for (const field of TOKEN_FIELDS) entry.usage[field].provenance = 'conflicted';
        } else if (entry.selectionStatus === 'selected') {
          for (const field of TOKEN_FIELDS) {
            if (entry.usage[field].value === null && row.measurement.values[field] !== null) entry.usage[field] = metric(row.measurement.values[field], field === 'total' ? 'derived' : 'observed', 'provider_response', [row.evidenceRef]);
          }
        }
        if (entry.evidenceRefs.length < 20) entry.evidenceRefs.push(row.evidenceRef);
      }
      if (!first || !entry) continue;
      if (entry.selectionStatus === 'selected') {
        const merged = totalFromParts(valuesOf(entry));
        entry.issues.push(...validateValues(merged, entry.nativeTotal.value));
        if (entry.issues.length) { entry.selectionStatus = 'quarantined'; entry.reconciliation = 'conflicted'; }
        entry.usage.total = metric(merged.total, entry.selectionStatus === 'selected' ? 'derived' : 'conflicted', 'monitor_calculation', entry.evidenceRefs);
      }
      entry.evidenceCount = count;
      entry.issues = [...new Set(entry.issues)];
      this.insertEntry(entry, first);
      this.db.prepare(`INSERT OR IGNORE INTO ledger_links SELECT ?,?,observation_id,'support' FROM usage_observations WHERE workspace_id=? AND scope_id=? AND response_key=?`).run(entry.id, revision, this.workspaceId, scope, String(key.response_key));
    }

    // Counter subtraction is confined to one proven logical stream. Different
    // anonymous streams are not merged by equal counts or timestamps.
    const streams = this.db.prepare("SELECT source_id FROM usage_observations WHERE workspace_id=? AND scope_id=? AND kind='thread_counter' GROUP BY source_id");
    const streamCount = Number((this.db.prepare("SELECT COUNT(DISTINCT source_id) AS count FROM usage_observations WHERE workspace_id=? AND scope_id=? AND kind='thread_counter'").get(this.workspaceId, scope) as Row).count);
    for (const stream of streams.iterate(this.workspaceId, scope)) {
      const sourceId = String(stream.source_id);
      const nativeOrder = !this.db.prepare("SELECT 1 FROM usage_observations WHERE workspace_id=? AND scope_id=? AND source_id=? AND kind IN ('response','thread_counter') AND semantic_sequence IS NULL LIMIT 1").get(this.workspaceId, scope, sourceId);
      const rows = this.db.prepare(`SELECT * FROM usage_observations WHERE workspace_id=? AND scope_id=? AND source_id=? AND kind='thread_counter'
        ORDER BY generation,${nativeOrder ? 'CAST(semantic_sequence AS INTEGER),' : ''}sequence,id`);
      let previous: MeasurementRow | undefined;
      let ambiguous = false;
      const retainedWithGap = !!this.getSource(String(stream.source_id))?.retentionFloor;
      const gaps = this.db.prepare(`SELECT generation,${nativeOrder ? 'native_ordinal' : 'sequence'} AS position FROM usage_retention_gaps WHERE workspace_id=? AND source_id=? AND scope_id=?`).all(this.workspaceId, sourceId, scope);
      for (const raw of rows.iterate(this.workspaceId, scope, String(stream.source_id))) {
        const row = measured(raw as Row);
        const point = row.measurement;
        // After expiry, an initial cumulative point includes deleted history. It
        // anchors subsequent differences but cannot enter the retained total.
        if (!previous && (retainedWithGap || gaps.some(gap => Number(gap.generation) <= row.generation && (gap.position === null || BigInt(String(gap.position)) <= BigInt(nativeOrder ? row.semanticSequence! : row.sequence)))) && !point.issues.length) { previous = row; continue; }
        const seq = nativeOrder ? row.semanticSequence! : String(row.sequence);
        const beforeSeq = previous ? nativeOrder ? previous.semanticSequence! : String(previous.sequence) : null;
        const sameGeneration = !previous || previous.generation === row.generation;
        const issues = [...point.issues];
        if (previous && gaps.some(gap => Number(gap.generation) >= previous!.generation && Number(gap.generation) <= row.generation && (gap.position === null || BigInt(String(gap.position)) > BigInt(beforeSeq!) && BigInt(String(gap.position)) <= BigInt(seq)))) issues.push('RETENTION_GAP_IN_COUNTER_RANGE');
        const delta = previous ? subtract(point.values, previous.measurement.values) : { values: { ...point.values }, falling: false };
        if (delta.falling) { ambiguous = true; issues.push('AMBIGUOUS_COUNTER_DECREASE'); }
        if (previous && !sameGeneration) { ambiguous = true; issues.push('REPLAY_OR_ROTATION_WITHOUT_ACCOUNTING_BASELINE'); }
        if (ambiguous) issues.push('COUNTER_RANGE_QUARANTINED');

        const responses = this.db.prepare(`SELECT json_set(p.entry,'$.revision',l.revision) AS entry FROM ledger_memberships l JOIN ledger_payloads p ON p.id=l.payload_id
          WHERE workspace_id=? AND scope_id=? AND revision=? AND response_key IS NOT NULL AND status='selected' AND source_id=? AND source_generation=?
          AND ${nativeOrder ? 'native_ordinal' : 'sequence'} <= ?
          ${previous && sameGeneration ? `AND ${nativeOrder ? 'native_ordinal' : 'sequence'} > ?` : ''}`);
        const sums: TokenValues = { input: '0', cachedInput: '0', cacheWriteInput: '0', output: '0', reasoningOutput: '0', total: '0' };
        let responseCount = 0;
        const args: SQLInputValue[] = [this.workspaceId, scope, revision, row.sourceId, row.generation, BigInt(seq), ...(previous && sameGeneration ? [BigInt(beforeSeq!)] : [])];
        for (const selected of responses.iterate(...args)) {
          responseCount++;
          const response = JSON.parse(String(selected.entry)) as LedgerEntry;
          for (const field of TOKEN_FIELDS) {
            const v = response.usage[field].value;
            if (v === null || sums[field] === null) sums[field] = null;
            else sums[field] = integer(BigInt(sums[field]!) + BigInt(v));
          }
        }
        const remainder = subtract(delta.values, sums);
        if (remainder.falling) issues.push('RESPONSES_EXCEED_COUNTER_RANGE');
        if (streamCount > 1 && nonzero(remainder.values)) issues.push('UNPROVEN_COUNTER_REPLICA');
        issues.push(...validateValues(remainder.values, remainder.values.total));
        if (issues.length || nonzero(remainder.values) || (!previous && responseCount === 0)) {
          const candidate = this.entry(row, revision, `counter:${row.id}`, previous ? 'interval' : 'aggregate', issues.length ? delta.values : totalFromParts(remainder.values), issues);
          candidate.coverage.toSequence = seq; candidate.coverage.sequenceBasis = nativeOrder ? 'native_ordinal' : 'source_record';
          if (previous) {
            candidate.startAt = previous.timestamp; candidate.endAt = row.timestamp;
            candidate.coverage.fromSequence = beforeSeq;
            candidate.evidenceRefs.unshift(previous.evidenceRef); candidate.evidenceCount++;
            candidate.controlObservationRefs.unshift(previous.observationId);
          } else {
            candidate.model = { requestedModel: null, observedModel: null, providerRoute: point.model.providerRoute, serviceTier: null, quotaAlias: null, provenance: 'unknown', evidenceRefs: [row.evidenceRef] };
            for (const field of TOKEN_FIELDS) candidate.usage[field].assumptions.push('Initial cumulative observation: prior usage is not attributed to import time.');
          }
          if (responseCount > 0) for (const field of TOKEN_FIELDS) candidate.usage[field].assumptions.push('Counter remainder excludes identified responses in this recorded range.');
          this.insertEntry(candidate, { ...row, measurement: { ...row.measurement, responseKey: null } });
          if (previous) this.db.prepare('INSERT OR IGNORE INTO ledger_links VALUES(?,?,?,?)').run(candidate.id, revision, previous.observationId, 'control');
        }
        if (!point.issues.length) previous = row;
      }
    }
  }

  private filter(query: InspectorQuery, alias: 'l' | 's' | 'e'): { sql: string; args: SQLInputValue[] } {
    const parts = [`${alias}.workspace_id=?`];
    const args: SQLInputValue[] = [this.workspaceId];
    if (query.machineId) { parts.push(`${alias}.machine_id=?`); args.push(query.machineId); }
    const subtree = (id: string) => { parts.push(`(${alias}.machine_id,${alias}.thread_id) IN (WITH RECURSIVE descendants(machine_id,thread_id) AS (SELECT DISTINCT machine_id,? FROM sources WHERE workspace_id=? ${query.machineId ? 'AND machine_id=?' : ''} UNION SELECT s.machine_id,s.thread_id FROM sources s JOIN descendants d ON s.machine_id=d.machine_id AND s.parent_thread_id=d.thread_id WHERE s.workspace_id=?) SELECT machine_id,thread_id FROM descendants)`); args.push(id, this.workspaceId, ...(query.machineId ? [query.machineId] : []), this.workspaceId); };
    if (query.agentId) { if (query.agentMode === 'inclusive') subtree(query.agentId); else { parts.push(`${alias}.thread_id=?`); args.push(query.agentId); } }
    if (query.runId) subtree(query.runId);
    if (alias === 'l') {
      const dates = dateFilter(query, "json_extract(l.entry,'$.endAt')"); if (dates.sql) { parts.push(dates.sql); args.push(...dates.args); }
      if (query.requestedModel) { parts.push("json_extract(l.entry,'$.model.requestedModel')=?"); args.push(query.requestedModel); }
      if (query.attributedModel) { parts.push("COALESCE(json_extract(l.entry,'$.model.observedModel'),json_extract(l.entry,'$.model.requestedModel'))=?"); args.push(query.attributedModel); }
      if (query.projectId) { parts.push("json_extract(l.entry,'$.identity.projectId')=?"); args.push(query.projectId); }
      for (const [value, field] of [[query.provider, 'providerRoute'], [query.serviceTier, 'serviceTier']] as const) if (value !== undefined) { parts.push(`json_extract(l.entry,'$.model.${field}')${value === null ? ' IS NULL' : '=?'}`); if (value !== null) args.push(value); }
    }
    return { sql: parts.join(' AND '), args };
  }

  private cursor(query: InspectorQuery, kind: string): { after: string; revision: number; filter: string } {
    const revision = kind === 'events' ? Number((this.db.prepare('SELECT COALESCE(MAX(rowid),0) AS value FROM observations WHERE workspace_id=?').get(this.workspaceId) as Row).value) : this.revision();
    const filter = digest(JSON.stringify([query.runId ?? null, query.machineId ?? null, query.agentId ?? null, query.includeQuarantined ?? false, query.days ?? 0, query.requestedModel ?? null, query.projectId ?? null, query.attributedModel ?? null, query.provider === undefined ? [] : [query.provider], query.serviceTier === undefined ? [] : [query.serviceTier], query.agentMode ?? 'exclusive', query.from, query.to]));
    if (!query.cursor) return { after: '', revision, filter };
    let parsed;
    try { parsed = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); } catch { throw new Error('INVALID_CURSOR'); }
    if (parsed.kind !== kind || parsed.filter !== filter || typeof parsed.after !== 'string' || parsed.after.length > 1024) throw new Error('INVALID_CURSOR');
    if (parsed.revision !== revision) throw new Error('REVISION_CHANGED');
    return { after: parsed.after, revision, filter };
  }

  ledger(queryValue: unknown = {}): InspectorPage<LedgerEntry> {
    const query = validateQuery(queryValue); const limit = query.limit ?? 200;
    const page = this.cursor(query, 'ledger'); const filter = this.filter(query, 'l');
    const rows = this.db.prepare(`SELECT l.id,l.entry FROM scope_state a CROSS JOIN ledger l ON a.scope_id=l.scope_id AND a.active_revision=l.revision
      WHERE ${filter.sql} ${query.includeQuarantined ? '' : "AND l.status='selected'"} AND l.id>? ORDER BY l.id LIMIT ?`).all(...filter.args, page.after, limit + 1) as Row[];
    const items = rows.slice(0, limit).map(r => JSON.parse(String(r.entry)) as LedgerEntry);
    const nextCursor = rows.length > limit ? Buffer.from(JSON.stringify({ ...page, kind: 'ledger', after: rows[limit - 1].id })).toString('base64url') : null;
    return { revision: page.revision, items, nextCursor };
  }

  events(queryValue: unknown = {}): InspectorPage<InspectorEvent> {
    const query = validateQuery(queryValue); const limit = query.limit ?? 200;
    const page = this.cursor(query, 'events'); const filter = this.filter(query, 's');
    if (page.after && !/^[0-9]+$/.test(page.after)) throw new Error('INVALID_CURSOR');
    const rows = this.db.prepare(`SELECT o.*,o.rowid AS event_sequence FROM observations o JOIN sources s ON s.id=o.source_id WHERE ${filter.sql} AND o.rowid>? ORDER BY o.rowid LIMIT ?`).all(...filter.args, Number(page.after || 0), limit + 1) as Row[];
    const items = rows.slice(0, limit).map(r => ({ id: String(r.id), sourceId: String(r.source_id), threadId: (JSON.parse(String(r.normalized)) as NormalizedObservation).context.threadId,
      timestamp: r.timestamp === null ? null : String(r.timestamp), kind: String(r.kind), evidenceRef: String(r.evidence_ref), byteStart: String(r.byte_start), byteEnd: String(r.byte_end), line: Number(r.line), supported: (JSON.parse(String(r.normalized)) as NormalizedObservation).supported }));
    const nextCursor = rows.length > limit ? Buffer.from(JSON.stringify({ ...page, kind: 'events', after: String(rows[limit - 1].event_sequence) })).toString('base64url') : null;
    return { revision: page.revision, items, nextCursor };
  }

  summary(queryValue: unknown = {}): InspectorSummary {
    const query = validateQuery(queryValue); const filter = this.filter(query, 'l');
    const refs: string[] = []; const sums = { ...EMPTY_VALUES }; const known = Object.fromEntries(TOKEN_FIELDS.map(f => [f, 0])) as Record<keyof TokenValues, number>;
    let selectedEntries = 0; let identifiedResponses = 0; let intervals = 0; let aggregates = 0; let quarantinedEntries = 0; let untimed = 0n; let cacheCovered = 0n; let cacheCoveredRead = 0n; let cacheUncovered = 0n; let modelsUnidentified = 0;
    const rows = this.db.prepare(`SELECT l.entry,l.revision,l.status FROM scope_state a CROSS JOIN (SELECT m.*,p.entry FROM ledger_memberships m JOIN ledger_payloads p ON p.id=m.payload_id) l ON a.scope_id=l.scope_id AND a.active_revision=l.revision WHERE ${filter.sql}`);
    for (const row of rows.iterate(...filter.args)) {
      const e = JSON.parse(String(row.entry)) as LedgerEntry; e.revision = Number(row.revision);
      if (e.selectionStatus !== 'selected') { quarantinedEntries++; continue; }
      selectedEntries++; if (refs.length < 20) refs.push(e.id);
      if (e.grain === 'response') identifiedResponses++; else if (e.grain === 'interval') intervals++; else aggregates++;
      if (e.model.observedModel === null) modelsUnidentified++;
      for (const field of TOKEN_FIELDS) {
        const value = e.usage[field].value;
        if (value === null) continue;
        known[field]++; sums[field] = integer(BigInt(sums[field] ?? '0') + BigInt(value));
      }
      if (e.endAt === null && e.usage.total.value !== null) untimed += BigInt(e.usage.total.value);
      if (e.usage.input.value !== null) {
        if (e.usage.cachedInput.value !== null) { cacheCovered += BigInt(e.usage.input.value); cacheCoveredRead += BigInt(e.usage.cachedInput.value); }
        else cacheUncovered += BigInt(e.usage.input.value);
      }
    }
    const usage = components(sums, 'derived', 'monitor_calculation', refs);
    for (const field of TOKEN_FIELDS) if (known[field] < selectedEntries) usage[field].assumptions.push(`Known subtotal only; ${selectedEntries - known[field]} selected entries omit this component.`);
    const sourceCount = this.sources(query).length;
    return { revision: this.revision(), usage, selectedEntries, identifiedResponses, intervals, aggregates, quarantinedEntries,
      untimedTotal: metric(selectedEntries ? integer(untimed) : null, 'derived', 'monitor_calculation', refs),
      cacheCoveredInput: metric(selectedEntries ? integer(cacheCovered) : null, 'derived', 'monitor_calculation', refs),
      cacheCoveredRead: metric(selectedEntries ? integer(cacheCoveredRead) : null, 'derived', 'monitor_calculation', refs),
      cacheUncoveredInput: metric(selectedEntries ? integer(cacheUncovered) : null, 'derived', 'monitor_calculation', refs), modelsUnidentified, sourceCount,
      coverageNotes: ['All figures refer to selected ledger membership.', 'The complete population of model requests is not independently established.', 'Cache and reasoning are included subsets.', ...(quarantinedEntries ? [`${quarantinedEntries} conflicted entries excluded.`] : []), ...(untimed ? ['Prior/untimed usage is excluded from timed rate charts.'] : [])] };
  }

  sources(queryValue: unknown = {}): SourceHealth[] {
    const query = validateQuery(queryValue); const filter = this.filter(query, 's');
    return (this.db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM observations o WHERE o.source_id=s.id) AS records FROM sources s WHERE ${filter.sql} ORDER BY s.id`).all(...filter.args) as Row[]).map(row => {
      const c = JSON.parse(String(row.cursor)) as SourceCursor;
      return { id: c.id, machineId: c.machineId, label: c.label, threadId: c.context.threadId, sessionId: c.context.sessionId,
        parentThreadId: c.context.parentThreadId, runtimeVersion: c.context.runtimeVersion, generation: c.generation, bytesProcessed: String(c.offset), fileBytes: c.capabilities.includes('statistics-only-v2') ? null : String(c.fileBytes),
        records: Number(row.records), lastSeenAt: c.lastSeenAt, state: !c.capabilities.length && Number(row.records) > 0 ? 'unsupported' : c.issues.length || c.waitingForRecord ? 'partial' : c.offset < c.fileBytes ? 'catching_up' : 'current', capabilities: c.capabilities, issues: [...c.issues, ...(c.waitingForRecord ? ['INCOMPLETE_RECORD_PENDING'] : [])] };
    });
  }

  analytics(queryValue: unknown = {}): InspectorAnalytics {
    const query = validateQuery(queryValue); const filter = this.filter(query, 'l');
    const groups = { buckets: new Map<string, AnalyticsBucket>(), models: new Map<string, AnalyticsBucket>(), projects: new Map<string, AnalyticsBucket>(), machines: new Map<string, AnalyticsBucket>() };
    let untimed = 0n;
    const add = (group: Map<string, AnalyticsBucket>, name: string, entry: LedgerEntry) => {
      let bucket = group.get(name);
      if (!bucket) { bucket = { name, input: null, output: null, cachedInput: null, reasoningOutput: null, total: null, responseTotal: '0', intervalTotal: '0', entries: 0 }; group.set(name, bucket); }
      bucket.entries++;
      for (const field of ['input', 'output', 'cachedInput', 'reasoningOutput', 'total'] as const) {
        const value = entry.usage[field].value;
        if (value !== null) bucket[field] = integer(BigInt(bucket[field] ?? '0') + BigInt(value));
      }
      const total = BigInt(entry.usage.total.value ?? '0');
      if (entry.grain === 'response') bucket.responseTotal = integer(BigInt(bucket.responseTotal) + total);
      else bucket.intervalTotal = integer(BigInt(bucket.intervalTotal) + total);
    };
    for (const row of this.db.prepare(`SELECT l.entry,l.revision FROM scope_state a CROSS JOIN (SELECT m.*,p.entry FROM ledger_memberships m JOIN ledger_payloads p ON p.id=m.payload_id) l ON a.scope_id=l.scope_id AND a.active_revision=l.revision WHERE ${filter.sql} AND l.status='selected'`).iterate(...filter.args)) {
      const entry = JSON.parse(String(row.entry)) as LedgerEntry; entry.revision = Number(row.revision);
      if (entry.endAt) {
        const day = new Date(Date.parse(entry.endAt) + 8 * 3600000).toISOString().slice(0, 10);
        add(groups.buckets, day, entry);
      } else untimed += BigInt(entry.usage.total.value ?? '0');
      add(groups.models, entry.model.requestedModel ?? '(unknown)', entry);
      add(groups.projects, entry.identity.projectId ?? '(unknown)', entry);
      add(groups.machines, entry.identity.originMachineId ?? '(unknown)', entry);
    }
    const top = (map: Map<string, AnalyticsBucket>) => [...map.values()].sort((a, b) => BigInt(a.total ?? '0') > BigInt(b.total ?? '0') ? -1 : BigInt(a.total ?? '0') < BigInt(b.total ?? '0') ? 1 : a.name.localeCompare(b.name)).slice(0, 30);
    return { revision: this.revision(), timezone: 'Asia/Hong_Kong', buckets: [...groups.buckets.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(-366),
      models: top(groups.models), projects: top(groups.projects), machines: top(groups.machines), untimedTotal: integer(untimed), modelAttribution: 'requested_model' };
  }

  evidencePointer(id: string): { cursor: SourceCursor; row: PendingObservation } | null {
    if (typeof id !== 'string' || !/^evidence:[a-f0-9]{64}$/.test(id)) throw new Error('INVALID_EVIDENCE_ID');
    const r = this.db.prepare(`SELECT o.*,COALESCE(a.normalized,o.normalized) AS effective_normalized FROM observations o
      LEFT JOIN source_analysis s ON s.source_id=o.source_id LEFT JOIN observation_analyses a ON a.observation_id=o.id AND a.revision=s.revision
      WHERE o.workspace_id=? AND o.evidence_ref=?`).get(this.workspaceId, id) as Row | undefined;
    if (!r) return null;
    const cursor = this.getSource(String(r.source_id));
    if (!cursor) return null;
    return { cursor, row: { id: String(r.id), evidenceRef: id, generation: Number(r.generation), byteStart: Number(r.byte_start), byteEnd: Number(r.byte_end), line: Number(r.line), recordDigest: String(r.record_digest), normalized: JSON.parse(String(r.effective_normalized)) as NormalizedObservation } };
  }

  observationCount(): number { return Number((this.db.prepare('SELECT COUNT(*) AS count FROM observations WHERE workspace_id=?').get(this.workspaceId) as Row).count); }
  rawContext(): SourceContext { return { ...EMPTY_CONTEXT }; }
}
