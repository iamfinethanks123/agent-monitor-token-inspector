import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { MetadataReceiver } from '../src/transport/MetadataReceiver';
import { newOfflineSigningKey, offlinePublicKey, signedArchive, type OfflineArchive } from '../src/transport/offline';
import { enqueue, request, sendSpool, type ClientConfig } from '../src/collector/metadata-sync';
import { exportOffline } from '../src/collector/offline-export';
import { clientLock } from '../src/collector/client-lock';
import { deleteSource } from '../src/storage/privacy';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-offline-')); const traces = path.join(root, 'traces'); const spool = path.join(root, 'spool'); const output = path.join(root, 'export');
  await mkdir(traces); await mkdir(spool); const hub = new InspectorStore(path.join(root, 'hub.sqlite')); let receiver = new MetadataReceiver(hub); await receiver.start(0);
  const pairing = receiver.enroll('Synthetic offline Windows'); const reply = await request(pairing.endpoint, '/v2/pair', { workspaceId: pairing.workspaceId, deviceId: pairing.deviceId, pairingCode: pairing.pairingCode, platform: 'synthetic' });
  const credential = { token: String(reply.deviceToken), fingerprintKey: randomBytes(32).toString('base64'), offlineSigningKey: newOfflineSigningKey() };
  const config: ClientConfig = { schemaVersion: '2', workspaceId: pairing.workspaceId, deviceId: pairing.deviceId, deviceName: 'Synthetic offline Windows', endpoint: pairing.endpoint, credentialFile: 'not-used', offlinePublicKey: offlinePublicKey(credential.offlineSigningKey) };
  await request(config.endpoint, '/v2/offline/register', { workspaceId: config.workspaceId, publicKey: config.offlinePublicKey }, config, credential);
  const client = new InspectorStore(path.join(root, 'client.sqlite'), { workspaceId: config.workspaceId, machineId: config.deviceId });
  const source = path.join(traces, 'trace.jsonl'); await writeFile(source, [
    { type: 'session_meta', payload: { id: 'offline-run', cwd: '/PRIVATE_SOURCE_PATH', model_provider: 'openai' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'PRIVATE_PROMPT_MARKER' }] } },
    { type: 'token_usage_record', timestamp: '2026-10-13T00:00:00Z', payload: { thread_id: 'offline-run', response_id: 'offline-response', usage: { input_tokens: 100, output_tokens: 2 } } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  const collector = new IndexCollector(client, [traces]); await collector.scan(); await enqueue(client, config, credential, spool);
  const exported = await exportOffline(client, config, credential, spool, output); const body = await readFile(exported.files[0], 'utf8'); const archive = JSON.parse(body) as OfflineArchive;
  return { root, traces, spool, output, hub, get receiver() { return receiver; }, config, credential, client, source, collector, archive, body,
    async restartReceiver() { await receiver.stop(); receiver = new MetadataReceiver(hub); await receiver.start(0); config.endpoint = receiver.view().endpoint; },
    async close() { client.close(); await receiver.stop(); hub.close(); await rm(root, { recursive: true, force: true }); } };
}

test('signed offline metadata previews without mutation, imports once and reconnect drains the same IDs', async () => {
  const f = await fixture();
  try {
    for (const value of ['PRIVATE_PROMPT_MARKER', '/PRIVATE_SOURCE_PATH', f.credential.token, f.credential.fingerprintKey, 'BEGIN PRIVATE KEY']) assert.equal(f.body.includes(value), false);
    const files = (await readdir(f.spool)).filter(name => name.endsWith('.enc')); assert.equal(files.length, 1); assert.equal(f.client.getSetting('acknowledged_sequence'), null);
    const preview = f.receiver.offlinePreview(f.archive); assert.equal(preview.newBatches, 1); assert.equal(f.hub.observationCount(), 0);
    f.hub.db.prepare('UPDATE devices SET last_online_seen=? WHERE id=?').run('2026-01-01T00:00:00Z', f.config.deviceId);
    const imported = f.receiver.importOffline(f.archive); assert.equal(imported.interrupted, null); assert.equal(imported.acknowledgedSequence, '1'); assert.equal(f.hub.summary().usage.total.value, '102');
    assert.equal(f.receiver.view().devices.find(device => device.id === f.config.deviceId)!.online, false); assert.equal(f.receiver.view().devices.find(device => device.id === f.config.deviceId)!.lastIngestMode, 'offline');
    const identity = f.hub.ledger().items[0].id; await f.restartReceiver(); assert.equal(f.receiver.importOffline(f.archive).repeatedBatches, 1); assert.equal(f.hub.ledger().items[0].id, identity);
    await sendSpool(f.client, f.config, f.credential, f.spool); assert.equal((await readdir(f.spool)).filter(name => name.endsWith('.enc')).length, 0); assert.equal(f.hub.summary().usage.total.value, '102');
  } finally { await f.close(); }
});

