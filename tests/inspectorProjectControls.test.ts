import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, appendFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { MetadataReceiver } from '../src/transport/MetadataReceiver';
import { enqueue, sendSpool, request, synchronizeProjectPolicies, recoverPrivacyReset, expireCollectorRetention, type ClientConfig } from '../src/collector/metadata-sync';
import { collectorHealth } from '../src/collector/health-summary';
import { projectPolicy, setProjectPolicy, bumpPrivacyVersion } from '../src/storage/project-privacy';
import { deleteProject, setRetention } from '../src/storage/privacy';
import { projectControls, checkedProjectControls, applyProjectControls } from '../src/transport/project-policy-controls';
import { contentSearch } from '../src/storage/local-content';
import { report } from '../src/reporting/report';

const lines = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const response = (thread: string, id: string, input = 10) => ({ type: 'token_usage_record', payload: { thread_id: thread, response_id: id, usage: { input_tokens: input, output_tokens: 2 } } });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-controls-')), traces = path.join(root, 'traces'), spool = path.join(root, 'spool'); await mkdir(traces); await mkdir(spool);
  const hub = new InspectorStore(path.join(root, 'hub.sqlite')), receiver = new MetadataReceiver(hub); await receiver.start(0); const pairing = receiver.enroll('Policy fixture');
  const paired = await request(pairing.endpoint, '/v2/pair', { workspaceId: pairing.workspaceId, deviceId: pairing.deviceId, pairingCode: pairing.pairingCode, platform: 'synthetic' });
  const credential = { token: String(paired.deviceToken), fingerprintKey: randomBytes(32).toString('base64') }, config: ClientConfig = { schemaVersion: '2', workspaceId: pairing.workspaceId, deviceId: pairing.deviceId, deviceName: 'Fixture', endpoint: pairing.endpoint, credentialFile: 'synthetic' };
  const database = path.join(root, 'client.sqlite'); let client = new InspectorStore(database, { workspaceId: config.workspaceId, machineId: config.deviceId });
  for (const thread of ['a','b']) await writeFile(path.join(traces, thread + '.jsonl'), lines([{ type: 'session_meta', payload: { id: thread, cwd: '/fixture-' + thread, model_provider: 'openai' } }, { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'PRIVATE_' + thread }] } }, response(thread, thread + '-1', thread === 'a' ? 10 : 20)]));
  await new IndexCollector(client, [traces], credential.fingerprintKey).scan(); await enqueue(client, config, credential, spool); await sendSpool(client, config, credential, spool);
  const a = client.db.prepare("SELECT json_extract(context,'$.projectId') AS id FROM sources WHERE thread_id='a'").get()!.id as string, b = client.db.prepare("SELECT json_extract(context,'$.projectId') AS id FROM sources WHERE thread_id='b'").get()!.id as string;
  return { root, traces, spool, hub, receiver, credential, config, a, b, get client() { return client; }, restart() { client.close(); client = new InspectorStore(database, { workspaceId: config.workspaceId, machineId: config.deviceId }); }, async close() { client.close(); await receiver.stop(); hub.close(); await rm(root, { recursive: true, force: true }); } };
}
const plainControls = (hub: InspectorStore, device: string) => projectControls(hub, device).map(({ version, controlId, policy }) => ({ version, controlId, policy }));

test('authenticated project constraints preserve local choices, restrict previews/exports and never grant content consent', async () => {
  const f = await fixture();
  try {
    setProjectPolicy(f.client, { ...projectPolicy(f.client, f.a), metadataDays: 7, usageDays: 20, allowExports: false });
    const original = f.client.db.prepare('SELECT record FROM project_policies WHERE project_id=?').get(f.a)!.record;
    setProjectPolicy(f.hub, { ...projectPolicy(f.hub, f.a), metadataDays: 14, usageDays: 30, allowSourcePreview: false, contentDays: 0 });
    await synchronizeProjectPolicies(f.client, f.config, f.credential, f.spool);
    assert.equal(projectPolicy(f.client, f.a).metadataDays, 7); assert.equal(projectPolicy(f.client, f.a).usageDays, 20); assert.equal(projectPolicy(f.client, f.a).allowExports, false); assert.equal(projectPolicy(f.client, f.a).allowSourcePreview, false); assert.equal(projectPolicy(f.client, f.a).contentDays, 0);
    assert.equal(f.client.db.prepare('SELECT record FROM project_policies WHERE project_id=?').get(f.a)!.record, original);
    assert.throws(() => report(f.client, {}, 'json'), /PROJECT_EXPORT_RESTRICTED/);
    const ref = f.client.ledger({ projectId: f.a }).items[0].evidenceRefs[0]; assert.equal((await new IndexCollector(f.client, [f.traces]).evidence(ref)).state, 'policy_denied');
    setProjectPolicy(f.hub, { ...projectPolicy(f.hub, f.a), metadataDays: 30, usageDays: 180, contentDays: 7, allowSourcePreview: true });
    await synchronizeProjectPolicies(f.client, f.config, f.credential, f.spool); assert.equal(projectPolicy(f.client, f.a).metadataDays, 7); assert.equal(projectPolicy(f.client, f.a).allowExports, false); assert.equal(projectPolicy(f.client, f.a).contentDays, 0); assert.equal(contentSearch(f.client).retained, 0);
    assert.equal(f.receiver.view().devices.find(d => d.id === f.config.deviceId)!.projectPolicySync!.state, 'applied');
    assert.equal((await request(f.config.endpoint, '/v2/collector-health', { workspaceId: f.config.workspaceId, health: collectorHealth(f.client) }, f.config, f.credential)).accepted, true);
    await sendSpool(f.client, f.config, f.credential, f.spool); assert.equal(f.hub.summary().usage.total.value, '34');
    const sequence = f.client.getSetting('export_sequence'); await synchronizeProjectPolicies(f.client, f.config, f.credential, f.spool); assert.equal(f.client.getSetting('export_sequence'), sequence);
    const before = plainControls(f.hub, f.config.deviceId); bumpPrivacyVersion(f.hub); assert.deepEqual(plainControls(f.hub, f.config.deviceId), before); assert.equal(f.receiver.view().devices.find(d => d.id === f.config.deviceId)!.projectPolicySync!.state, 'applied');
  } finally { await f.close(); }
});

