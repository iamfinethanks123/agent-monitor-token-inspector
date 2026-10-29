import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InspectorStore, type PendingObservation } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { MetadataReceiver } from '../src/transport/MetadataReceiver';
import { collectorHealth } from '../src/collector/health-summary';
import { applyDeviceActivity } from '../src/shared/device-activity';

test('heartbeats and health snapshots update devices without reloading accounting', async () => {
  const store = new InspectorStore(':memory:');
  const receiver = new MetadataReceiver(store);
  await receiver.start(0);
  const pairing = receiver.enroll('Fixture device');
  let dataChanges = 0, deviceChanges = 0;
  receiver.onChanged = () => dataChanges++;
  receiver.onDevicesChanged = () => deviceChanges++;
  const post = async (route: string, body: unknown, token?: string) => {
    const response = await fetch(`${pairing.endpoint}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-device-id': pairing.deviceId, authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    const result = await response.json(); assert.equal(response.status, 200); return result;
  };
  try {
    const enrolled = await post('/v2/pair', { workspaceId: pairing.workspaceId, deviceId: pairing.deviceId, pairingCode: pairing.pairingCode, platform: 'win32-x64' });
    dataChanges = 0; deviceChanges = 0;
    const revision = store.revision();
    await post('/v2/heartbeat', { workspaceId: pairing.workspaceId }, enrolled.deviceToken);
    await post('/v2/collector-health', { workspaceId: pairing.workspaceId, health: collectorHealth(store) }, enrolled.deviceToken);
    assert.equal(dataChanges, 0);
    assert.equal(deviceChanges, 2);
    assert.equal(store.revision(), revision);
    const previous = receiver.view(); previous.devices.find(item => item.id === pairing.deviceId)!.total = '12';
    const savedSummary = store.summary.bind(store);
    store.summary = () => { throw new Error('ACTIVITY_MUST_NOT_READ_USAGE'); };
    const activity = receiver.activity();
    const device = activity.devices.find(item => item.id === pairing.deviceId)!;
    assert.equal(device.online, true);
    assert.equal(typeof device.lastOnlineSeenAt, 'string');
    assert(device.health);
    assert.equal('total' in device, false);
    assert.equal(JSON.stringify(activity).includes(enrolled.deviceToken), false);
    const updated = applyDeviceActivity(previous, activity)!;
    assert.equal(updated.usageRevision, previous.usageRevision);
    assert.equal(updated.devices.find(item => item.id === pairing.deviceId)?.total, '12');
    const initial = applyDeviceActivity(undefined, activity);
    assert.equal(initial.usageRevision, undefined); assert.equal(initial.devices.find(item => item.id === pairing.deviceId)?.total, null);
    assert.equal(initial.devices.find(item => item.id === pairing.deviceId)?.online, true);
    store.summary = savedSummary;
    assert.equal(receiver.view().devices.find(item => item.id === pairing.deviceId)?.total, null);
    receiver.enroll('Another fixture');
    assert.equal(dataChanges, 1);
  } finally { await receiver.stop(); store.close(); }
});

test('policy confirmations and credential readback refresh device metadata without a usage event', async () => {
  const store = new InspectorStore(':memory:'); const receiver = new MetadataReceiver(store); await receiver.start(0);
  const pairing = receiver.enroll('Policy fixture'); let data = 0, devices = 0;
  receiver.onChanged = () => data++; receiver.onDevicesChanged = () => devices++;
  const request = async (route: string, body: unknown, token?: string) => {
    const response = await fetch(`${pairing.endpoint}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-device-id': pairing.deviceId, authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    assert.equal(response.status, 200); return response.json();
  };
  try {
    const paired = await request('/v2/pair', { workspaceId: pairing.workspaceId, deviceId: pairing.deviceId, pairingCode: pairing.pairingCode });
    data = 0; devices = 0;
    await request('/v2/pair/confirm', { workspaceId: pairing.workspaceId }, paired.deviceToken);
    const snapshot = await request('/v2/project-policies', { workspaceId: pairing.workspaceId }, paired.deviceToken);
    await request('/v2/project-policies/ack', { workspaceId: pairing.workspaceId, controls: snapshot.controls.map((item: { version: string; controlId: string; policy: { projectId: string } }) => ({ projectId: item.policy.projectId, version: item.version, controlId: item.controlId })) }, paired.deviceToken);
    assert.equal(data, 0); assert.equal(devices, 2);
    const view = receiver.activity().devices.find(item => item.id === pairing.deviceId)!;
    assert(view.credentialConfirmedAt); assert.equal(view.projectPolicySync?.state, 'applied');
  } finally { await receiver.stop(); store.close(); }
});

test('device totals use one ledger pass with exact big integers, nulls, zero and quarantine', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'device-totals-')); const store = new InspectorStore(':memory:');
  const peer = new InspectorStore(':memory:', { workspaceId: store.workspaceId, machineId: 'peer-machine' }); const receiver = new MetadataReceiver(store); await receiver.start(0);
  const records = (thread: string, rows: unknown[]) => [{ type: 'session_meta', payload: { id: thread, model_provider: 'openai' } }, ...rows].map(row => JSON.stringify(row)).join('\n') + '\n';
  const response = (thread: string, id: string, usage: unknown) => ({ type: 'token_usage_record', payload: { thread_id: thread, response_id: id, usage } });
  try {
    const pending = receiver.enroll('No usage yet');
    await writeFile(path.join(root, 'zero.jsonl'), records('zero', [response('zero', 'zero', { input_tokens: 0, output_tokens: 0 })]));
    await new IndexCollector(store, [root]).scan();
    await rm(path.join(root, 'zero.jsonl'));
    await writeFile(path.join(root, 'peer.jsonl'), records('peer', [response('peer', 'big', { input_tokens: '9007199254740993', output_tokens: 2 }), response('peer', 'partial', { total_tokens: 7 }), response('peer', 'bad', { input_tokens: 10, cached_input_tokens: 11, output_tokens: 2 })]));
    await new IndexCollector(peer, [root]).scan();
    store.db.prepare('INSERT INTO devices(id,workspace_id,name,state) VALUES(?,?,?,?)').run(peer.machineId, store.workspaceId, 'Peer', 'active');
    for (const source of peer.sources()) {
      const rows: PendingObservation[] = peer.db.prepare('SELECT * FROM observations WHERE source_id=?').all(source.id).map(row => ({ id: String(row.id), evidenceRef: String(row.evidence_ref), generation: Number(row.generation), byteStart: Number(row.byte_start), byteEnd: Number(row.byte_end), line: Number(row.line), recordDigest: String(row.record_digest), normalized: JSON.parse(String(row.normalized)) }));
      store.commitAuthenticatedDevice(peer.getSource(source.id)!, rows, peer.machineId);
    }
    store.reconcileDirty(); const revision = store.revision();
    const expected = new Map([store.machineId, peer.machineId, pending.deviceId].map(id => [id, store.summary({ machineId: id }).usage.total.value]));
    assert.equal(expected.get(store.machineId), '0'); assert.equal(expected.get(peer.machineId), '9007199254740995'); assert.equal(expected.get(pending.deviceId), null);
    assert.equal(store.ledger({ machineId: peer.machineId }).items.find(entry => entry.identity.responseId === 'partial')?.usage.total.value, null);
    const summary = store.summary.bind(store); store.summary = () => { throw Error('DEVICE_TOTALS_MUST_NOT_COMPUTE_FULL_SUMMARIES'); };
    try { const actual = receiver.view(); for (const device of actual.devices) assert.equal(device.total, expected.get(device.id)); assert.equal(actual.usageRevision, revision); }
    finally { store.summary = summary; }
    assert.equal(store.revision(), revision); assert.equal(store.summary().quarantinedEntries, 1);
  } finally { await receiver.stop(); peer.close(); store.close(); await rm(root, { recursive: true, force: true }); }
});
