import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { EMPTY_CONTEXT, digest, fingerprint } from '../src/accounting/codex-observations';
import { applyRetention, deleteProject, projectDeletionPlan } from '../src/storage/privacy';
import { projectPolicy, projectPrivacy, setProjectPolicy, projectPolicyPlan, assertReportPrivacy, sourcePreviewAllowed } from '../src/storage/project-privacy';
import { report } from '../src/reporting/report';
import { importManifests, manifests, setManifestConsent } from '../src/storage/context-manifests';

const key = 'project-fixture-key';
const a = `project:${fingerprint('/PROJECT_A', key)!.slice(0, 24)}`; const b = `project:${fingerprint('/PROJECT_B', key)!.slice(0, 24)}`;
const header = (cwd: string) => ({ type: 'session_meta', payload: { id: 'mixed-project-thread', model_provider: 'openai', cwd } });
const response = (id: string, input: number) => ({ type: 'token_usage_record', payload: { thread_id: 'mixed-project-thread', response_id: id, usage: { input_tokens: input, output_tokens: 0 } } });
async function fixture(inputRecords?: unknown[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-project-privacy-')); const filename = path.join(root, 'mixed.jsonl'); const store = new InspectorStore(path.join(root, 'index.sqlite'));
  const records = inputRecords ?? [header('/PROJECT_A'), { type: 'response_item', payload: { role: 'user', content: [{ text: 'PRIVATE_CONTENT_MARKER' }] } }, response('a-first', 10), header('/PROJECT_B'), response('b-first', 20), header('/PROJECT_A'), response('a-second', 30)];
  const original = records.map(record => JSON.stringify(record)).join('\n') + '\n'; await writeFile(filename, original);
  const collector = new IndexCollector(store, [root], key); await collector.scan();
  return { root, filename, original, store, collector, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('per-project exports and raw previews are enforced without changing token totals', async () => {
  const f = await fixture();
  try {
    const preview = report(f.store, {}, 'json'); assertReportPrivacy(f.store, { privacyVersion: preview.privacyVersion, projectIds: preview.projectIds });
    const evidence = f.store.ledger({ projectId: a }).items[0].evidenceRefs[0]; assert.equal((await f.collector.evidence(evidence)).state, 'available');
    setProjectPolicy(f.store, { ...projectPolicy(f.store, a), allowExports: false, allowSourcePreview: false });
    for (const format of ['json', 'csv', 'markdown']) assert.throws(() => report(f.store, {}, format), /PROJECT_EXPORT_RESTRICTED/);
    assert.throws(() => assertReportPrivacy(f.store, { privacyVersion: preview.privacyVersion, projectIds: preview.projectIds }), /REPORT_PRIVACY_CHANGED/);
    assert.equal((await f.collector.evidence(evidence)).state, 'policy_denied'); assert.equal(sourcePreviewAllowed(f.store, { threadId: 'mixed-project-thread', sourcePath: f.filename }), false);
    assert.equal(f.store.summary().usage.total.value, '60');
    setProjectPolicy(f.store, { ...projectPolicy(f.store, a), allowExports: true, allowSourcePreview: true }); assert.doesNotThrow(() => report(f.store, {}, 'json'));
    assert.equal(JSON.stringify(f.store.db.prepare('SELECT normalized FROM observations').all()).includes('PRIVATE_CONTENT_MARKER'), false);
  } finally { await f.close(); }
});

test('project privacy counts use the metadata index after an existing database is reopened', async () => {
  const f = await fixture([header('/PROJECT_A'), response('a', 10), header('/PROJECT_B'), response('b', 20), header(''), response('unknown', 30)]);
  try {
    await writeFile(path.join(f.root, 'second.jsonl'), [header('/PROJECT_A'), { type: 'event_msg', payload: { type: 'agent_message' } }].map(row => JSON.stringify(row)).join('\n') + '\n');
    await f.collector.scan();
    const sql = "SELECT COALESCE(json_extract(normalized,'$.context.projectId'),'(unknown)') AS project_id,COUNT(*) AS observations,COUNT(DISTINCT source_id) AS sources FROM observations WHERE workspace_id=? GROUP BY project_id";
    const expected = f.store.db.prepare(sql).all(f.store.workspaceId).map(row => ({ ...row })).sort((left, right) => String(left.project_id).localeCompare(String(right.project_id)));
    const original = f.store.db.prepare('SELECT id,normalized FROM observations ORDER BY id').all();
    const revision = f.store.revision(); const version = f.store.db.prepare('PRAGMA user_version').get()!.user_version;
    f.store.db.exec('DROP INDEX IF EXISTS observation_project_privacy');
    const reopened = new InspectorStore(path.join(f.root, 'index.sqlite'));
    try {
      const plan = reopened.db.prepare('EXPLAIN QUERY PLAN ' + sql).all(reopened.workspaceId);
      assert(plan.some(row => String(row.detail).includes('observation_project_privacy')), 'Privacy counts must use the compact project/source index instead of reading every normalized body');
      assert.deepEqual(projectPrivacy(reopened).map(item => ({ project_id: item.id, observations: item.observations, sources: item.sources })).sort((left, right) => left.project_id.localeCompare(right.project_id)), expected);
      assert.equal(projectPrivacy(reopened).find(item => item.id === a)?.sources, 2);
      assert.equal(projectPrivacy(reopened).find(item => item.id === '(unknown)')?.observations, 2);
      assert.deepEqual(reopened.db.prepare('SELECT id,normalized FROM observations ORDER BY id').all(), original);
      assert.equal(reopened.revision(), revision); assert.equal(reopened.db.prepare('PRAGMA user_version').get()!.user_version, version);
      assert.equal(reopened.summary().usage.total.value, '60');
    } finally { reopened.close(); }
  } finally { await f.close(); }
});

test('receipt retention expires one project and preserves another in the same source, including reparse and replay', async () => {
  const f = await fixture();
  try {
    f.store.db.prepare('UPDATE observations SET received_at=?').run(new Date(Date.now() - 3 * 86400000).toISOString());
    const policy = { ...projectPolicy(f.store, a), metadataDays: 1, usageDays: 2 };
    assert.equal(projectPolicyPlan(f.store, policy).expiredObservations, 5); setProjectPolicy(f.store, policy); applyRetention(f.store);
    assert.equal(f.store.summary({ projectId: a }).selectedEntries, 0); assert.equal(f.store.summary({ projectId: b }).usage.total.value, '20');
    assert.equal(f.store.observationCount(), 2); assert.equal((await f.collector.reparse()).sourcesReparsed, 1); assert.equal(f.store.summary().usage.total.value, '20');
    const cursor = f.store.getSource(f.store.sources()[0].id)!; cursor.offset = 0; cursor.line = 0; cursor.context = { ...EMPTY_CONTEXT }; cursor.checkpointStart = 0; cursor.checkpointBytes = 0; cursor.checkpointDigest = digest('');
    f.store.db.prepare('UPDATE sources SET cursor=? WHERE id=?').run(JSON.stringify(cursor), cursor.id);
    await f.collector.scan(); assert.equal(f.store.summary().usage.total.value, '20'); assert.equal(f.store.observationCount(), 2); assert.equal(await readFile(f.filename, 'utf8'), f.original);
    assert.equal(f.store.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { await f.close(); }
});

test('project deletion is granular, suppresses future import and leaves upstream bytes and other project records intact', async () => {
  const f = await fixture();
  try {
    const plan = projectDeletionPlan(f.store, a); assert.equal(plan.observations, 5); assert.equal(plan.usageObservations, 2); assert.equal(plan.mixedSources, 1);
    assert.throws(() => projectDeletionPlan(f.store, '(unknown)'), /PROJECT_IDENTITY_REQUIRED/);
    deleteProject(f.store, a); assert.equal(f.store.summary().usage.total.value, '20'); assert.equal(f.store.observationCount(), 2); assert.equal(await readFile(f.filename, 'utf8'), f.original);
    await writeFile(f.filename, [response('a-after-delete', 999), header('/PROJECT_B'), response('b-after-delete', 7)].map(row => JSON.stringify(row)).join('\n') + '\n', { flag: 'a' }); await f.collector.scan();
    assert.equal(f.store.summary().usage.total.value, '27'); assert.equal(projectPolicy(f.store, a).excluded, true);
    assert.throws(() => setProjectPolicy(f.store, { ...projectPolicy(f.store, a), excluded: false }), /INVALID_PROJECT_POLICY/);
    assert.equal(sourcePreviewAllowed(f.store, { threadId: 'mixed-project-thread', sourcePath: f.filename }), false);
    assert.doesNotThrow(() => report(f.store, { projectId: b }, 'json'));
    setManifestConsent(f.store, true); const consent = manifests(f.store).consent!;
    assert.throws(() => importManifests(f.store, { schema: 'owned-context-bundle/1', records: [{ schema: 'owned-context/1', clientId: 'fixture-client', requestId: 'after-deletion', consentId: consent.id, workspaceId: f.store.workspaceId, machineId: f.store.machineId, threadId: 'mixed-project-thread', turnId: null, capturedAt: new Date().toISOString(), capture: 'client_visible_before_send', items: [] }] }), /MANIFEST_PROJECT_EXCLUDED/);
  } finally { await f.close(); }
});

test('explicit unidentified-project policy does not silently stop statistics collection', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-unknown-project-')); const store = new InspectorStore(':memory:'); const filename = path.join(root, 'unknown.jsonl');
  try {
    await writeFile(filename, [header('/PROJECT_UNKNOWN'), response('unknown-first', 3)].map(row => JSON.stringify(row)).join('\n') + '\n'); const collector = new IndexCollector(store, [root]); await collector.scan();
    setProjectPolicy(store, { ...projectPolicy(store, '(unknown)'), metadataDays: 1, usageDays: 2, allowExports: false, allowSourcePreview: false });
    await writeFile(filename, JSON.stringify(response('unknown-next', 4)) + '\n', { flag: 'a' }); await collector.scan(); assert.equal(store.summary().usage.total.value, '7');
    assert.throws(() => report(store, {}, 'json'), /PROJECT_EXPORT_RESTRICTED/);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test('counter ranges crossing deleted project observations are excluded, then later complete ranges resume', async () => {
  const count = (input: number) => ({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, output_tokens: 0 } } } });
  const f = await fixture([header('/PROJECT_B'), count(100), header('/PROJECT_A'), count(150), header('/PROJECT_B'), count(200), count(220)]);
  try {
    deleteProject(f.store, a);
    const entries = f.store.ledger({ includeQuarantined: true }).items;
    assert.ok(entries.some(entry => entry.issues.includes('RETENTION_GAP_IN_COUNTER_RANGE') && entry.selectionStatus === 'quarantined'));
    assert.ok(entries.some(entry => entry.grain === 'interval' && entry.usage.total.value === '20' && entry.selectionStatus === 'selected'));
    assert.equal(f.store.summary().usage.total.value, '120');
  } finally { await f.close(); }
});

test('verified reparse preserves project identity without a key; changed identity cannot bypass policy', async () => {
  const f = await fixture();
  try {
    setProjectPolicy(f.store, { ...projectPolicy(f.store, a), allowExports: false });
    const noKey = new IndexCollector(f.store, [f.root]); assert.equal((await noKey.reparse()).sourcesReparsed, 1);
    assert.equal(f.store.summary({ projectId: a }).usage.total.value, '40'); assert.throws(() => report(f.store, {}, 'json'), /PROJECT_EXPORT_RESTRICTED/);
    const otherKey = new IndexCollector(f.store, [f.root], 'different-workspace-key'); assert.equal((await otherKey.reparse()).sourcesReparsed, 0);
    assert.equal(f.store.summary().usage.total.value, '60');
    assert.throws(() => setProjectPolicy(f.store, { ...projectPolicy(f.store, a), contentDays: 31 }), /INVALID_PROJECT_POLICY/);
  } finally { await f.close(); }
});

test('retaining usage after its older context headers expire preserves provider, model and response identity on reparse', async () => {
  const f = await fixture([header('/PROJECT_A'), { type: 'turn_context', payload: { model: 'gpt-6.1-sol', turn_id: 'retained-turn' } }, response('retained-response', 10)]);
  try {
    f.store.db.prepare('UPDATE observations SET received_at=?').run(new Date(Date.now() - 3 * 86400000).toISOString());
    setProjectPolicy(f.store, { ...projectPolicy(f.store, a), metadataDays: 1, usageDays: 30 }); applyRetention(f.store);
    const before = f.store.ledger().items[0]; assert.equal(f.store.observationCount(), 1); assert.equal(before.identity.provider, 'openai'); assert.equal(before.model.requestedModel, 'gpt-6.1-sol');
    assert.equal((await f.collector.reparse()).sourcesReparsed, 1);
    const after = f.store.ledger().items[0]; assert.equal(after.scopeId, before.scopeId); assert.equal(after.id, before.id); assert.equal(after.identity.provider, before.identity.provider); assert.equal(after.model.requestedModel, before.model.requestedModel); assert.equal(after.identity.projectId, a);
  } finally { await f.close(); }
});

test('schema-9 upgrade seeds project/source links and preserves usage with an exact backup', async () => {
  const f = await fixture(); let open = true;
  try {
    const before = f.store.db.prepare('SELECT id,entry FROM ledger ORDER BY id').all();
    f.store.db.exec('DROP TABLE timeline_events; DROP INDEX timeline_ledger_observation; DROP TABLE project_policies; DROP TABLE project_retention_floors; DROP TABLE usage_retention_gaps; DROP TABLE project_source_links; PRAGMA user_version=9;'); f.store.close(); open = false;
    const upgraded = new InspectorStore(path.join(f.root, 'index.sqlite'));
    const backup = (await readdir(f.root)).find(name => name.startsWith('index.sqlite.v9-backup-')); assert.ok(backup); const saved = new DatabaseSync(path.join(f.root, backup), { readOnly: true });
    try { assert.equal(saved.prepare('PRAGMA user_version').get()!.user_version, 9); assert.deepEqual(saved.prepare('SELECT id,entry FROM ledger ORDER BY id').all(), before); } finally { saved.close(); }
    try { assert.equal(upgraded.db.prepare('PRAGMA user_version').get()!.user_version, 11); assert.equal(upgraded.summary().usage.total.value, '60'); assert.equal(upgraded.db.prepare('SELECT COUNT(*) AS n FROM project_source_links').get()!.n, 2); assert.equal(upgraded.db.prepare('PRAGMA foreign_key_check').all().length, 0); }
    finally { upgraded.close(); }
  } finally { if (open) f.store.close(); await rm(f.root, { recursive: true, force: true }); }
});
