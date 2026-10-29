import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { InspectorStore } from '../storage/InspectorStore';
import { deleteSource, applyRetention, hasExpiredRetention } from '../storage/privacy';
import { pruneContent } from '../storage/local-content';
import { integer } from '../accounting/integers';
import { object, type NormalizedObservation } from '../accounting/codex-observations';
import type { CollectorCredential } from './ProtectedCredentials';
import { protectedEndpoint, type MetadataBatch, type MetadataEvent, type SourceDeletion, type SpoolGapReason } from '../transport/protocol';
import { validateProjectControl, checkedProjectControls, applyProjectControls, localPolicyReceiptKey } from '../transport/project-policy-controls';
import type { ProjectPolicyControl } from '../transport/protocol';

export interface ClientConfig { schemaVersion: '2'; workspaceId: string; deviceId: string; deviceName: string; endpoint: string; credentialFile: string; offlinePublicKey?: string; }
const MAX_SPOOL_BYTES = 256 * 1024 * 1024;
const MAX_SPOOL_AGE_MS = 7 * 86400000;

export async function confirmEnrollment(config: ClientConfig, credential: CollectorCredential): Promise<boolean> {
  try {
    const reply = await request(config.endpoint, '/v2/pair/confirm', { workspaceId: config.workspaceId }, config, credential);
    if (reply.confirmed !== true) throw new Error('PAIRING_CONFIRMATION_PENDING');
    return true;
  } catch (error) { if ((error as Error).message !== 'UNSUPPORTED_METHOD') throw error; return false; }
}

function rememberGap(store: InspectorStore, from: string, to: string, reason: SpoolGapReason): void {
  if (BigInt(from) > BigInt(to)) return;
  const previous = JSON.parse(store.getSetting('spool_gap') ?? 'null') as { from: string; to: string; reason: SpoolGapReason } | null;
  store.setSetting('spool_gap', JSON.stringify({ from: previous && BigInt(previous.from) < BigInt(from) ? previous.from : from,
    to: previous && BigInt(previous.to) > BigInt(to) ? previous.to : to, reason: previous && previous.reason !== reason ? 'multiple' : reason }));
}

function deletion(value: unknown): SourceDeletion {
  const row = object(value);
  if (!row || Object.keys(row).some(key => !['sourceId', 'deletionId'].includes(key)) || typeof row.sourceId !== 'string' || !/^source:[a-f0-9]{64}$/.test(row.sourceId)
    || typeof row.deletionId !== 'string' || !/^deletion:[a-f0-9]{64}$/.test(row.deletionId)) throw new Error('INVALID_DELETION_CONTROL');
  return { sourceId: row.sourceId, deletionId: row.deletionId };
}

