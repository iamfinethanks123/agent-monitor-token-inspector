import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir, appendFile, utimes } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { InspectorStore } from '../src/storage/InspectorStore';
import { deleteSource } from '../src/storage/privacy';
import { IndexCollector } from '../src/collector/IndexCollector';
import { MetadataReceiver } from '../src/transport/MetadataReceiver';
import { enqueue, sendSpool, pruneSpool, request, recoverPrivacyReset, synchronizeDeletions, confirmEnrollment, type ClientConfig } from '../src/collector/metadata-sync';

const usage = (thread: string, response: string, input = 10) => JSON.stringify({ type: 'token_usage_record', payload: { thread_id: thread, response_id: response, usage: { input_tokens: input, output_tokens: 2 } } }) + '\n';
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-collector-sync-')); const traces = path.join(root, 'traces'); const spool = path.join(root, 'spool');
  await mkdir(traces); await mkdir(spool); const hub = new InspectorStore(path.join(root, 'hub.sqlite')); const receiver = new MetadataReceiver(hub); await receiver.start(0);
  const pairing = receiver.enroll('Synthetic offline client');
  const paired = await request(pairing.endpoint, '/v2/pair', { workspaceId: pairing.workspaceId, deviceId: pairing.deviceId, pairingCode: pairing.pairingCode, platform: 'synthetic' });
  const credential = { token: String(paired.deviceToken), fingerprintKey: randomBytes(32).toString('base64') };
  const config: ClientConfig = { schemaVersion: '2', workspaceId: pairing.workspaceId, deviceId: pairing.deviceId, deviceName: 'Synthetic offline client', endpoint: pairing.endpoint, credentialFile: 'not-used-by-this-fixture' };
  const clientFile = path.join(root, 'client.sqlite'); let client = new InspectorStore(clientFile, { workspaceId: config.workspaceId, machineId: config.deviceId });
  for (const thread of ['a', 'b']) await writeFile(path.join(traces, `${thread}.jsonl`), JSON.stringify({ type: 'session_meta', payload: { id: thread, model_provider: 'openai' } }) + '\n' + usage(thread, `${thread}-1`));
  await new IndexCollector(client, [traces]).scan();
  return { root, traces, spool, hub, receiver, credential, config, get client() { return client; },
    restart() { client.close(); client = new InspectorStore(clientFile, { workspaceId: config.workspaceId, machineId: config.deviceId }); },
    async close() { client.close(); await receiver.stop(); hub.close(); await rm(root, { recursive: true, force: true }); } };
}

test('a 24-hour-aged encrypted queue survives disconnect and receiver/client restart without duplicate usage', async () => {
  const f = await fixture();
  try {
    assert.equal(f.receiver.view().devices.find(device => device.id === f.config.deviceId)!.credentialConfirmedAt, null);
    await confirmEnrollment(f.config, f.credential);
    assert.ok(f.receiver.view().devices.find(device => device.id === f.config.deviceId)!.credentialConfirmedAt);
    await enqueue(f.client, f.config, f.credential, f.spool);
    const name = (await readdir(f.spool))[0]; const filename = path.join(f.spool, name); const encrypted = await readFile(filename, 'utf8');
    assert.equal(encrypted.includes('input_tokens'), false); assert.equal(encrypted.includes('thread_id'), false);
    const yesterday = new Date(Date.now() - 24 * 3600000); await utimes(filename, yesterday, yesterday);
    await f.receiver.stop(); await assert.rejects(sendSpool(f.client, f.config, f.credential, f.spool));
    assert.equal(await readFile(filename, 'utf8'), encrypted); f.restart();
    await f.receiver.start(0); f.config.endpoint = f.receiver.view().endpoint;
    await enqueue(f.client, f.config, f.credential, f.spool); await sendSpool(f.client, f.config, f.credential, f.spool);
    assert.equal(f.hub.summary().usage.total.value, '24'); assert.equal(f.client.getSetting('acknowledged_sequence'), '2');
    // Simulate loss of the ACK after durable receiver ingestion, before client cleanup.
    await writeFile(filename, encrypted); f.client.setSetting('acknowledged_sequence', '0');
    await sendSpool(f.client, f.config, f.credential, f.spool);
    assert.equal(f.hub.summary().usage.total.value, '24'); assert.deepEqual(await readdir(f.spool), []);
  } finally { await f.close(); }
});

