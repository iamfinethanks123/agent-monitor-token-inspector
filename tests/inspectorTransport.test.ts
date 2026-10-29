import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { MetadataReceiver } from '../src/transport/MetadataReceiver';
import type { MetadataBatch, MetadataEvent } from '../src/transport/protocol';
import type { NormalizedObservation } from '../src/accounting/codex-observations';
import { protectedEndpoint } from '../src/transport/protocol';

test('statistics-only receiver authenticates, persists acknowledgments, rejects altered replay and revoke', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-sync-')); const hub = new InspectorStore(path.join(root, 'hub.sqlite'));
  const receiver = new MetadataReceiver(hub); await receiver.start(0); const pairing = receiver.enroll('Synthetic Ubuntu');
  const post = async (route: string, body: unknown, token?: string) => fetch(`${pairing.endpoint}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-device-id': pairing.deviceId, authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  let client: InspectorStore | undefined;
  try {
    const paired = await post('/v2/pair', { workspaceId: pairing.workspaceId, deviceId: pairing.deviceId, pairingCode: pairing.pairingCode, platform: 'linux-arm64' });
    assert.equal(paired.status, 200); const secret = await paired.json() as { deviceToken: string }; assert.equal(typeof secret.deviceToken, 'string');
    assert.equal((await post('/v2/pair', { workspaceId: pairing.workspaceId, deviceId: pairing.deviceId, pairingCode: pairing.pairingCode })).status, 401);
    client = new InspectorStore(path.join(root, 'client.sqlite'), { workspaceId: pairing.workspaceId, machineId: pairing.deviceId });
    await writeFile(path.join(root, 'session.jsonl'), [
      { type: 'session_meta', payload: { id: 'thread-synthetic', model_provider: 'openai', cli_version: '0.162.0-alpha.2' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'TEST_SECRET_PROMPT_MUST_NOT_SYNC' }] } },
      { type: 'token_usage_record', ordinal: 2, timestamp: '2026-10-12T00:00:00Z', payload: { thread_id: 'thread-synthetic', response_id: 'resp-synthetic', usage: { input_tokens: 100, output_tokens: 20 } } },
    ].map(r => JSON.stringify(r)).join('\n') + '\n');
    await new IndexCollector(client, [root]).scan();
    const row = client.db.prepare("SELECT * FROM observations WHERE kind='token_usage_record'").get()!; const n = JSON.parse(String(row.normalized)) as NormalizedObservation; const c = n.context;
    const event: MetadataEvent = { id: String(row.id), sourceId: String(row.source_id), generation: Number(row.generation), byteStart: String(row.byte_start), byteEnd: String(row.byte_end), line: Number(row.line), semanticSequence: n.semanticSequence,
      timestamp: n.sourceTimestamp, kind: 'token_usage_record', schemaFingerprint: n.schemaFingerprint, context: { threadId: c.threadId, sessionId: c.sessionId, parentThreadId: c.parentThreadId, forkedFromId: c.forkedFromId, runtimeVersion: c.runtimeVersion, requestedModel: c.requestedModel, providerRoute: c.providerRoute, serviceTier: c.serviceTier, projectId: c.projectId, turnId: c.turnId }, measurements: n.measurements.map(m => ({ ...m, model: { ...m.model, evidenceRefs: [] } })) };
    const batch: MetadataBatch = { schemaVersion: '2', workspaceId: pairing.workspaceId, deviceId: pairing.deviceId, batchId: randomUUID(), sequenceStart: '1', sequenceEnd: '1', createdAt: new Date().toISOString(), adapterVersion: 'codex-passive/1', redactionPolicyId: 'statistics-only-v2', events: [event] };
    assert.equal(JSON.stringify(batch).includes('TEST_SECRET_PROMPT'), false);
    const accepted = await post('/v2/batches', batch, secret.deviceToken); assert.equal(accepted.status, 200); assert.equal((await accepted.json()).acknowledgedSequence, '1'); assert.equal(hub.summary().usage.total.value, '120');
    assert.equal((await post('/v2/batches', batch, secret.deviceToken)).status, 200); assert.equal(hub.summary().usage.total.value, '120');
    const changed = structuredClone(batch); changed.events[0].measurements[0].values.input = '101'; changed.events[0].measurements[0].values.total = '121';
    assert.equal((await post('/v2/batches', changed, secret.deviceToken)).status, 400); assert.equal(hub.summary().usage.total.value, '120');
    assert.equal((await post('/v2/batches', { ...batch, workspaceId: randomUUID() }, secret.deviceToken)).status, 401);
    const invalid = structuredClone(batch) as MetadataBatch & { prompt?: string }; invalid.batchId = randomUUID(); invalid.sequenceStart = '2'; invalid.sequenceEnd = '2'; invalid.prompt = 'TEST_SECRET';
    assert.equal((await post('/v2/batches', invalid, secret.deviceToken)).status, 400);
    assert.equal((await post('/v2/gaps', { workspaceId: pairing.workspaceId, from: '2', to: '5', reason: 'bounded_spool' }, secret.deviceToken)).status, 200);
    assert.equal(String(hub.db.prepare('SELECT ack FROM devices WHERE id=?').get(pairing.deviceId)!.ack), '5');
    receiver.revoke(pairing.deviceId); assert.equal((await post('/v2/heartbeat', { workspaceId: pairing.workspaceId }, secret.deviceToken)).status, 401);
    assert.equal(hub.summary().usage.total.value, '120');
  } finally { client?.close(); await receiver.stop(); hub.close(); await rm(root, { recursive: true, force: true }); }
});

test('unencrypted non-loopback endpoints are refused', () => {
  assert.throws(() => protectedEndpoint('http://example.invalid:9897'), /ENCRYPTED_TRANSPORT_REQUIRED/);
  assert.equal(protectedEndpoint('http://127.0.0.1:9897/'), 'http://127.0.0.1:9897');
  assert.equal(protectedEndpoint('https://example.invalid'), 'https://example.invalid');
});