/** Complete a persisted exclusion even while offline, before reading or queuing more data. */
export async function recoverPrivacyReset(store: InspectorStore, config: ClientConfig, spool: string): Promise<void> {
  const saved = store.getSetting('privacy_reset_spool'); if (!saved) return;
  const plan = JSON.parse(saved) as { through: string; deletions: SourceDeletion[]; projectPolicies?: ProjectPolicyControl[]; retention?: true };
  integer(plan.through); const commands = plan.deletions.map(deletion);
  const policies = plan.projectPolicies ? checkedProjectControls(store, plan.projectPolicies) : undefined;
  if (policies && (store.workspaceId !== config.workspaceId || store.machineId !== config.deviceId)) throw new Error('INVALID_PROJECT_POLICY_CONTROL');
  // The plan/gap are durable before any encrypted file or indexed observation is removed.
  rememberGap(store, (BigInt(store.getSetting('acknowledged_sequence') ?? '0') + 1n).toString(), plan.through, 'privacy_exclusion');
  for (const name of await fs.readdir(spool)) if (/^\d+-\d+\.enc(?:\.tmp)?$/.test(name)) await fs.unlink(path.join(spool, name));
  for (const command of commands) {
    const source = store.getSource(command.sourceId);
    if (source && source.machineId !== config.deviceId) throw new Error('INVALID_DELETION_CONTROL');
    if (source) deleteSource(store, command.sourceId);
    else store.db.prepare('INSERT OR IGNORE INTO exclusions VALUES(?,?,?)').run(command.sourceId, new Date().toISOString(), 'receiver_delete');
  }
  if (policies) applyProjectControls(store, policies);
  if (plan.retention) applyRetention(store);
  store.db.exec('BEGIN IMMEDIATE');
  try {
    for (const command of commands) store.db.prepare('INSERT OR IGNORE INTO source_deletion_receipts VALUES(?,?,?,?,?)').run(config.workspaceId, config.deviceId, command.sourceId, command.deletionId, new Date().toISOString());
    for (const command of policies ?? []) store.setSetting(localPolicyReceiptKey(command.policy.projectId), JSON.stringify({ version: command.version, controlId: command.controlId }));
    // Non-excluded observations are replayed under new transport sequences with their original canonical identities.
    store.setSetting('export_rowid', '0'); store.setSetting('export_sequence', plan.through);
    store.db.prepare("DELETE FROM settings WHERE key='privacy_reset_spool'").run();
    store.audit('collector.source_exclusions', String(commands.length)); store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
}

/** Cached constraints continue expiring local and queued copies even while the hub is offline. */
export async function expireCollectorRetention(store: InspectorStore, config: ClientConfig, spool: string): Promise<void> {
  if (!hasExpiredRetention(store)) { pruneContent(store); return; }
  let through = BigInt(store.getSetting('export_sequence') ?? '0');
  for (const name of await fs.readdir(spool)) { const match = /^\d+-(\d+)\.enc(?:\.tmp)?$/.exec(name); if (match) { const end = BigInt(integer(match[1])); if (end > through) through = end; } }
  store.setSetting('privacy_reset_spool', JSON.stringify({ through: through.toString(), deletions: [], retention: true }));
  await recoverPrivacyReset(store, config, spool);
}

/** Visit the complete bounded policy pages every poll; restored client databases cannot rely on hub receipts. */
export async function synchronizeProjectPolicies(store: InspectorStore, config: ClientConfig, credential: CollectorCredential, spool: string): Promise<void> {
  if (store.workspaceId !== config.workspaceId || store.machineId !== config.deviceId) throw new Error('INVALID_PROJECT_POLICY_CONTROL');
  let after: string | undefined, snapshotId: string | undefined;
  do {
    let reply;
    try { reply = await request(config.endpoint, '/v2/project-policies', { workspaceId: config.workspaceId, ...(after ? { after, snapshotId } : {}) }, config, credential); }
    catch (error) { if ((error as Error).message === 'UNSUPPORTED_METHOD') return; throw error; }
    if (reply.schemaVersion !== 'project-policy-controls/1' || reply.workspaceId !== config.workspaceId || reply.deviceId !== config.deviceId || typeof reply.snapshotId !== 'string' || !/^[a-f0-9]{64}$/.test(reply.snapshotId) || snapshotId && reply.snapshotId !== snapshotId || !Array.isArray(reply.controls) || reply.controls.length > 32 || reply.nextAfter !== null && typeof reply.nextAfter !== 'string') throw new Error('INVALID_PROJECT_POLICY_CONTROL');
    const controls = reply.controls.map(value => validateProjectControl(config.workspaceId, value));
    if (new Set(controls.map(control => control.policy.projectId)).size !== controls.length || controls.some((control,index) => index ? control.policy.projectId <= controls[index-1].policy.projectId : after !== undefined && control.policy.projectId <= after) || reply.nextAfter !== null && (!controls.length || reply.nextAfter !== controls.at(-1)!.policy.projectId)) throw new Error('INVALID_PROJECT_POLICY_CONTROL');
    const unapplied = controls.filter(control => { const saved = store.getSetting(localPolicyReceiptKey(control.policy.projectId)); const receipt = saved ? JSON.parse(saved) : null; return receipt?.controlId !== control.controlId || receipt.version !== control.version; });
    if (unapplied.length) {
      let through = BigInt(store.getSetting('export_sequence') ?? '0'); const ack = BigInt(integer(reply.acknowledgedSequence)); if (ack > through) through = ack;
      for (const name of await fs.readdir(spool)) { const match = /^\d+-(\d+)\.enc(?:\.tmp)?$/.exec(name); if (match) { const end = BigInt(integer(match[1])); if (end > through) through = end; } }
      store.setSetting('privacy_reset_spool', JSON.stringify({ through: through.toString(), deletions: [], projectPolicies: unapplied }));
      await recoverPrivacyReset(store, config, spool); await enqueue(store, config, credential, spool);
    }
    if (controls.length) { const response = await request(config.endpoint, '/v2/project-policies/ack', { workspaceId: config.workspaceId, controls: controls.map(control => ({ projectId: control.policy.projectId, version: control.version, controlId: control.controlId })) }, config, credential); if (response.accepted !== true) throw new Error('PROJECT_POLICY_NOT_ACKNOWLEDGED'); }
    snapshotId = reply.snapshotId; after = reply.nextAfter as string | null ?? undefined;
  } while (after);
}

export async function synchronizeDeletions(store: InspectorStore, config: ClientConfig, credential: CollectorCredential, spool: string): Promise<void> {
  let controls;
  try { controls = await request(config.endpoint, '/v2/controls', { workspaceId: config.workspaceId }, config, credential); }
  catch (error) { if ((error as Error).message === 'UNSUPPORTED_METHOD') return; throw error; }
  if (controls.schemaVersion !== '1' || controls.workspaceId !== config.workspaceId || controls.deviceId !== config.deviceId || !Array.isArray(controls.deletions) || controls.deletions.length > 50) throw new Error('INVALID_DELETION_CONTROL');
  const acknowledged = integer(controls.acknowledgedSequence); const commands = controls.deletions.map(deletion);
  if (!commands.length) return;
  const unapplied = commands.filter(command => !store.db.prepare('SELECT 1 FROM source_deletion_receipts WHERE workspace_id=? AND machine_id=? AND source_id=? AND deletion_id=?').get(config.workspaceId, config.deviceId, command.sourceId, command.deletionId));
  if (unapplied.length) {
    let through = BigInt(store.getSetting('export_sequence') ?? '0');
    if (BigInt(acknowledged) > through) through = BigInt(acknowledged);
    for (const name of await fs.readdir(spool)) {
      const match = /^\d+-(\d+)\.enc(?:\.tmp)?$/.exec(name); if (!match) continue;
      const end = BigInt(integer(match[1])); if (end > through) through = end;
    }
    store.setSetting('privacy_reset_spool', JSON.stringify({ through: through.toString(), deletions: unapplied }));
    await recoverPrivacyReset(store, config, spool);
    await enqueue(store, config, credential, spool);
  }
  const reply = await request(config.endpoint, '/v2/controls/ack', { workspaceId: config.workspaceId, deletions: commands }, config, credential);
  if (reply.accepted !== true) throw new Error('DELETION_NOT_ACKNOWLEDGED');
}

async function writeSpool(filename: string, body: string): Promise<void> {
  const temporary = `${filename}.tmp`; const file = await fs.open(temporary, 'w', 0o600);
  try { await file.writeFile(body); await file.sync(); } finally { await file.close(); }
  await fs.rename(temporary, filename);
  if (process.platform !== 'win32') { const directory = await fs.open(path.dirname(filename), 'r'); try { await directory.sync(); } finally { await directory.close(); } }
}

export async function request(endpoint: string, route: string, value: unknown, config?: ClientConfig, credential?: CollectorCredential): Promise<Record<string, unknown>> {
  const response = await fetch(`${protectedEndpoint(endpoint)}${route}`, { method: 'POST', signal: AbortSignal.timeout(60000), redirect: 'error',
    headers: { 'content-type': 'application/json', connection: 'close', ...(config && credential ? { 'x-device-id': config.deviceId, authorization: `Bearer ${credential.token}` } : {}) }, body: JSON.stringify(value) });
  const reader = response.body?.getReader(); if (!reader) throw new Error('INVALID_RECEIVER_RESPONSE');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > 16384) { await reader.cancel(); throw new Error('INVALID_RECEIVER_RESPONSE'); } chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const body = object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if (!body) throw new Error('INVALID_RECEIVER_RESPONSE'); if (!response.ok) throw new Error(typeof body.error === 'string' && /^[A-Z_]+$/.test(body.error) ? body.error : 'RECEIVER_REJECTED');
  return body;
}


