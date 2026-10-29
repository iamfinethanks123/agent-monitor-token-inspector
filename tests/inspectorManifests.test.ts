import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { observeOwnedRequest } from '../src/collector/owned-client';
import { importManifests, manifests, setManifestConsent } from '../src/storage/context-manifests';
import { deleteSource, applyRetention } from '../src/storage/privacy';
import { ResourceMeter } from '../src/collector/resources';
import type { ContextManifest, ContextResult } from '../src/shared/context-manifests';

test('controlled boundary preserves ordered metadata before send and matches exact response usage without adding tokens', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-manifests-')); const store = new InspectorStore(path.join(root, 'index.sqlite'));
  try {
    const trace = path.join(root, 'synthetic.jsonl');
    await writeFile(trace, [
      { type: 'session_meta', payload: { id: 'controlled-thread', model_provider: 'openai' } },
      { type: 'token_usage_record', ordinal: 1, payload: { thread_id: 'controlled-thread', turn_id: 'turn-1', response_id: 'response-1', usage: { input_tokens: 20, output_tokens: 2 } } },
    ].map(record => JSON.stringify(record)).join('\n') + '\n');
    const original = await readFile(trace, 'utf8');
    await new IndexCollector(store, [root]).scan(); const before = store.summary().usage.total.value;
    assert.equal(manifests(store).enabled, false);
    assert.throws(() => importManifests(store, {}), /MANIFESTS_DISABLED/);
    setManifestConsent(store, true); const consent = manifests(store).consent!;
    const records: (ContextManifest | ContextResult)[] = [];
    await observeOwnedRequest({ consent, clientId: 'fixture-client', requestId: 'request-1', threadId: 'controlled-thread', turnId: 'turn-1',
      items: [
        { id: 'instructions-1', origin: 'instructions', text: 'SECRET_MARKER', estimate: { tokens: '4', tokenizer: 'fixture', version: '1' } },
        { id: 'tool-1', origin: 'tool', text: '資料', estimate: { tokens: '2', tokenizer: 'fixture', version: '1' }, operations: [{ kind: 'truncated', beforeBytes: '60', afterBytes: '6' }] },
      ], persist: async record => { records.push(record); }, send: async (items, requestId) => {
        assert.equal(records.length, 1); assert.deepEqual(items.map(item => item.id), ['instructions-1', 'tool-1']); assert.equal(requestId, 'request-1'); return { responseId: 'response-1' };
      } });
    const bundle = { schema: 'owned-context-bundle/1', records };
    assert.equal(importManifests(store, bundle).imported, 2); assert.equal(importManifests(store, bundle).imported, 0);
    const linked = manifests(store).items[0];
    assert.equal(linked.linkage, 'matched'); assert.equal(linked.observedInput.value, '20'); assert.equal(linked.visibleEstimate.value, '6'); assert.equal(linked.discrepancy, '14');
    assert.deepEqual(linked.manifest.items.map(item => [item.id, item.order, item.bytes]), [['instructions-1', 0, '13'], ['tool-1', 1, '6']]);
    assert.equal(JSON.stringify(store.db.prepare('SELECT record FROM context_records').all()).includes('SECRET_MARKER'), false);
    assert.equal(store.summary().usage.total.value, before);
    assert.throws(() => importManifests(store, { ...bundle, records: [{ ...records[0], requestId: 'bad', text: 'SECRET_MARKER' }] }), /INVALID_MANIFEST/);
    assert.throws(() => importManifests(store, { ...bundle, records: [{ ...records[0], items: [] }] }), /MANIFEST_ID_CONFLICT/);
    assert.equal(manifests(store, { machineId: 'another-machine' }).items.length, 0);
    assert.equal(manifests(store, { runId: 'another-thread' }).items.length, 0);
    const wrongTurn = { ...records[0], requestId: 'wrong-turn', turnId: 'other-turn' };
    const wrongTurnResult = { ...records[1], requestId: 'wrong-turn' };
    importManifests(store, { ...bundle, records: [wrongTurn, wrongTurnResult] });
    assert.equal(manifests(store).items.find(item => item.manifest.requestId === 'wrong-turn')!.linkage, 'usage_missing');
    // A separate attempt removes the known tool item; its estimate changes, not the measured baseline usage.
    const smaller = { ...records[0], requestId: 'request-2', items: (records[0] as ContextManifest).items.slice(0, 1) };
    importManifests(store, { ...bundle, records: [smaller] });
    const pending = manifests(store).items.find(item => item.manifest.requestId === 'request-2')!;
    assert.equal(pending.visibleEstimate.value, '4'); assert.equal(pending.linkage, 'pending'); assert.equal(pending.observedInput.value, null); assert.equal(store.summary().usage.total.value, before);
    const page = manifests(store, { limit: 1 }); assert.ok(page.nextCursor); assert.equal(manifests(store, { limit: 1, cursor: page.nextCursor! }).items[0].manifest.requestId, 'wrong-turn');
    assert.throws(() => manifests(store, { limit: 1, cursor: page.nextCursor!, runId: 'different' }), /INVALID_CURSOR/);
    deleteSource(store, store.sources()[0].id); assert.equal(manifests(store).items.length, 0);
    assert.throws(() => importManifests(store, bundle), /MANIFEST_RUN_EXCLUDED/);
    assert.equal(await readFile(trace, 'utf8'), original);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test('failed and unmatched controlled attempts remain unknown; receipt-time retention clears related records', async () => {
  const store = new InspectorStore(':memory:');
  try {
    setManifestConsent(store, true); const consent = manifests(store).consent!;
    const records: (ContextManifest | ContextResult)[] = [];
    await assert.rejects(observeOwnedRequest({ consent, clientId: 'client', requestId: 'failure', threadId: 'thread', turnId: null,
      items: [{ id: 'user-1', origin: 'user', text: 'text' }], persist: async record => { records.push(record); }, send: async () => { throw new Error('not exported'); } }), /not exported/);
    importManifests(store, { schema: 'owned-context-bundle/1', records });
    const failed = manifests(store).items[0]; assert.equal(failed.linkage, 'failed'); assert.equal(failed.observedInput.value, null); assert.equal(failed.visibleEstimate.value, null);
    store.db.prepare("UPDATE context_records SET received_at='2000-01-01T00:00:00.000Z'").run(); applyRetention(store);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM context_records').get()!.n, 0);
    setManifestConsent(store, false); assert.equal(manifests(store).enabled, false);
    assert.throws(() => importManifests(store, { schema: 'owned-context-bundle/1', records }), /MANIFESTS_DISABLED/);
  } finally { store.close(); }
});

test('resource snapshot reports the monitor scope and own file size without exposing paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-resource-')); const filename = path.join(root, 'index.sqlite');
  try {
    await writeFile(filename, '1234567890'); const meter = new ResourceMeter(filename); const value = meter.sample();
    assert.equal(value.databaseBytes, '10'); assert.equal(value.scope, 'monitor_process'); assert.equal(value.cpuBasis, 'one_core_percent');
    assert.ok(BigInt(value.processRssBytes) > 0n); assert.equal(JSON.stringify(value).includes(root), false); assert.equal(meter.sample(), value);
  } finally { await rm(root, { recursive: true, force: true }); }
});