test('retention and encrypted-queue reset recover offline after interruption; repeated receipts cannot duplicate totals', async () => {
  const f = await fixture();
  try {
    f.client.db.prepare("UPDATE observations SET received_at=? WHERE json_extract(normalized,'$.context.projectId')=?").run(new Date(Date.now() - 3 * 86400000).toISOString(), f.a);
    await appendFile(path.join(f.traces, 'b.jsonl'), lines([response('b', 'b-2', 5)])); await new IndexCollector(f.client, [f.traces], f.credential.fingerprintKey).scan(); await enqueue(f.client, f.config, f.credential, f.spool);
    const original = await readFile(path.join(f.traces, 'a.jsonl'), 'utf8'); setProjectPolicy(f.hub, { ...projectPolicy(f.hub, f.a), metadataDays: 1, usageDays: 2 });
    const commands = plainControls(f.hub, f.config.deviceId); f.client.setSetting('privacy_reset_spool', JSON.stringify({ through: f.client.getSetting('export_sequence'), deletions: [], projectPolicies: commands }));
    f.restart(); await f.receiver.stop(); await recoverPrivacyReset(f.client, f.config, f.spool);
    assert.equal(f.client.summary({ projectId: f.a }).selectedEntries, 0); assert.equal(f.client.summary({ projectId: f.b }).usage.total.value, '29'); assert.deepEqual(await readdir(f.spool), []); assert.equal(await readFile(path.join(f.traces, 'a.jsonl'), 'utf8'), original);
    await new IndexCollector(f.client, [f.traces], f.credential.fingerprintKey).scan(); assert.equal(f.client.summary({ projectId: f.a }).selectedEntries, 0);
    await f.receiver.start(0); f.config.endpoint = f.receiver.view().endpoint; await enqueue(f.client, f.config, f.credential, f.spool); const sequence = f.client.getSetting('export_sequence'); await synchronizeProjectPolicies(f.client, f.config, f.credential, f.spool); assert.equal(f.client.getSetting('export_sequence'), sequence); await sendSpool(f.client, f.config, f.credential, f.spool);
    assert.equal(f.hub.summary().usage.total.value, '41'); f.restart(); await synchronizeProjectPolicies(f.client, f.config, f.credential, f.spool); await sendSpool(f.client, f.config, f.credential, f.spool); assert.equal(f.hub.summary().usage.total.value, '41'); assert.equal(f.client.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { await f.close(); }
});

test('global changes update inherited policies; project overrides and granular deletion remain effective', async () => {
  const f = await fixture();
  try {
    setProjectPolicy(f.hub, { ...projectPolicy(f.hub, f.a), usageDays: 60 }); await synchronizeProjectPolicies(f.client, f.config, f.credential, f.spool);
    setRetention(f.hub, { eventDays: 1, usageDays: 2, rawCopies: false, textSearch: false }); await synchronizeProjectPolicies(f.client, f.config, f.credential, f.spool);
    assert.equal(projectPolicy(f.client, f.a).metadataDays, 1); assert.equal(projectPolicy(f.client, f.a).usageDays, 60); assert.equal(projectPolicy(f.client, f.b).usageDays, 2);
    const original = await readFile(path.join(f.traces, 'a.jsonl'), 'utf8'); deleteProject(f.hub, f.a); await synchronizeProjectPolicies(f.client, f.config, f.credential, f.spool);
    assert.equal(projectPolicy(f.client, f.a).excluded, true); assert.equal(f.client.summary().usage.total.value, '22'); assert.equal(await readFile(path.join(f.traces, 'a.jsonl'), 'utf8'), original);
    await appendFile(path.join(f.traces, 'a.jsonl'), lines([response('a', 'a-forbidden', 999)])); await new IndexCollector(f.client, [f.traces], f.credential.fingerprintKey).scan(); assert.equal(f.client.summary().usage.total.value, '22');
    await sendSpool(f.client, f.config, f.credential, f.spool); assert.equal(f.hub.summary().usage.total.value, '22');
  } finally { await f.close(); }
});

test('stale/forged controls and receipts are rejected; restored client receipts are repaired instead of trusting online status', async () => {
  const f = await fixture();
  try {
    const old = plainControls(f.hub, f.config.deviceId); setRetention(f.hub, { eventDays: 7, usageDays: 90, rawCopies: false, textSearch: false }); await synchronizeProjectPolicies(f.client, f.config, f.credential, f.spool);
    assert.throws(() => applyProjectControls(f.client, old), /STALE_PROJECT_POLICY_CONTROL/);
    const forged = structuredClone(plainControls(f.hub, f.config.deviceId)); forged[0].policy.allowExports = false; assert.throws(() => checkedProjectControls(f.client, forged), /INVALID_PROJECT_POLICY_CONTROL/);
    await assert.rejects(request(f.config.endpoint, '/v2/project-policies', { workspaceId: 'wrong' }, f.config, f.credential), /UNAUTHORIZED/);
    await assert.rejects(request(f.config.endpoint, '/v2/project-policies/ack', { workspaceId: f.config.workspaceId, controls: [{ projectId: '*', version: '999', controlId: 'policy:' + '0'.repeat(64) }] }, f.config, f.credential), /PROJECT_POLICY_CHANGED/);
    f.client.db.prepare('DELETE FROM collector_project_constraints').run(); f.client.db.prepare("DELETE FROM settings WHERE key LIKE 'collector-project-applied:%'").run();
    assert.equal(projectPolicy(f.client, f.b).usageDays, null); await synchronizeProjectPolicies(f.client, f.config, f.credential, f.spool); assert.equal(projectPolicy(f.client, f.b).usageDays, 90); assert.equal(f.receiver.view().devices.find(d => d.id === f.config.deviceId)!.projectPolicySync!.state, 'applied');
    f.receiver.revoke(f.config.deviceId); await assert.rejects(synchronizeProjectPolicies(f.client, f.config, f.credential, f.spool), /UNAUTHORIZED/);
  } finally { await f.close(); }
});

test('all policy pages are applied beyond the first 32 entries, within the existing bounded HTTP response', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 70; i++) { const id = 'project:' + i.toString(16).padStart(24, '0'); setProjectPolicy(f.hub, { ...projectPolicy(f.hub, id), allowExports: false }); }
    await synchronizeProjectPolicies(f.client, f.config, f.credential, f.spool);
    const state = f.receiver.view().devices.find(d => d.id === f.config.deviceId)!.projectPolicySync!; assert.equal(state.pending, 0); assert.equal(state.applied, 71); assert.equal(f.client.db.prepare('SELECT COUNT(*) AS n FROM collector_project_constraints').get()!.n, 71);
    await sendSpool(f.client, f.config, f.credential, f.spool); assert.equal(f.hub.summary().usage.total.value, '34');
  } finally { await f.close(); }
});