function protect(body: string, credential: CollectorCredential): string {
  const nonce = randomBytes(12); const key = createHash('sha256').update(`spool:${credential.fingerprintKey}`).digest();
  const cipher = createCipheriv('aes-256-gcm', key, nonce); const payload = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()]);
  return JSON.stringify({ version: '1', nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), payload: payload.toString('base64') });
}
export function unprotect(body: string, credential: CollectorCredential): string {
  const packet = JSON.parse(body); if (packet.version !== '1') throw new Error('INVALID_SPOOL');
  const key = createHash('sha256').update(`spool:${credential.fingerprintKey}`).digest(); const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(packet.nonce, 'base64'));
  decipher.setAuthTag(Buffer.from(packet.tag, 'base64')); return Buffer.concat([decipher.update(Buffer.from(packet.payload, 'base64')), decipher.final()]).toString('utf8');
}

function eventOf(row: Record<string, unknown>): MetadataEvent {
  const n = JSON.parse(String(row.normalized)) as NormalizedObservation; const c = n.context;
  return { id: String(row.id), sourceId: String(row.source_id), generation: Number(row.generation), byteStart: String(row.byte_start), byteEnd: String(row.byte_end), line: Number(row.line),
    semanticSequence: n.semanticSequence, timestamp: n.sourceTimestamp, kind: n.kind as MetadataEvent['kind'], schemaFingerprint: n.schemaFingerprint,
    context: { threadId: c.threadId, sessionId: c.sessionId, parentThreadId: c.parentThreadId, forkedFromId: c.forkedFromId, runtimeVersion: c.runtimeVersion, requestedModel: c.requestedModel,
      providerRoute: c.providerRoute, serviceTier: c.serviceTier, projectId: c.projectId, turnId: c.turnId },
    measurements: n.measurements.map(m => ({ ...m, model: { ...m.model, evidenceRefs: [] } })) };
}