test('receiver deletion recovers after a client crash, removes queued copies and replays only retained source identities', async () => {
  const f = await fixture();
  try {
    await enqueue(f.client, f.config, f.credential, f.spool); await sendSpool(f.client, f.config, f.credential, f.spool);
    await appendFile(path.join(f.traces, 'a.jsonl'), usage('a', 'a-2', 11));
    await appendFile(path.join(f.traces, 'b.jsonl'), usage('b', 'b-2', 14));
    await new IndexCollector(f.client, [f.traces]).scan(); await enqueue(f.client, f.config, f.credential, f.spool);
    const original = await readFile(path.join(f.traces, 'a.jsonl'), 'utf8');
    const remote = f.hub.sources().find(source => source.threadId === 'a')!; const local = f.client.sources().find(source => source.threadId === 'a')!;
    deleteSource(f.hub, remote.id); assert.equal(f.receiver.view().devices.find(device => device.id === f.config.deviceId)!.pendingDeletions, 1);
    const controls = await request(f.config.endpoint, '/v2/controls', { workspaceId: f.config.workspaceId }, f.config, f.credential);
    await assert.rejects(request(f.config.endpoint, '/v2/controls', { workspaceId: 'wrong-workspace' }, f.config, f.credential), /UNAUTHORIZED/);
    await assert.rejects(request(f.config.endpoint, '/v2/controls/ack', { workspaceId: f.config.workspaceId, deletions: [{ sourceId: local.id, deletionId: 'deletion:' + '0'.repeat(64) }] }, f.config, f.credential), /INVALID_DELETION_RECEIPT/);
    f.client.setSetting('privacy_reset_spool', JSON.stringify({ through: f.client.getSetting('export_sequence'), deletions: controls.deletions }));
    f.restart(); await recoverPrivacyReset(f.client, f.config, f.spool);
    assert.equal(f.client.getSource(local.id), null); assert.equal(f.client.excluded(local.id), true); assert.deepEqual(await readdir(f.spool), []);
    assert.equal(await readFile(path.join(f.traces, 'a.jsonl'), 'utf8'), original);
    await new IndexCollector(f.client, [f.traces]).scan(); assert.equal(f.client.getSource(local.id), null);
    await enqueue(f.client, f.config, f.credential, f.spool); await synchronizeDeletions(f.client, f.config, f.credential, f.spool); await sendSpool(f.client, f.config, f.credential, f.spool);
    assert.equal(f.hub.summary().usage.total.value, '28'); assert.equal(f.hub.sources().some(source => source.threadId === 'a'), false);
    const device = f.receiver.view().devices.find(device => device.id === f.config.deviceId)!;
    assert.equal(device.pendingDeletions, 0); assert.equal(device.appliedDeletions, 1);
    assert.equal(f.hub.db.prepare('SELECT reason FROM device_gaps').get()!.reason, 'privacy_exclusion');
    const sequence = f.client.getSetting('export_sequence'); await synchronizeDeletions(f.client, f.config, f.credential, f.spool);
    assert.equal(f.client.getSetting('export_sequence'), sequence); assert.deepEqual(await readdir(f.spool), []);
    f.receiver.revoke(f.config.deviceId);
    await assert.rejects(request(f.config.endpoint, '/v2/controls', { workspaceId: f.config.workspaceId }, f.config, f.credential), /UNAUTHORIZED/);
  } finally { await f.close(); }
});

test('a durable gap recovers even when interrupted before deleting expired queue files', async () => {
  const f = await fixture();
  try {
    await enqueue(f.client, f.config, f.credential, f.spool);
    const name = (await readdir(f.spool))[0]; const saved = await readFile(path.join(f.spool, name));
    const expired = new Date(Date.now() - 8 * 86400000); await utimes(path.join(f.spool, name), expired, expired);
    await pruneSpool(f.client, f.spool); assert.deepEqual(await readdir(f.spool), []); assert.ok(f.client.getSetting('spool_gap'));
    // Recreate an unlinked directory entry to simulate interruption before its deletion became durable.
    await writeFile(path.join(f.spool, name), saved); f.restart();
    await sendSpool(f.client, f.config, f.credential, f.spool);
    assert.deepEqual(await readdir(f.spool), []); assert.equal(f.client.getSetting('spool_gap'), null);
    assert.equal(f.client.getSetting('acknowledged_sequence'), '2'); assert.equal(f.hub.summary().selectedEntries, 0);
    assert.equal(f.hub.db.prepare('SELECT reason FROM device_gaps').get()!.reason, 'bounded_spool');
  } finally { await f.close(); }
});
