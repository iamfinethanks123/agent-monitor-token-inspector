import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, appendFile, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { fingerprint } from '../src/accounting/codex-observations';
import { captureContent, contentSearch, CONTENT_LIMITS, pruneContent, retainContent } from '../src/storage/local-content';
import { projectPolicy, projectPolicyPlan, setProjectPolicy } from '../src/storage/project-privacy';
import { applyRetention, deleteProject, deleteSource, setRetention } from '../src/storage/privacy';
import { report } from '../src/reporting/report';
import { enqueue, unprotect } from '../src/collector/metadata-sync';

const key = 'local-content-fixture-key', project = `project:${fingerprint('/fixture-project', key)!.slice(0, 24)}`;
const message = (text: string) => ({ type: 'response_item', timestamp: '2026-10-15T02:00:00Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
const lines = (records: unknown[]) => records.map(row => JSON.stringify(row)).join('\n') + '\n';
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-content-')), filename = path.join(root, 'session.jsonl');
  const store = new InspectorStore(path.join(root, 'index.sqlite')), collector = new IndexCollector(store, [root], key);
  await writeFile(filename, lines([{ type: 'session_meta', payload: { id: 'content-thread', cwd: '/fixture-project', model_provider: 'openai' } }, message('Historical excerpt marker'), { type: 'token_usage_record', payload: { thread_id: 'content-thread', response_id: 'usage-a', usage: { input_tokens: 10, output_tokens: 2 } } }]));
  await collector.scan();
  const enable = (days = 7) => setProjectPolicy(store, { ...projectPolicy(store, project), contentDays: days });
  return { root, filename, store, collector, enable, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('default off, explicit consent, bounded redaction and metadata-only reports / encrypted spool', async () => {
  const f = await fixture();
  try {
    assert.equal(contentSearch(f.store, { search: 'Historical' }).retained, 0);
    assert.throws(() => setProjectPolicy(f.store, { ...projectPolicy(f.store, '(unknown)'), contentDays: 7 }), /INVALID_PROJECT_POLICY/);
    assert.throws(() => setProjectPolicy(f.store, { ...projectPolicy(f.store, project), contentDays: 1, allowSourcePreview: false }), /INVALID_PROJECT_POLICY/);
    assert.equal(projectPolicyPlan(f.store, { ...projectPolicy(f.store, project), contentDays: 7 }).contentConsentRequired, true);
    f.enable(); assert.equal(contentSearch(f.store, { search: 'Historical' }).items.length, 0);
    const secret = 'sk-' + 'a'.repeat(24), text = `SEARCHABLE_MARKER password="PRIVATE_PASSWORD" Bearer PRIVATE_BEARER ${secret}\n` + '漢字'.repeat(5000);
    await appendFile(f.filename, lines([message(text)])); await f.collector.scan();
    const result = contentSearch(f.store, { search: 'searchable_marker' }); assert.equal(result.items.length, 1);
    const item = result.items[0]; assert(item.text.includes('[REDACTED]')); assert(!item.text.includes('PRIVATE_PASSWORD')); assert(!item.text.includes('PRIVATE_BEARER')); assert(!item.text.includes(secret)); assert(item.truncated); assert(Buffer.byteLength(item.text) <= CONTENT_LIMITS.excerptBytes); assert(!item.text.includes('\ufffd'));
    assert.equal(contentSearch(f.store, { projectId: 'project:' + 'f'.repeat(24), search: 'SEARCHABLE' }).items.length, 0);
    assert.equal(contentSearch(f.store, { machineId: randomUUID(), search: 'SEARCHABLE' }).items.length, 0);
    assert.equal(contentSearch(f.store, { runId: 'outside', search: 'SEARCHABLE' }).items.length, 0);
    assert.equal(contentSearch(f.store, { from: '2026-10-16T00:00:00Z', search: 'SEARCHABLE' }).items.length, 0);
    assert.equal(f.store.summary().usage.total.value, '12');
    assert(!report(f.store, {}, 'json').body.includes('SEARCHABLE_MARKER'));
    const spool = path.join(f.root, 'spool'), credential = { token: 'fixture-only-token', fingerprintKey: Buffer.alloc(32, 7).toString('base64') };
    await mkdir(spool);
    await enqueue(f.store, { schemaVersion: '2', workspaceId: f.store.workspaceId, deviceId: f.store.machineId, deviceName: 'Fixture', endpoint: 'http://127.0.0.1:9897', credentialFile: 'fixture' }, credential, spool);
    const packets = await readdir(spool); assert.equal(packets.length, 1);
    const packet = unprotect(await readFile(path.join(spool, packets[0]), 'utf8'), credential); assert(!packet.includes('SEARCHABLE_MARKER')); assert(!packet.includes('local_content')); assert(!packet.includes('PRIVATE_PASSWORD'));
    const pointer = f.store.evidencePointer(item.evidenceRef)!;
    assert.equal(captureContent(f.store, pointer.row.normalized, { type: 'future_record', payload: { text: 'UNKNOWN_PRIVATE' } }), undefined);
    const before = result.retained; retainContent(f.store, pointer.row.id, project, randomUUID(), new Date().toISOString(), { text: 'REMOTE_PRIVATE', truncated: false, redactionPolicyId: 'local-content-redaction/1' }); assert.equal(contentSearch(f.store, { search: 'REMOTE_PRIVATE' }).items.length, 0); assert.equal(contentSearch(f.store).retained, before);
  } finally { await f.close(); }
});

test('explicit verified reparse captures historical text atomically and preserves receipt expiry / token accounting', async () => {
  const f = await fixture();
  try {
    const original = await readFile(f.filename, 'utf8'); f.enable();
    assert.equal((await f.collector.reparse()).sourcesReparsed, 1);
    const first = contentSearch(f.store, { search: 'Historical' }).items[0]; assert(first);
    assert.equal((await f.collector.reparse()).sourcesReparsed, 1); assert.equal(contentSearch(f.store, { search: 'Historical' }).items[0].expiresAt, first.expiresAt);
    assert.equal(f.store.summary().usage.total.value, '12'); assert.equal(await readFile(f.filename, 'utf8'), original);
    await writeFile(f.filename, original.replace('Historical excerpt marker', 'Replacement private text'));
    assert.equal((await f.collector.reparse()).sourcesReparsed, 0); assert.equal(contentSearch(f.store, { search: 'Historical' }).items[0].text, first.text); assert.equal(contentSearch(f.store, { search: 'Replacement' }).items.length, 0);
    const controller = new AbortController(); controller.abort(); assert.equal((await f.collector.reparse(controller.signal)).cancelled, true); assert.equal(contentSearch(f.store, { search: 'Historical' }).items.length, 1);
  } finally { await f.close(); }
});

test('literal search pages use a watermark, enforce scope and invalidate on privacy changes', async () => {
  const f = await fixture();
  try {
    f.enable(); await appendFile(f.filename, lines([message('match %_ 1'), message('match %_ 2'), message('match %_ 3')])); await f.collector.scan();
    const page = contentSearch(f.store, { search: '%_', limit: 1 }); assert.equal(page.items.length, 1); assert(page.nextCursor);
    await appendFile(f.filename, lines([message('match %_ 4')])); await f.collector.scan();
    const second = contentSearch(f.store, { search: '%_', cursor: page.nextCursor, limit: 1 }); assert.equal(second.items[0].text, 'match %_ 2');
    const third = contentSearch(f.store, { search: '%_', cursor: second.nextCursor!, limit: 1 }); assert.equal(third.items[0].text, 'match %_ 3'); assert.equal(third.nextCursor, null);
    assert.throws(() => contentSearch(f.store, { search: 'different', cursor: page.nextCursor }), /INVALID_CURSOR/);
    assert.throws(() => contentSearch(f.store, { search: 'x', arbitrarySql: 'SELECT *' }), /INVALID_QUERY/);
    assert.throws(() => setRetention(f.store, { eventDays: 1, usageDays: 180, rawCopies: false, textSearch: false }), /PROJECT_CONTENT_RETENTION_CONFLICT/);
    setProjectPolicy(f.store, { ...projectPolicy(f.store, project), contentDays: 0 });
    assert.equal(contentSearch(f.store).retained, 0); assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM local_content').get()!.n, 0);
    assert.throws(() => contentSearch(f.store, { search: '%_', cursor: page.nextCursor }), /CONTENT_SNAPSHOT_INVALIDATED/);
  } finally { await f.close(); }
});

test('content expiry runs independently of metadata; shortening and project/source deletion purge derived text', async () => {
  const f = await fixture();
  try {
    f.enable(); await appendFile(f.filename, lines([message('EXPIRY_MARKER')])); await f.collector.scan();
    f.store.db.prepare('UPDATE local_content SET received_at=?,expires_at=?').run(new Date(Date.now() - 3 * 86400000).toISOString(), new Date(Date.now() + 4 * 86400000).toISOString());
    assert.equal(projectPolicyPlan(f.store, { ...projectPolicy(f.store, project), contentDays: 1 }).expiredContent, 1);
    f.enable(1); assert.equal(contentSearch(f.store).retained, 0); assert(f.store.observationCount() > 0); assert.equal(f.store.summary().usage.total.value, '12');
    await appendFile(f.filename, lines([message('EXPIRY_MARKER_2')])); await f.collector.scan();
    f.store.db.prepare('UPDATE local_content SET expires_at=?').run('2020-01-01T00:00:00Z'); assert.equal(contentSearch(f.store).retained, 0); applyRetention(f.store); assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM local_content').get()!.n, 0);
    await appendFile(f.filename, lines([message('DELETE_MARKER')])); await f.collector.scan(); assert.equal(contentSearch(f.store).retained, 1);
    const original = await readFile(f.filename, 'utf8'); deleteProject(f.store, project); assert.equal(contentSearch(f.store).retained, 0); assert.equal(await readFile(f.filename, 'utf8'), original); assert.equal(f.store.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { await f.close(); }
  const source = await fixture();
  try { source.enable(); await source.collector.reparse(); const original = await readFile(source.filename, 'utf8'); deleteSource(source.store, source.store.sources()[0].id); assert.equal(contentSearch(source.store).retained, 0); assert.equal(await readFile(source.filename, 'utf8'), original); } finally { await source.close(); }
});

test('hard project cap removes oldest excerpts and persists across restart without copying original text into metadata', async () => {
  const f = await fixture();
  try {
    f.enable(); await appendFile(f.filename, lines(Array.from({ length: 1030 }, (_, i) => message(`CAP_${String(i).padStart(4, '0')} ` + 'x'.repeat(8192))))); await f.collector.scan();
    const bytes = Number(f.store.db.prepare('SELECT SUM(bytes) AS n FROM local_content').get()!.n); assert(bytes <= CONTENT_LIMITS.projectBytes);
    assert.equal(contentSearch(f.store, { search: 'CAP_0000' }).items.length, 0); assert.equal(contentSearch(f.store, { search: 'CAP_1029' }).items.length, 1);
    assert(!JSON.stringify(f.store.db.prepare('SELECT normalized FROM observations').all()).includes('CAP_1029'));
    const reopened = new InspectorStore(path.join(f.root, 'index.sqlite')); try { assert.equal(contentSearch(reopened, { search: 'CAP_1029' }).items.length, 1); pruneContent(reopened, Date.now() + 8 * 86400000); assert.equal(contentSearch(reopened).retained, 0); assert.equal(reopened.summary().usage.total.value, '12'); } finally { reopened.close(); }
  } finally { await f.close(); }
});