export async function enqueue(store: InspectorStore, config: ClientConfig, credential: CollectorCredential, spool: string, isStopping = () => false): Promise<void> {
  for (const name of await fs.readdir(spool)) if (/^\d+-\d+\.enc\.tmp$/.test(name)) await fs.unlink(path.join(spool, name));
  let after = Number(store.getSetting('export_rowid') ?? '0'); let next = BigInt(store.getSetting('export_sequence') ?? '0') + 1n;
  const existing = (await fs.readdir(spool)).filter(name => /^\d+-\d+\.enc$/.test(name)).sort();
  let currentBytes = 0;
  for (const filename of existing) {
    currentBytes += (await fs.stat(path.join(spool, filename))).size;
    const packet = JSON.parse(unprotect(await fs.readFile(path.join(spool, filename), 'utf8'), credential)) as MetadataBatch;
    if (BigInt(packet.sequenceStart) === next) {
      const row = store.db.prepare('SELECT rowid AS cursor FROM observations WHERE id=?').get(packet.events.at(-1)!.id);
      if (!row) throw new Error('SPOOL_SOURCE_UNAVAILABLE');
      after = Number(row.cursor); next = BigInt(packet.sequenceEnd) + 1n;
      store.setSetting('export_rowid', String(after)); store.setSetting('export_sequence', packet.sequenceEnd);
    }
  }
  while (!isStopping()) {
    if (currentBytes >= MAX_SPOOL_BYTES - 2 * 1024 * 1024) return;
    const rows = store.db.prepare("SELECT rowid AS cursor,* FROM observations WHERE rowid>? AND kind IN ('token_usage_record','event_msg/token_count') AND json_array_length(json_extract(normalized,'$.measurements'))>0 ORDER BY rowid LIMIT 200").all(after);
    if (!rows.length) return;
    const events: MetadataEvent[] = []; let bytes = 0; let last = after;
    for (const row of rows) { const event = eventOf(row); const size = Buffer.byteLength(JSON.stringify(event)); if (size > 800000) throw new Error('METADATA_EVENT_TOO_LARGE'); if (bytes + size > 800000 && events.length) break; events.push(event); bytes += size; last = Number(row.cursor); }
    const end = next + BigInt(events.length) - 1n;
    const batch: MetadataBatch = { schemaVersion: '2', workspaceId: config.workspaceId, deviceId: config.deviceId, batchId: randomUUID(), sequenceStart: next.toString(), sequenceEnd: end.toString(),
      createdAt: new Date().toISOString(), adapterVersion: 'codex-passive/1', redactionPolicyId: 'statistics-only-v2', events };
    const filename = path.join(spool, `${next.toString().padStart(20, '0')}-${end}.enc`);
    const protectedBody = protect(JSON.stringify(batch), credential);
    await writeSpool(filename, protectedBody); currentBytes += Buffer.byteLength(protectedBody);
    // A crash after file creation replays a durable batch; a crash after this
    // transaction cannot lose observations from the export cursor.
    store.db.exec('BEGIN IMMEDIATE');
    try { store.setSetting('export_rowid', String(last)); store.setSetting('export_sequence', end.toString()); store.db.exec('COMMIT'); }
    catch (error) { store.db.exec('ROLLBACK'); throw error; }
    after = last; next = end + 1n;
  }
}