test('cached policy expiry also clears queued usage while offline, without requiring another policy change', async () => {
  const f = await fixture();
  try {
    setProjectPolicy(f.hub, { ...projectPolicy(f.hub, f.a), metadataDays: 1, usageDays: 2 }); await synchronizeProjectPolicies(f.client, f.config, f.credential, f.spool); await sendSpool(f.client, f.config, f.credential, f.spool);
    await appendFile(path.join(f.traces, 'a.jsonl'), lines([response('a', 'expiring', 99)])); await new IndexCollector(f.client, [f.traces], f.credential.fingerprintKey).scan(); await enqueue(f.client, f.config, f.credential, f.spool); assert((await readdir(f.spool)).length > 0);
    f.client.db.prepare("UPDATE observations SET received_at=? WHERE json_extract(normalized,'$.context.projectId')=?").run(new Date(Date.now() - 3 * 86400000).toISOString(), f.a);
    const original = await readFile(path.join(f.traces, 'a.jsonl'), 'utf8'); await f.receiver.stop(); f.restart(); await expireCollectorRetention(f.client, f.config, f.spool);
    assert.equal(f.client.summary({ projectId: f.a }).selectedEntries, 0); assert.deepEqual(await readdir(f.spool), []); assert.equal(f.client.summary({ projectId: f.b }).usage.total.value, '22'); assert.equal(await readFile(path.join(f.traces, 'a.jsonl'), 'utf8'), original);
    await new IndexCollector(f.client, [f.traces], f.credential.fingerprintKey).scan(); await enqueue(f.client, f.config, f.credential, f.spool);
    await f.receiver.start(0); f.config.endpoint = f.receiver.view().endpoint; await synchronizeProjectPolicies(f.client, f.config, f.credential, f.spool); await sendSpool(f.client, f.config, f.credential, f.spool); assert.equal(f.hub.summary().usage.total.value, '34');
  } finally { await f.close(); }
});