test('tampering, foreign workspaces, unknown keys and revocation reject archives before mutation', async () => {
  const f = await fixture();
  try {
    const altered = structuredClone(f.archive); altered.payload.packets[0] = altered.payload.packets[0].replace('100', '101');
    assert.throws(() => f.receiver.offlinePreview(altered), /INVALID_OFFLINE_SIGNATURE/);
    const foreign = signedArchive({ ...f.archive.payload, workspaceId: randomUUID() }, f.credential.offlineSigningKey); assert.throws(() => f.receiver.offlinePreview(foreign), /UNAUTHORIZED/);
    const unsigned = signedArchive(f.archive.payload, newOfflineSigningKey()); assert.throws(() => f.receiver.offlinePreview(unsigned), /INVALID_OFFLINE_SIGNATURE/);
    const packet = JSON.parse(f.archive.payload.packets[0]); packet.prompt = 'PRIVATE_PROMPT_MARKER';
    const forbidden = signedArchive({ ...f.archive.payload, packets: [JSON.stringify(packet)] }, f.credential.offlineSigningKey); assert.throws(() => f.receiver.offlinePreview(forbidden), /NON_STATISTICS_FIELD/);
    assert.equal(f.hub.observationCount(), 0); f.receiver.revoke(f.config.deviceId); assert.throws(() => f.receiver.importOffline(f.archive), /UNAUTHORIZED/);
    assert.equal(f.hub.summary().selectedEntries, 0);
  } finally { await f.close(); }
});

test('signed gaps and durable partial imports resume without duplicated accounting or deletion resurrection', async () => {
  const f = await fixture();
  try {
    await appendFile(f.source, JSON.stringify({ type: 'token_usage_record', payload: { thread_id: 'offline-run', response_id: 'offline-second', usage: { input_tokens: 10, output_tokens: 2 } } }) + '\n'); await f.collector.scan(); await enqueue(f.client, f.config, f.credential, f.spool);
    const packets = (await exportOffline(f.client, f.config, f.credential, f.spool, f.output)).files; const second = JSON.parse(await readFile(packets[0], 'utf8')) as OfflineArchive;
    const apply = f.receiver.ingest.bind(f.receiver); let calls = 0;
    f.receiver.ingest = (input, raw, device, mode) => { if (++calls === 2) throw new Error('SYNTHETIC_STORAGE_FAILURE'); return apply(input, raw, device, mode); };
    const interrupted = f.receiver.importOffline(second); assert.equal(interrupted.importedBatches, 1); assert.equal(interrupted.interrupted, 'SYNTHETIC_STORAGE_FAILURE');
    f.receiver.ingest = apply; const resumed = f.receiver.importOffline(second); assert.equal(resumed.repeatedBatches, 1); assert.equal(resumed.importedBatches, 1); assert.equal(f.hub.summary().usage.total.value, '114');
    deleteSource(f.hub, f.hub.sources()[0].id); assert.equal(f.receiver.importOffline(second).repeatedBatches, 2); assert.equal(f.hub.sources().length, 0);
    const gap = signedArchive({ ...f.archive.payload, gap: { from: '3', to: '4', reason: 'bounded_spool' }, packets: [] }, f.credential.offlineSigningKey);
    assert.equal(f.receiver.importOffline(gap).acknowledgedSequence, '4'); assert.equal(f.receiver.view().devices.find(device => device.id === f.config.deviceId)!.transportGaps, 1);
  } finally { await f.close(); }
});

test('collector state lock prevents simultaneous writers and permits reuse after release', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-client-lock-'));
  try { const release = await clientLock(root); await assert.rejects(clientLock(root), /COLLECTOR_RUNNING_CLOSE_IT_FIRST/); await release(); await (await clientLock(root))(); }
  finally { await rm(root, { recursive: true, force: true }); }
});
