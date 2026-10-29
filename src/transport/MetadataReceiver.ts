import { receiveCollectorHealth, readCollectorHealth, healthKey } from './collector-health';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { InspectorStore, type SourceCursor, type PendingObservation } from '../storage/InspectorStore';
import { EMPTY_CONTEXT, digest, object, str, timestamp, type NormalizedObservation, type UsageMeasurement } from '../accounting/codex-observations';
import { integer, totalFromParts, validateValues } from '../accounting/integers';
import { TOKEN_FIELDS, type ReceiverView } from '../shared/inspector';
import type { MetadataBatch, MetadataEvent, PairingConfig, SourceDeletion } from './protocol';
import type { ReceiverActivityView } from '../shared/inspector';
import { protectedEndpoint } from './protocol';
import { validatePublicKey, verifyArchive, type OfflineArchive, type OfflinePreview } from './offline';
import { projectControls, projectPolicySync, acknowledgeProjectControls } from './project-policy-controls';

const MAX_BYTES = 1024 * 1024;
const exactKeys = (value: Record<string, unknown>, keys: string[]) => { if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('NON_STATISTICS_FIELD'); };
function matching(secret: string, stored: unknown): boolean {
  if (typeof stored !== 'string' || !/^[a-f0-9]{64}$/.test(stored)) return false;
  return timingSafeEqual(Buffer.from(digest(secret), 'hex'), Buffer.from(stored, 'hex'));
}
function numericPosition(value: unknown): number { const result = Number(integer(value)); if (!Number.isSafeInteger(result)) throw new Error('INVALID_POSITION'); return result; }

export class MetadataReceiver {
  private server?: Server;
  private port = 0;
  error: string | null = null;
  onChanged?: () => void;
  onDevicesChanged?: () => void;
  constructor(readonly store: InspectorStore) {}