export async function pruneSpool(store: InspectorStore, spool: string): Promise<void> {
  const names = (await fs.readdir(spool)).filter(name => /^\d+-\d+\.enc$/.test(name)).sort();
  let bytes = 0;
  const stats = [];
  for (const name of names) { const stat = await fs.stat(path.join(spool, name)); bytes += stat.size; stats.push({ name, stat }); }
  // Drop only monitor-owned encrypted spool files, recording the exact gap.
  const expired: string[] = []; let droppedFrom: string | null = null; let droppedTo: string | null = null;
  const lastExpired = stats.reduce((last, item, i) => Date.now() - item.stat.mtimeMs > MAX_SPOOL_AGE_MS ? i : last, -1);
  for (let i = 0; i < stats.length; i++) {
    const item = stats[i];
    if (i > lastExpired && bytes <= MAX_SPOOL_BYTES) break;
    const [from, to] = item.name.replace('.enc', '').split('-'); droppedFrom ??= BigInt(from).toString(); droppedTo = to;
    expired.push(item.name); bytes -= item.stat.size;
  }
  if (droppedFrom && droppedTo) {
    rememberGap(store, droppedFrom, droppedTo, 'bounded_spool');
    for (const name of expired) await fs.unlink(path.join(spool, name));
    console.log('DATA_GAP: expired or capacity-limited spool range retained as metadata.');
  }
}

export async function sendSpool(store: InspectorStore, config: ClientConfig, credential: CollectorCredential, spool: string, isStopping = () => false): Promise<void> {
  await pruneSpool(store, spool);
  const names = (await fs.readdir(spool)).filter(name => /^\d+-\d+\.enc$/.test(name)).sort();
  const gap = store.getSetting('spool_gap');
  if (gap) {
    const range = JSON.parse(gap); const reply = await request(config.endpoint, '/v2/gaps', { workspaceId: config.workspaceId, ...range }, config, credential);
    const ack = integer(reply.acknowledgedSequence); if (BigInt(ack) < BigInt(range.to)) throw new Error('ACK_NOT_DURABLE');
    store.setSetting('acknowledged_sequence', ack); store.db.prepare("DELETE FROM settings WHERE key='spool_gap'").run();
  }
  for (const name of names) {
    if (isStopping()) return; const filename = path.join(spool, name);
    const end = BigInt(name.replace('.enc', '').split('-')[1]);
    if (end <= BigInt(store.getSetting('acknowledged_sequence') ?? '0')) { await fs.unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error; }); continue; }
    const encrypted = await fs.readFile(filename, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; }); if (!encrypted) continue;
    const batch = JSON.parse(unprotect(encrypted, credential)) as MetadataBatch;
    const reply = await request(config.endpoint, '/v2/batches', batch, config, credential);
    if (typeof reply.acknowledgedSequence !== 'string' || BigInt(reply.acknowledgedSequence) < BigInt(batch.sequenceEnd)) throw new Error('ACK_NOT_DURABLE');
    store.setSetting('acknowledged_sequence', reply.acknowledgedSequence); await fs.unlink(filename);
  }
}
