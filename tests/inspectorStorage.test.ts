import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';

test('v4 migration retains every historical entry and source cursor with a consistent backup and valid foreign keys', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-migration-'));
  const original = new InspectorStore(':memory:', { workspaceId: 'migration-workspace', machineId: 'migration-machine' });
  let migrated: InspectorStore | undefined;
  try {
    const source = path.join(root, 'synthetic.jsonl');
    await writeFile(source, [
      { type: 'session_meta', payload: { id: 'migration-thread', model_provider: 'openai' } },
      { type: 'token_usage_record', ordinal: 1, payload: { thread_id: 'migration-thread', response_id: 'migration-response', usage: { input_tokens: 10, output_tokens: 2 } } },
    ].map(record => JSON.stringify(record)).join('\n') + '\n');
    await new IndexCollector(original, [root]).scan(); const scope = original.ledger().items[0].scopeId;
    for (let i = 0; i < 8; i++) original.reconcile([scope]);
    const before = original.db.prepare('SELECT * FROM ledger ORDER BY revision,id').all();
    const filename = path.join(root, 'v4.sqlite'); const old = new DatabaseSync(filename);
    try {
      old.exec(await readFile(new URL('./fixtures/inspector/schema-v4.sql', import.meta.url), 'utf8'));
      for (const table of ['workspaces', 'settings', 'sources', 'observations', 'usage_observations', 'revisions', 'scope_state', 'ledger', 'ledger_links']) {
        const rows = original.db.prepare(`SELECT * FROM ${table}`).all();
        if (!rows.length) continue;
        const columns = Object.keys(rows[0]); const insert = old.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`);
        for (const row of rows) insert.run(...columns.map(column => row[column] as SQLInputValue));
      }
    } finally { old.close(); }
    migrated = new InspectorStore(filename);
    const after = migrated.db.prepare('SELECT * FROM ledger ORDER BY revision,id').all();
    assert.equal(after.length, before.length);
    for (let i = 0; i < before.length; i++) assert.deepEqual(JSON.parse(String(after[i].entry)), JSON.parse(String(before[i].entry)));
    assert.deepEqual(migrated.sources(), original.sources()); assert.equal(migrated.summary().usage.total.value, '12');
    assert.equal(migrated.db.prepare('SELECT COUNT(*) n FROM ledger_payloads').get()!.n, 1);
    assert.deepEqual(migrated.db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.throws(() => migrated!.db.prepare("UPDATE ledger_memberships SET payload_id='missing'").run(), /FOREIGN KEY/);
    const backup = (await readdir(root)).find(name => name.startsWith('v4.sqlite.v4-backup-')); assert.ok(backup);
    const snapshot = new DatabaseSync(path.join(root, backup), { readOnly: true });
    try { assert.equal(snapshot.prepare('PRAGMA user_version').get()!.user_version, 4); assert.equal(snapshot.prepare('SELECT COUNT(*) n FROM ledger').get()!.n, 9); }
    finally { snapshot.close(); }
  } finally { original.close(); migrated?.close(); await rm(root, { recursive: true, force: true }); }
});


test('v5 additive migration keeps accounting membership and adds empty disabled manifest storage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-v5-')); const filename = path.join(root, 'index.sqlite');
  let store = new InspectorStore(filename); let opened = true;
  try {
    await writeFile(path.join(root, 'sample.jsonl'), [
      { type: 'session_meta', payload: { id: 'v5-thread', model_provider: 'openai' } },
      { type: 'token_usage_record', payload: { thread_id: 'v5-thread', response_id: 'v5-response', usage: { input_tokens: 10, output_tokens: 2 } } },
    ].map(record => JSON.stringify(record)).join('\n') + '\n');
    await new IndexCollector(store, [root]).scan(); const before = store.ledger();
    const identity = { workspaceId: store.workspaceId, machineId: store.machineId };
    store.db.exec('DROP TABLE timeline_events; DROP INDEX timeline_ledger_observation; DROP TABLE project_policies; DROP TABLE project_retention_floors; DROP TABLE usage_retention_gaps; DROP TABLE project_source_links; DROP TABLE manual_usd_prices; ALTER TABLE devices DROP COLUMN offline_public_key; ALTER TABLE devices DROP COLUMN offline_registered_at; ALTER TABLE devices DROP COLUMN last_online_seen; ALTER TABLE devices DROP COLUMN last_ingest_mode; DROP TABLE incidents; DROP TABLE alert_checkpoints; DROP TABLE alert_suppressions; DROP TABLE context_records; DROP TABLE context_exclusions; DROP TABLE source_deletion_receipts; ALTER TABLE devices DROP COLUMN credential_confirmed_at; PRAGMA user_version=5;'); store.close(); opened = false;
    store = new InspectorStore(filename); opened = true;
    assert.equal(store.workspaceId, identity.workspaceId); assert.equal(store.machineId, identity.machineId);
    assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version, 11);
    assert.deepEqual(store.ledger(), before); assert.equal(store.summary().usage.total.value, '12');
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM context_records').get()!.n, 0);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
    const backup = (await readdir(root)).find(name => name.startsWith('index.sqlite.v5-backup-')); assert.ok(backup);
    const old = new DatabaseSync(path.join(root, backup), { readOnly: true }); try { assert.equal(old.prepare('PRAGMA user_version').get()!.user_version, 5); } finally { old.close(); }
  } finally { if (opened) store.close(); await rm(root, { recursive: true, force: true }); }
});


test('v6 migration retains context storage and adds enrollment/deletion receipt fields', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-v6-')); const filename = path.join(root, 'index.sqlite');
  let store = new InspectorStore(filename); let opened = true;
  try {
    store.setSetting('context_manifest_consent', 'null');
    store.db.exec('DROP TABLE timeline_events; DROP INDEX timeline_ledger_observation; DROP TABLE project_policies; DROP TABLE project_retention_floors; DROP TABLE usage_retention_gaps; DROP TABLE project_source_links; DROP TABLE manual_usd_prices; ALTER TABLE devices DROP COLUMN offline_public_key; ALTER TABLE devices DROP COLUMN offline_registered_at; ALTER TABLE devices DROP COLUMN last_online_seen; ALTER TABLE devices DROP COLUMN last_ingest_mode; DROP TABLE incidents; DROP TABLE alert_checkpoints; DROP TABLE alert_suppressions; DROP TABLE source_deletion_receipts; ALTER TABLE devices DROP COLUMN credential_confirmed_at; PRAGMA user_version=6;'); store.close(); opened = false;
    store = new InspectorStore(filename); opened = true;
    assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version, 11);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM context_records').get()!.n, 0);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM source_deletion_receipts').get()!.n, 0);
    assert.ok(store.db.prepare('PRAGMA table_info(devices)').all().some(column => column.name === 'credential_confirmed_at'));
    assert.equal(store.getSetting('context_manifest_consent'), 'null');
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { if (opened) store.close(); await rm(root, { recursive: true, force: true }); }
});

test('v7 migration preserves collector confirmation and adds empty incident tracking', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-v7-alerts-')); const filename = path.join(root, 'index.sqlite');
  let store = new InspectorStore(filename); let opened = true;
  try {
    const identity = { workspaceId: store.workspaceId, machineId: store.machineId };
    store.db.exec('DROP TABLE timeline_events; DROP INDEX timeline_ledger_observation; DROP TABLE project_policies; DROP TABLE project_retention_floors; DROP TABLE usage_retention_gaps; DROP TABLE project_source_links; DROP TABLE manual_usd_prices; ALTER TABLE devices DROP COLUMN offline_public_key; ALTER TABLE devices DROP COLUMN offline_registered_at; ALTER TABLE devices DROP COLUMN last_online_seen; ALTER TABLE devices DROP COLUMN last_ingest_mode; DROP TABLE incidents; DROP TABLE alert_checkpoints; DROP TABLE alert_suppressions; PRAGMA user_version=7;'); store.close(); opened = false;
    store = new InspectorStore(filename); opened = true;
    assert.equal(store.workspaceId, identity.workspaceId); assert.equal(store.machineId, identity.machineId);
    assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version, 11);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM incidents').get()!.n, 0);
    assert.ok(store.db.prepare('PRAGMA table_info(devices)').all().some(column => column.name === 'credential_confirmed_at'));
    assert.equal(store.db.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.ok((await readdir(root)).some(name => name.startsWith('index.sqlite.v7-backup-')));
  } finally { if (opened) store.close(); await rm(root, { recursive: true, force: true }); }
});

test('v8 migration preserves collector identities and adds offline/public contact fields', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-v8-offline-')); const filename = path.join(root, 'index.sqlite');
  let store = new InspectorStore(filename); let opened = true;
  try {
    const identity = { workspaceId: store.workspaceId, machineId: store.machineId };
    store.db.exec('DROP TABLE timeline_events; DROP INDEX timeline_ledger_observation; DROP TABLE project_policies; DROP TABLE project_retention_floors; DROP TABLE usage_retention_gaps; DROP TABLE project_source_links; DROP TABLE manual_usd_prices; ALTER TABLE devices DROP COLUMN offline_public_key; ALTER TABLE devices DROP COLUMN offline_registered_at; ALTER TABLE devices DROP COLUMN last_online_seen; ALTER TABLE devices DROP COLUMN last_ingest_mode; PRAGMA user_version=8;'); store.close(); opened = false;
    store = new InspectorStore(filename); opened = true;
    assert.equal(store.workspaceId, identity.workspaceId); assert.equal(store.machineId, identity.machineId);
    assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version, 11);
    const fields = store.db.prepare('PRAGMA table_info(devices)').all().map(column => column.name);
    assert.ok(fields.includes('offline_public_key')); assert.ok(fields.includes('last_online_seen'));
    assert.equal(store.db.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.ok((await readdir(root)).some(name => name.startsWith('index.sqlite.v8-backup-')));
  } finally { if (opened) store.close(); await rm(root, { recursive: true, force: true }); }
});