  async start(port: number): Promise<void> {
    this.store.db.prepare("INSERT OR IGNORE INTO devices(id,workspace_id,name,platform,state,ack) VALUES(?,?,?,?, 'local','0')").run(this.store.machineId, this.store.workspaceId, 'MacBook', process.platform);
    this.server = createServer((request, response) => { void this.handle(request, response); });
    this.server.requestTimeout = 10000; this.server.headersTimeout = 5000;
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(port, '127.0.0.1', () => { this.server!.removeListener('error', reject); resolve(); }); });
    this.port = (this.server.address() as AddressInfo).port;
    this.server.on('error', () => { this.error = 'RECEIVER_UNAVAILABLE'; this.onChanged?.(); });
  }
  async stop(): Promise<void> { if (this.server) { this.server.closeIdleConnections(); await new Promise<void>(resolve => this.server!.close(() => resolve())); } }
  view(): ReceiverView {
    const activity = this.activity();
    const totals = new Map<string, string>();
    for (const row of this.store.db.prepare(`SELECT l.machine_id,json_extract(p.entry,'$.usage.total.value') AS total
      FROM scope_state a CROSS JOIN ledger_memberships l ON a.scope_id=l.scope_id AND a.active_revision=l.revision
      CROSS JOIN ledger_payloads p ON p.id=l.payload_id WHERE l.workspace_id=? AND l.status='selected'`).iterate(this.store.workspaceId)) {
      if (row.total === null) continue;
      const machine = String(row.machine_id); totals.set(machine, integer(BigInt(totals.get(machine) ?? '0') + BigInt(String(row.total))));
    }
    return { ...activity, usageRevision: this.store.revision(), devices: activity.devices.map(device => ({ ...device, total: totals.get(device.id) ?? null })) };
  }
  private devicesChanged(): void { if (this.onDevicesChanged) this.onDevicesChanged(); else this.onChanged?.(); }
  activity(): ReceiverActivityView {
    const devices = this.store.db.prepare('SELECT id,name,platform,state,last_seen,ack,credential_confirmed_at,offline_registered_at,last_online_seen,last_ingest_mode FROM devices WHERE workspace_id=? ORDER BY state,name').all(this.store.workspaceId).map(row => ({
      health: readCollectorHealth(this.store, String(row.id)),
      projectPolicySync: projectPolicySync(this.store, String(row.id), String(row.state)),
      id: String(row.id), name: String(row.name), platform: row.platform === null ? null : String(row.platform), state: row.state as 'local' | 'pending' | 'active' | 'revoked',
      lastSeenAt: row.last_seen === null ? null : String(row.last_seen), acknowledgedSequence: String(row.ack),
      pendingDeletions: this.deletions(String(row.id)).filter(item => !item.applied).length,
      appliedDeletions: this.deletions(String(row.id)).filter(item => item.applied).length,
      credentialConfirmedAt: row.credential_confirmed_at === null ? null : String(row.credential_confirmed_at),
      offlineRegisteredAt: row.offline_registered_at === null ? null : String(row.offline_registered_at),
      lastOnlineSeenAt: row.last_online_seen === null ? null : String(row.last_online_seen), online: row.state === 'local' || row.state === 'active' && row.last_online_seen !== null && Date.now() - Date.parse(String(row.last_online_seen)) < 180000,
      lastIngestMode: row.last_ingest_mode === null ? null : String(row.last_ingest_mode),
      transportGaps: Number(this.store.db.prepare('SELECT COUNT(*) n FROM device_gaps WHERE device_id=?').get(row.id)!.n),
    }));
    return { endpoint: `http://127.0.0.1:${this.port}`, listening: !!this.port && !this.error, devices, error: this.error };
  }
  enroll(name: unknown, existingId?: unknown): PairingConfig {
    if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('INVALID_DEVICE_NAME');
    if (existingId !== undefined && (typeof existingId !== 'string' || existingId === this.store.machineId || !this.store.db.prepare('SELECT id FROM devices WHERE id=? AND workspace_id=?').get(existingId, this.store.workspaceId))) throw new Error('INVALID_DEVICE');
    const code = randomBytes(32).toString('base64url'); const deviceId = typeof existingId === 'string' ? existingId : randomUUID(); const expires = Date.now() + 10 * 60000;
    this.store.db.prepare("INSERT INTO devices(id,workspace_id,name,state,pairing_hash,pairing_expires,ack) VALUES(?,?,?,'pending',?,?,'0') ON CONFLICT(id) DO UPDATE SET pairing_hash=excluded.pairing_hash,pairing_expires=excluded.pairing_expires").run(deviceId, this.store.workspaceId, name.trim(), digest(code), expires);
    this.store.audit('device.enroll', deviceId);
    this.onChanged?.();
    return { schemaVersion: '2', workspaceId: this.store.workspaceId, deviceId, deviceName: name.trim(), endpoint: protectedEndpoint(`http://127.0.0.1:${this.port}`), pairingCode: code, expiresAt: new Date(expires).toISOString() };
  }
  revoke(id: unknown): void {
    if (typeof id !== 'string' || id === this.store.machineId) throw new Error('INVALID_DEVICE');
    const changed = this.store.db.prepare("UPDATE devices SET state='revoked',token_hash=NULL,pairing_hash=NULL,offline_public_key=NULL,offline_registered_at=NULL WHERE workspace_id=? AND id=?").run(this.store.workspaceId, id);
    if (!changed.changes) throw new Error('UNKNOWN_DEVICE'); this.store.db.prepare('DELETE FROM settings WHERE key=?').run(healthKey(id)); this.store.audit('device.revoke', id); this.onChanged?.();
  }

  private deletions(deviceId: string): (SourceDeletion & { applied: boolean })[] {
    return this.store.db.prepare('SELECT source_id,client_source_id,deleted_at FROM source_tombstones WHERE workspace_id=? AND machine_id=? AND client_source_id IS NOT NULL ORDER BY deleted_at,source_id').all(this.store.workspaceId, deviceId).map(row => {
      const sourceId = String(row.client_source_id);
      const deletionId = `deletion:${digest(`${this.store.workspaceId}:${deviceId}:${row.source_id}:${row.deleted_at}`)}`;
      const applied = !!this.store.db.prepare('SELECT 1 FROM source_deletion_receipts WHERE workspace_id=? AND machine_id=? AND source_id=? AND deletion_id=?').get(this.store.workspaceId, deviceId, sourceId, deletionId);
      return { sourceId, deletionId, applied };
    });
  }

  private send(response: ServerResponse, status: number, body: unknown): void { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); }
  private async body(request: IncomingMessage): Promise<{ raw: string; value: Record<string, unknown> }> {
    if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') throw new Error('UNSUPPORTED_ENCODING');
    if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('INVALID_CONTENT_TYPE');
    const chunks: Buffer[] = []; let size = 0;
    for await (const part of request) { const chunk = Buffer.from(part); size += chunk.length; if (size > MAX_BYTES) throw new Error('PAYLOAD_TOO_LARGE'); chunks.push(chunk); }
    const raw = Buffer.concat(chunks).toString('utf8'); const value = object(JSON.parse(raw)); if (!value) throw new Error('INVALID_PAYLOAD'); return { raw, value };
  }
  private authenticated(request: IncomingMessage): string {
    const id = request.headers['x-device-id']; const auth = request.headers.authorization;
    if (typeof id !== 'string' || !auth?.startsWith('Bearer ') || auth.length > 256) throw new Error('UNAUTHORIZED');
    const device = this.store.db.prepare("SELECT token_hash FROM devices WHERE id=? AND workspace_id=? AND state='active'").get(id, this.store.workspaceId);
    if (!device || !matching(auth.slice(7), device.token_hash)) throw new Error('UNAUTHORIZED'); return id;
  }
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (request.method !== 'POST') { this.send(response, 405, { error: 'METHOD_NOT_ALLOWED' }); return; }
      if (request.url === '/v2/pair') {
        const { value } = await this.body(request); exactKeys(value, ['workspaceId', 'deviceId', 'pairingCode', 'platform']);
        if (value.workspaceId !== this.store.workspaceId || typeof value.deviceId !== 'string' || typeof value.pairingCode !== 'string') throw new Error('UNAUTHORIZED');
        const device = this.store.db.prepare("SELECT pairing_hash,pairing_expires FROM devices WHERE id=? AND workspace_id=?").get(value.deviceId, this.store.workspaceId);
        if (!device || Number(device.pairing_expires) < Date.now() || !matching(value.pairingCode, device.pairing_hash)) throw new Error('UNAUTHORIZED');
        const token = randomBytes(32).toString('base64url');
        this.store.db.prepare("UPDATE devices SET state='active',token_hash=?,pairing_hash=NULL,pairing_expires=NULL,platform=?,last_seen=?,credential_confirmed_at=NULL,offline_public_key=NULL,offline_registered_at=NULL WHERE id=?").run(digest(token), str(value.platform), new Date().toISOString(), value.deviceId);
        this.store.audit('device.pair', value.deviceId);
        this.send(response, 200, { deviceToken: token, workspaceId: this.store.workspaceId, deviceId: value.deviceId }); this.onChanged?.(); return;
      }
      const deviceId = this.authenticated(request);
      this.store.db.prepare('UPDATE devices SET last_online_seen=? WHERE id=?').run(new Date().toISOString(), deviceId);
      if (request.url === '/v2/offline/register') {
        const { value } = await this.body(request); this.registerOfflineKey(value, deviceId); this.send(response, 200, { registered: true }); this.devicesChanged(); return;
      }
      if (request.url === '/v2/pair/confirm') {
        const { value } = await this.body(request); exactKeys(value, ['workspaceId']);
        if (value.workspaceId !== this.store.workspaceId) throw new Error('UNAUTHORIZED');
        const changed = this.store.db.prepare('UPDATE devices SET credential_confirmed_at=? WHERE id=? AND credential_confirmed_at IS NULL').run(new Date().toISOString(), deviceId);
        if (changed.changes) this.store.audit('device.credential_persisted', deviceId);
        this.send(response, 200, { confirmed: true }); this.devicesChanged(); return;
      }
      if (request.url === '/v2/controls' || request.url === '/v2/controls/ack') {
        const { value } = await this.body(request);
        exactKeys(value, request.url === '/v2/controls' ? ['workspaceId'] : ['workspaceId', 'deletions']);
        if (value.workspaceId !== this.store.workspaceId) throw new Error('UNAUTHORIZED');
        const commands = this.deletions(deviceId);
        if (request.url === '/v2/controls/ack') {
          if (!Array.isArray(value.deletions) || value.deletions.length > 50) throw new Error('INVALID_DELETION_RECEIPT');
          const receipts = value.deletions.map(input => {
            const row = object(input); if (!row) throw new Error('INVALID_DELETION_RECEIPT'); exactKeys(row, ['sourceId', 'deletionId']);
            const command = commands.find(item => item.sourceId === row.sourceId && item.deletionId === row.deletionId);
            if (!command) throw new Error('INVALID_DELETION_RECEIPT'); return command;
          });
          this.store.db.exec('BEGIN IMMEDIATE');
          try {
            for (const item of receipts) {
              const inserted = this.store.db.prepare('INSERT OR IGNORE INTO source_deletion_receipts VALUES(?,?,?,?,?)').run(this.store.workspaceId, deviceId, item.sourceId, item.deletionId, new Date().toISOString());
              if (inserted.changes) this.store.audit('device.source_exclusion_applied', item.deletionId);
            }
            this.store.db.exec('COMMIT');
          } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
          this.send(response, 200, { accepted: true }); this.devicesChanged(); return;
        }
        const ack = String(this.store.db.prepare('SELECT ack FROM devices WHERE id=?').get(deviceId)!.ack);
        this.send(response, 200, { schemaVersion: '1', workspaceId: this.store.workspaceId, deviceId, acknowledgedSequence: ack,
          deletions: commands.filter(item => !item.applied).slice(0, 50).map(({ sourceId, deletionId }) => ({ sourceId, deletionId })) }); return;
      }
      if (request.url === '/v2/project-policies' || request.url === '/v2/project-policies/ack') {
        const { value } = await this.body(request); if (value.workspaceId !== this.store.workspaceId) throw new Error('UNAUTHORIZED');
        if (request.url.endsWith('/ack')) { acknowledgeProjectControls(this.store, deviceId, value); this.send(response, 200, { accepted: true }); this.devicesChanged(); return; }
        exactKeys(value, ['workspaceId','after','snapshotId']);
        const controls = projectControls(this.store, deviceId).map(({ version, controlId, policy }) => ({ version, controlId, policy })).sort((a,b) => a.policy.projectId < b.policy.projectId ? -1 : a.policy.projectId > b.policy.projectId ? 1 : 0);
        const snapshotId = digest(JSON.stringify(controls));
        if (value.snapshotId !== undefined && value.snapshotId !== snapshotId) throw new Error('PROJECT_POLICY_SNAPSHOT_CHANGED');
        let start = 0;
        if (value.after !== undefined) { if (typeof value.after !== 'string') throw new Error('INVALID_PROJECT_POLICY_CURSOR'); const index = controls.findIndex(control => control.policy.projectId === value.after); if (index < 0 || value.snapshotId !== snapshotId) throw new Error('INVALID_PROJECT_POLICY_CURSOR'); start = index + 1; }
        const page = controls.slice(start, start + 32), nextAfter = start + page.length < controls.length ? page.at(-1)!.policy.projectId : null;
        this.send(response, 200, { schemaVersion: 'project-policy-controls/1', workspaceId: this.store.workspaceId, deviceId, snapshotId, acknowledgedSequence: String(this.store.db.prepare('SELECT ack FROM devices WHERE id=?').get(deviceId)!.ack), controls: page, nextAfter }); return;
      }
      if (request.url === '/v2/gaps') {
        const { value } = await this.body(request); const previousAck = String(this.store.db.prepare('SELECT ack FROM devices WHERE id=?').get(deviceId)!.ack); const acknowledgedSequence = this.ingestGap(value, deviceId);
        this.send(response, 200, { acknowledgedSequence, gapRecorded: BigInt(acknowledgedSequence) > BigInt(previousAck) }); this.onChanged?.(); return;
      }
      if (request.url === '/v2/collector-health') {
        const { value } = await this.body(request); exactKeys(value, ['workspaceId','health']); if (value.workspaceId !== this.store.workspaceId) throw new Error('UNAUTHORIZED');
        if (this.deletions(deviceId).some(item => !item.applied) || this.store.db.prepare("SELECT 1 FROM project_policies WHERE workspace_id=? AND (json_extract(record,'$.excluded')=1 OR json_extract(record,'$.metadataDays') IS NOT NULL OR json_extract(record,'$.usageDays') IS NOT NULL) LIMIT 1").get(this.store.workspaceId) && projectPolicySync(this.store, deviceId, 'active').state !== 'applied') throw new Error('COLLECTOR_HEALTH_PRIVACY_PENDING');
        receiveCollectorHealth(this.store, deviceId, value.health);
        this.send(response, 200, { accepted: true, schemaVersion: 'collector-health/1' }); this.devicesChanged(); return;
      }
      if (request.url === '/v2/heartbeat') {
        const { value } = await this.body(request); exactKeys(value, ['workspaceId']); if (value.workspaceId !== this.store.workspaceId) throw new Error('UNAUTHORIZED');
        this.store.db.prepare("UPDATE devices SET last_seen=?,last_online_seen=?,last_ingest_mode='network' WHERE id=?").run(new Date().toISOString(), new Date().toISOString(), deviceId);
        this.send(response, 200, { serverTime: new Date().toISOString() }); this.devicesChanged(); return;
      }
      if (request.url !== '/v2/batches') { this.send(response, 404, { error: 'UNSUPPORTED_METHOD' }); return; }
      const { raw, value } = await this.body(request);
      const acknowledgedSequence = this.ingest(value, raw, deviceId);
      this.send(response, 200, { acknowledgedSequence, serverTime: new Date().toISOString() }); this.onChanged?.();
    } catch (error) {
      const code = (error as Error).message; const safe = /^[A-Z_]+$/.test(code) ? code : 'INVALID_PAYLOAD';
      this.send(response, safe === 'UNAUTHORIZED' ? 401 : safe === 'PAYLOAD_TOO_LARGE' ? 413 : 400, { error: safe });
    }
  }

  private validateBatch(input: unknown, deviceId: string): { body: Record<string, unknown>; sequenceStart: string; sequenceEnd: string; events: MetadataEvent[] } {
    const body = object(input); if (!body) throw new Error('INVALID_PAYLOAD');
    exactKeys(body, ['schemaVersion', 'workspaceId', 'deviceId', 'batchId', 'sequenceStart', 'sequenceEnd', 'createdAt', 'adapterVersion', 'redactionPolicyId', 'events']);
    if (body.schemaVersion !== '2' || body.adapterVersion !== 'codex-passive/1' || body.redactionPolicyId !== 'statistics-only-v2') throw new Error('UNSUPPORTED_SCHEMA');
    if (body.workspaceId !== this.store.workspaceId || body.deviceId !== deviceId) throw new Error('UNAUTHORIZED');
    if (!Array.isArray(body.events) || !body.events.length || body.events.length > 1000 || typeof body.batchId !== 'string' || body.batchId.length > 128 || !timestamp(body.createdAt)) throw new Error('INVALID_PAYLOAD');
    const sequenceStart = integer(body.sequenceStart); const sequenceEnd = integer(body.sequenceEnd);
    if (BigInt(sequenceEnd) - BigInt(sequenceStart) + 1n !== BigInt(body.events.length) || sequenceStart === '0') throw new Error('INVALID_SEQUENCE');
    return { body, sequenceStart, sequenceEnd, events: body.events.map(event => this.validateEvent(event, deviceId)) };
  }

  ingest(input: unknown, raw: string, deviceId: string, mode: 'network' | 'offline' = 'network'): string {
    const { body, sequenceStart, sequenceEnd, events } = this.validateBatch(input, deviceId);
    const device = this.store.db.prepare("SELECT ack FROM devices WHERE id=? AND workspace_id=? AND state='active'").get(deviceId, this.store.workspaceId); if (!device) throw new Error('UNAUTHORIZED');
    const hash = digest(raw); const old = this.store.db.prepare('SELECT digest FROM sync_batches WHERE device_id=? AND batch_id=?').get(deviceId, String(body.batchId));
    if (old) { if (old.digest !== hash) throw new Error('BATCH_DIGEST_CONFLICT'); return String(device.ack); }
    if (BigInt(sequenceStart) !== BigInt(String(device.ack)) + 1n) throw new Error('NONCONTIGUOUS_SEQUENCE');
    // Validate the complete batch before any state mutation.
    const grouped = new Map<string, MetadataEvent[]>();
    for (const event of events) { const group = grouped.get(event.sourceId) ?? []; group.push(event); grouped.set(event.sourceId, group); }
    for (const event of events) {
      const sourceId = `source:${digest(`${this.store.workspaceId}:${deviceId}:${event.sourceId}`)}`;
      const oldPointer = this.store.db.prepare('SELECT record_digest FROM observations WHERE source_id=? AND generation=? AND byte_start=? AND byte_end=?').get(sourceId, event.generation, numericPosition(event.byteStart), numericPosition(event.byteEnd));
      if (oldPointer && oldPointer.record_digest !== digest(JSON.stringify(event))) throw new Error('OBSERVATION_PAYLOAD_CONFLICT');
    }
    for (const [clientSource, group] of grouped) {
      const sourceId = `source:${digest(`${this.store.workspaceId}:${deviceId}:${clientSource}`)}`;
      if (this.store.excluded(sourceId)) continue;
      const previous = this.store.getSource(sourceId); const last = group.at(-1)!;
      const context = { ...EMPTY_CONTEXT, ...last.context, codex: true }; const sameGeneration = !previous || previous.generation === last.generation;
      const cursor: SourceCursor = { id: sourceId, workspaceId: this.store.workspaceId, machineId: deviceId, path: `remote:${deviceId}:${clientSource}`, root: 'remote:', label: `Session ${last.context.threadId?.slice(0, 10) ?? 'unknown'}`,
        generation: last.generation, offset: sameGeneration ? Math.max(previous?.offset ?? 0, numericPosition(last.byteEnd)) : numericPosition(last.byteEnd), line: last.line,
        fileIdentity: clientSource, prefixBytes: 0, prefixDigest: '', checkpointStart: 0, checkpointBytes: 0, checkpointDigest: '', discarding: false, waitingForRecord: false,
        fileBytes: sameGeneration ? Math.max(previous?.fileBytes ?? 0, numericPosition(last.byteEnd)) : numericPosition(last.byteEnd), mtime: 0, lastSeenAt: new Date().toISOString(), context, capabilities: ['statistics-only-v2', 'codex-passive/1', ...(group.some(e => e.measurements.some(m => m.kind === 'response')) ? ['identified_response'] : ['cumulative_interval'])], issues: ['REMOTE_DETAILS_NOT_AUTHORIZED', 'CLOCK_UNCERTAINTY_UNMEASURED'] };
      const rows: PendingObservation[] = group.map(event => {
        const id = `observation:${digest(`${this.store.workspaceId}:${deviceId}:${event.id}`)}`; const evidenceRef = `evidence:${digest(id)}`;
        const measurements = event.measurements.map(m => {
          const identity = { ...m.identity, workspaceId: this.store.workspaceId, originMachineId: deviceId };
          const scopeId = `scope:${digest(JSON.stringify([this.store.workspaceId, deviceId, identity.provider, identity.threadId ?? sourceId]))}`;
          return { ...m, identity, scopeId, responseKey: identity.responseId ? digest(JSON.stringify([this.store.workspaceId, deviceId, identity.provider, identity.threadId, identity.responseId])) : null,
            model: { ...m.model, evidenceRefs: [evidenceRef] } };
        });
        const normalized: NormalizedObservation = { kind: event.kind, sourceTimestamp: event.timestamp, semanticSequence: event.semanticSequence, schemaFingerprint: event.schemaFingerprint, supported: true, issues: [], context: { ...EMPTY_CONTEXT, ...event.context, codex: true }, measurements, metadata: {} };
        return { id, evidenceRef, generation: event.generation, byteStart: numericPosition(event.byteStart), byteEnd: numericPosition(event.byteEnd), line: event.line, recordDigest: digest(JSON.stringify(event)), normalized };
      });
      this.store.commitAuthenticatedDevice(cursor, rows, deviceId);
    }
    this.store.reconcileDirty();
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      this.store.db.prepare('INSERT INTO sync_batches VALUES(?,?,?,?,?,?)').run(deviceId, String(body.batchId), hash, sequenceStart, sequenceEnd, new Date().toISOString());
      this.store.db.prepare('UPDATE devices SET ack=?,last_seen=?,last_ingest_mode=? WHERE id=?').run(sequenceEnd, new Date().toISOString(), mode, deviceId);
      this.store.db.exec('COMMIT');
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    return sequenceEnd;
  }

  registerOfflineKey(input: unknown, deviceId: string): void {
    const value = object(input); if (!value) throw new Error('INVALID_OFFLINE_KEY'); exactKeys(value, ['workspaceId', 'publicKey']);
    if (value.workspaceId !== this.store.workspaceId) throw new Error('UNAUTHORIZED'); const publicKey = validatePublicKey(value.publicKey);
    const device = this.store.db.prepare("SELECT offline_public_key FROM devices WHERE id=? AND workspace_id=? AND state='active'").get(deviceId, this.store.workspaceId);
    if (!device) throw new Error('UNAUTHORIZED'); if (device.offline_public_key && device.offline_public_key !== publicKey) throw new Error('OFFLINE_KEY_CONFLICT');
    if (!device.offline_public_key) {
      this.store.db.prepare('UPDATE devices SET offline_public_key=?,offline_registered_at=? WHERE id=?').run(publicKey, new Date().toISOString(), deviceId);
      this.store.audit('device.offline_key_registered', deviceId);
    }
  }

  ingestGap(input: unknown, deviceId: string): string {
    const value = object(input); if (!value) throw new Error('INVALID_GAP'); exactKeys(value, ['workspaceId', 'from', 'to', 'reason']);
    if (value.workspaceId !== this.store.workspaceId || !['bounded_spool', 'privacy_exclusion', 'multiple'].includes(String(value.reason))) throw new Error('INVALID_GAP');
    const device = this.store.db.prepare("SELECT ack FROM devices WHERE id=? AND workspace_id=? AND state='active'").get(deviceId, this.store.workspaceId); if (!device) throw new Error('UNAUTHORIZED');
    const from = BigInt(integer(value.from)); const to = BigInt(integer(value.to)); const ack = BigInt(String(device.ack));
    if (from === 0n || to < from || from > ack + 1n) throw new Error('NONCONTIGUOUS_SEQUENCE');
    if (to > ack) {
      this.store.db.exec('BEGIN IMMEDIATE');
      try {
        this.store.db.prepare('INSERT OR IGNORE INTO device_gaps VALUES(?,?,?,?,?)').run(deviceId, (ack + 1n).toString(), to.toString(), String(value.reason), new Date().toISOString());
        this.store.db.prepare('UPDATE devices SET ack=? WHERE id=?').run(to.toString(), deviceId); this.store.db.exec('COMMIT');
      } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    }
    return (to > ack ? to : ack).toString();
  }

  offlinePreview(input: unknown): OfflinePreview {
    const supplied = object(input); const payload = object(supplied?.payload);
    if (!payload || payload.workspaceId !== this.store.workspaceId || typeof payload.deviceId !== 'string') throw new Error('UNAUTHORIZED');
    const device = this.store.db.prepare("SELECT name,ack,offline_public_key FROM devices WHERE id=? AND workspace_id=? AND state='active'").get(payload.deviceId, this.store.workspaceId);
    if (!device) throw new Error('UNAUTHORIZED'); if (!device.offline_public_key) throw new Error('OFFLINE_KEY_NOT_REGISTERED');
    const archive = verifyArchive(input, String(device.offline_public_key)); let ack = BigInt(String(device.ack)); let repeated = 0; let added = 0; let events = 0; let start: string | null = null; let end: string | null = null;
    let responseTokens = 0n; let knownResponses = 0; let responses = 0; let counters = 0;
    if (archive.payload.gap) { const gap = archive.payload.gap; if (BigInt(gap.from) > ack + 1n) throw new Error('NONCONTIGUOUS_SEQUENCE'); if (BigInt(gap.to) > ack) ack = BigInt(gap.to); }
    const positions = new Map<string, string>(); const batches = new Set<string>();
    for (const raw of archive.payload.packets) {
      const parsed = JSON.parse(raw); const validated = this.validateBatch(parsed, archive.payload.deviceId); const hash = digest(raw); const batchId = String(validated.body.batchId);
      if (batches.has(batchId)) throw new Error('DUPLICATE_OFFLINE_BATCH'); batches.add(batchId);
      const previous = this.store.db.prepare('SELECT digest FROM sync_batches WHERE device_id=? AND batch_id=?').get(archive.payload.deviceId, batchId);
      if (previous) { if (previous.digest !== hash) throw new Error('BATCH_DIGEST_CONFLICT'); repeated++; }
      else { if (BigInt(validated.sequenceStart) !== ack + 1n) throw new Error('NONCONTIGUOUS_SEQUENCE'); ack = BigInt(validated.sequenceEnd); added++; }
      start ??= validated.sequenceStart; end = validated.sequenceEnd; events += validated.events.length;
      for (const event of validated.events) {
        for (const measurement of event.measurements) { if (measurement.kind === 'response') { responses++; if (measurement.values.total !== null) { responseTokens += BigInt(measurement.values.total); knownResponses++; } } else counters++; }
        const sourceId = `source:${digest(`${this.store.workspaceId}:${archive.payload.deviceId}:${event.sourceId}`)}`; const key = `${sourceId}:${event.generation}:${event.byteStart}:${event.byteEnd}`; const value = digest(JSON.stringify(event));
        const old = this.store.db.prepare('SELECT record_digest FROM observations WHERE source_id=? AND generation=? AND byte_start=? AND byte_end=?').get(sourceId, event.generation, numericPosition(event.byteStart), numericPosition(event.byteEnd));
        if (old && old.record_digest !== value || positions.has(key) && positions.get(key) !== value) throw new Error('OBSERVATION_PAYLOAD_CONFLICT'); positions.set(key, value);
      }
    }
    return { archiveId: `offline:${digest(JSON.stringify(archive))}`, deviceId: archive.payload.deviceId, deviceName: String(device.name), createdAt: archive.payload.createdAt, batchCount: archive.payload.packets.length, eventCount: events, responseTokenSubtotal: knownResponses ? responseTokens.toString() : null, responseMeasurements: responses, counterMeasurements: counters, newBatches: added, repeatedBatches: repeated, sequenceStart: start, sequenceEnd: end, currentAck: String(device.ack), gap: archive.payload.gap,
      issues: ['STATISTICS_ONLY_NO_RAW_CONTENT', 'CLOCK_UNCERTAINTY_UNMEASURED', 'CLIENT_QUEUE_ACK_WAITING_FOR_AUTHENTICATED_RECONNECT', ...(archive.payload.gap ? ['SIGNED_TRANSPORT_GAP_INCLUDED'] : [])] };
  }

  importOffline(input: unknown): { acknowledgedSequence: string; importedBatches: number; repeatedBatches: number; interrupted: string | null } {
    const preview = this.offlinePreview(input); const archive = input as OfflineArchive; let imported = 0; let repeated = 0; let ack = preview.currentAck; let interrupted: string | null = null;
    try {
      if (archive.payload.gap) ack = this.ingestGap({ workspaceId: this.store.workspaceId, ...archive.payload.gap }, preview.deviceId);
      for (const raw of archive.payload.packets) {
        const parsed = JSON.parse(raw); const old = this.store.db.prepare('SELECT 1 FROM sync_batches WHERE device_id=? AND batch_id=?').get(preview.deviceId, parsed.batchId);
        ack = this.ingest(parsed, raw, preview.deviceId, 'offline'); if (old) repeated++; else imported++;
      }
      this.store.audit('offline.import', preview.archiveId);
    } catch (error) { const message = (error as Error).message; interrupted = /^[A-Z_]+$/.test(message) ? message : 'OFFLINE_IMPORT_INTERRUPTED'; }
    this.onChanged?.(); return { acknowledgedSequence: ack, importedBatches: imported, repeatedBatches: repeated, interrupted };
  }

  private validateEvent(input: unknown, deviceId: string): MetadataEvent {
    const e = object(input); if (!e) throw new Error('INVALID_EVENT');
    exactKeys(e, ['id', 'sourceId', 'generation', 'byteStart', 'byteEnd', 'line', 'semanticSequence', 'timestamp', 'kind', 'schemaFingerprint', 'context', 'measurements']);
    if (typeof e.id !== 'string' || !/^observation:[a-f0-9]{64}$/.test(e.id) || typeof e.sourceId !== 'string' || !/^source:[a-f0-9]{64}$/.test(e.sourceId) || typeof e.schemaFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(e.schemaFingerprint)) throw new Error('INVALID_EVENT_ID');
    if (!Number.isSafeInteger(e.generation) || Number(e.generation) < 0 || !Number.isSafeInteger(e.line) || Number(e.line) < 1 || numericPosition(e.byteEnd) <= numericPosition(e.byteStart)) throw new Error('INVALID_POSITION');
    if (e.id !== `observation:${digest(`${e.sourceId}:${e.generation}:${e.byteStart}:${e.byteEnd}`)}`) throw new Error('INVALID_EVENT_ID');
    if (e.semanticSequence !== null) integer(e.semanticSequence); if (e.timestamp !== null && !timestamp(e.timestamp)) throw new Error('INVALID_TIMESTAMP');
    if (!['token_usage_record', 'event_msg/token_count'].includes(String(e.kind))) throw new Error('UNSUPPORTED_SCHEMA');
    const context = object(e.context); if (!context) throw new Error('INVALID_CONTEXT');
    exactKeys(context, ['threadId', 'sessionId', 'parentThreadId', 'forkedFromId', 'runtimeVersion', 'requestedModel', 'providerRoute', 'serviceTier', 'projectId', 'turnId']);
    for (const value of Object.values(context)) if (value !== null && (typeof value !== 'string' || value.length > 256 || /[\r\n\\]/.test(value))) throw new Error('NON_STATISTICS_FIELD');
    if (context.projectId !== null && !/^project:[a-f0-9]{24}$/.test(String(context.projectId))) throw new Error('NON_STATISTICS_FIELD');
    if (!Array.isArray(e.measurements) || !e.measurements.length || e.measurements.length > 4) throw new Error('INVALID_MEASUREMENTS');
    for (const inputMeasurement of e.measurements) {
      const m = object(inputMeasurement); if (!m) throw new Error('INVALID_MEASUREMENTS');
      exactKeys(m, ['kind', 'identity', 'model', 'values', 'nativeTotal', 'presence', 'issues', 'scopeId', 'responseKey']);
      if (!['response', 'thread_counter', 'turn_counter', 'last_unidentified'].includes(String(m.kind))) throw new Error('UNSUPPORTED_SCHEMA');
      const values = object(m.values); const identity = object(m.identity); const model = object(m.model);
      if (!values || !identity || !model) throw new Error('INVALID_MEASUREMENTS');
      exactKeys(values, [...TOKEN_FIELDS]); for (const field of TOKEN_FIELDS) { if (!Object.hasOwn(values, field)) throw new Error('INVALID_MEASUREMENTS'); if (values[field] !== null) integer(values[field]); }
      exactKeys(identity, ['workspaceId', 'originMachineId', 'projectId', 'runId', 'agentId', 'provider', 'threadId', 'sessionId', 'rootTurnId', 'turnId', 'responseId']);
      if (identity.workspaceId !== this.store.workspaceId || identity.originMachineId !== deviceId) throw new Error('UNAUTHORIZED');
      for (const value of Object.values(identity)) if (value !== null && (typeof value !== 'string' || value.length > 256 || /[\r\n\\]/.test(value))) throw new Error('NON_STATISTICS_FIELD');
      if (identity.projectId !== null && !/^project:[a-f0-9]{24}$/.test(String(identity.projectId))) throw new Error('NON_STATISTICS_FIELD');
      if (e.kind === 'event_msg/token_count' && (m.kind === 'response' || m.kind === 'turn_counter' || identity.responseId !== null)) throw new Error('UNSUPPORTED_SCHEMA');
      exactKeys(model, ['requestedModel', 'observedModel', 'providerRoute', 'serviceTier', 'quotaAlias', 'provenance', 'evidenceRefs']);
      if (!['observed', 'derived', 'estimated', 'unknown', 'conflicted'].includes(String(model.provenance)) || !Array.isArray(model.evidenceRefs)) throw new Error('INVALID_MODEL');
      for (const field of ['requestedModel', 'observedModel', 'providerRoute', 'serviceTier', 'quotaAlias']) if (model[field] !== null && !str(model[field])) throw new Error('INVALID_MODEL');
      if (m.nativeTotal !== null) integer(m.nativeTotal);
      if (!Array.isArray(m.presence) || m.presence.some(p => !['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'].includes(String(p)))) throw new Error('INVALID_PRESENCE');
      if (!Array.isArray(m.issues) || m.issues.length > 20 || m.issues.some(i => typeof i !== 'string' || !/^[A-Za-z0-9_:]+$/.test(i))) throw new Error('INVALID_ISSUES');
      if (m.kind === 'response' && (!str(identity.responseId) || !str(identity.threadId))) throw new Error('INVALID_RESPONSE_ID');
      const checked = m as unknown as UsageMeasurement;
      checked.issues = [...new Set([...checked.issues, ...validateValues(checked.values, checked.nativeTotal)])];
      if (!checked.issues.includes('INTEGER_OVERFLOW')) {
        const canonical = totalFromParts(checked.values);
        if (canonical.total !== checked.values.total) throw new Error('NORMALIZED_TOTAL_CONFLICT');
      }
      checked.model.evidenceRefs = [];
    }
    return e as unknown as MetadataEvent;
  }
}
