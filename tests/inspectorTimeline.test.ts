import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { timeline, timelineState } from '../src/storage/timeline';
import { projectPolicy, setProjectPolicy } from '../src/storage/project-privacy';
import { deleteSource } from '../src/storage/privacy';
import { fingerprint } from '../src/accounting/codex-observations';

const key = 'timeline-test-key'; const line = (records: unknown[]) => records.map(row => JSON.stringify(row)).join('\n') + '\n';
const header = (id = 'timeline-root', parent?: string) => ({ type: 'session_meta', payload: { id, cwd: '/TIMELINE_PROJECT', model_provider: 'openai', ...(parent ? { parent_thread_id: parent } : {}) } });
const usage = (id: string, at?: string, thread = 'timeline-root', input = 10) => ({ type: 'token_usage_record', ...(at ? { timestamp: at } : {}), payload: { thread_id: thread, response_id: id, model: 'gpt-observed', service_tier: 'fast', usage: { input_tokens: input, cached_input_tokens: 8, output_tokens: 2 } } });
async function fixture(records: unknown[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-timeline-')); const dbfile = path.join(root, 'index.sqlite'); const file = path.join(root, 'root.jsonl'); await writeFile(file, line(records));
  const store = new InspectorStore(dbfile); const collector = new IndexCollector(store, [root], key); await collector.scan();
  return { root, file, dbfile, store, collector, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('full metadata search finds the last of 10,000 retained events after restart without indexing raw text', async () => {
  const f = await fixture([header(), ...Array.from({ length: 9999 }, () => ({ type: 'event_msg', payload: { type: 'agent_message', message: 'PRIVATE_TIMELINE_MARKER' } })), { type: 'response_item', payload: { type: 'function_call', name: 'unique_history_tool', call_id: 'final-call', arguments: '{"cmd":"cat /TIMELINE_FILE"}' } }]);
  try {
    const found = timeline(f.store, { search: 'unique_history_tool', limit: 1 }); assert.equal(found.matchedEvents, 1); assert.equal(found.items[0].line, 10001); assert.equal(found.items[0].toolName, 'unique_history_tool');
    assert.equal(timeline(f.store, { search: 'PRIVATE_TIMELINE_MARKER' }).matchedEvents, 0);
    assert.equal(timeline(f.store, { fileIdentity: fingerprint('/TIMELINE_FILE', key)! }).matchedEvents, 1);
    let page = timeline(f.store); const ids = new Set(page.items.map(item => item.id)); let last = page.items.at(-1)!;
    while (page.nextCursor) { page = timeline(f.store, { cursor: page.nextCursor }); for (const event of page.items) assert.equal(ids.has(event.id), false), ids.add(event.id); last = page.items.at(-1)!; }
    assert.equal(ids.size, 10001); assert.equal(last.line, 10001);
    const reopened = new InspectorStore(f.dbfile); try { assert.equal(timeline(reopened, { limit: 1 }).items[0].line, 1); assert.equal(timeline(reopened, { direction: 'desc', limit: 1 }).items[0].line, 10001); } finally { reopened.close(); }
    assert.equal(f.store.summary().selectedEntries, 0);
  } finally { await f.close(); }
});

test('append-only changes preserve paging watermark and captured canonical references, while privacy and reparse invalidate it', async () => {
  const f = await fixture([header(), usage('original')]);
  try {
    const first = timeline(f.store, { limit: 1 }); assert.ok(first.nextCursor); const revision = first.revision;
    await appendFile(f.file, line([usage('original', undefined, 'timeline-root', 20), usage('new')])); await f.collector.scan();
    const second = timeline(f.store, { limit: 1, cursor: first.nextCursor! }); assert.equal(second.revision, revision); assert.equal(second.matchedEvents, 2); assert.equal(second.items[0].ledger[0].total, '12'); assert.equal(second.items[0].ledger[0].status, 'selected'); assert.equal(second.nextCursor, null);
    assert.ok(BigInt(timelineState(f.store).watermark) > BigInt(first.watermark)); assert.equal(timeline(f.store).matchedEvents, 4);
    assert.throws(() => timeline(f.store, { cursor: first.nextCursor!, toolName: 'different' }), /INVALID_CURSOR/);
    setProjectPolicy(f.store, { ...projectPolicy(f.store, '(unknown)'), allowExports: false }); assert.throws(() => timeline(f.store, { cursor: first.nextCursor! }), /TIMELINE_SNAPSHOT_INVALIDATED/);
    const reparsePage = timeline(f.store, { limit: 1 }); await f.collector.reparse(); assert.throws(() => timeline(f.store, { limit: 1, cursor: reparsePage.nextCursor! }), /TIMELINE_SNAPSHOT_INVALIDATED/);
  } finally { await f.close(); }
});

test('paging one captured run avoids rescanning full history and returns independent facets', async () => {
  const f = await fixture([header(), usage('first'), usage('second')]);
  try {
    let historyScans = 0; const prepare = f.store.db.prepare.bind(f.store.db);
    f.store.db.prepare = sql => { if (sql.includes('FROM timeline_events e') && sql.includes('GROUP BY e.machine_id,e.thread_id,e.kind')) historyScans++; return prepare(sql); };
    const first = timeline(f.store, { runId: 'timeline-root', limit: 1 }); assert.equal(historyScans, 1); assert.equal(first.matchedEvents, 3);
    first.eventKinds.push('CALLER_MUTATION'); first.agents[0].events = 999;
    const next = timeline(f.store, { runId: 'timeline-root', limit: 1, cursor: first.nextCursor! });
    assert.equal(historyScans, 1); assert.equal(next.items[0].line, 2); assert.equal(next.matchedEvents, 3);
    assert.equal(next.eventKinds.includes('CALLER_MUTATION'), false); assert.equal(next.agents[0].events, 3);
    const different = timeline(f.store, { runId: 'timeline-root', eventKind: 'token_usage_record' });
    assert.equal(historyScans, 2); assert.equal(different.matchedEvents, 2);
  } finally { await f.close(); }
});

test('cached ancestry remains captured when a child changes parent, including after another scope is read', async () => {
  const f = await fixture([header(), usage('root')]);
  try {
    const child = path.join(f.root, 'child.jsonl');
    await writeFile(child, line([header('timeline-child', 'timeline-root'), usage('child', undefined, 'timeline-child')])); await f.collector.scan();
    const first = timeline(f.store, { runId: 'timeline-root', limit: 1 }); assert.equal(first.matchedEvents, 4);
    await appendFile(child, line([header('timeline-child', 'another-root')])); await f.collector.scan();
    assert.equal(timeline(f.store, { runId: 'timeline-root' }).matchedEvents, 2);
    const old = timeline(f.store, { runId: 'timeline-root', limit: 1, cursor: first.nextCursor! });
    assert.equal(old.matchedEvents, 4); assert.equal(old.watermark, first.watermark);
    assert.equal(timeline(f.store, { runId: 'timeline-child' }).matchedEvents, 3);
    assert.equal(timeline(f.store, { runId: 'timeline-root', limit: 1, cursor: first.nextCursor! }).matchedEvents, 4);
  } finally { await f.close(); }
});

test('snapshot cache belongs to its SQLite connection and supports a read-only main database', async () => {
  const f = await fixture([header(), usage('first'), usage('second')]);
  try {
    timeline(f.store, { runId: 'timeline-root', limit: 1 }); f.store.db.close();
    Object.defineProperty(f.store, 'db', { value: new DatabaseSync(f.dbfile, { readOnly: true }) });
    const before = f.store.db.prepare('PRAGMA data_version').get()!.data_version;
    const first = timeline(f.store, { runId: 'timeline-root', limit: 1 });
    assert.equal(timeline(f.store, { runId: 'timeline-root', limit: 1, cursor: first.nextCursor! }).matchedEvents, 3);
    assert.equal(f.store.db.prepare('PRAGMA data_version').get()!.data_version, before);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) n FROM main.sqlite_master WHERE name LIKE 'timeline_%_cache'").get()!.n, 0);
  } finally { await f.close(); }
});

test('moving day windows refresh without writes while an earlier cursor keeps its captured bounds', async () => {
  const f = await fixture([header(), usage('boundary', '2026-10-13T09:00:00Z'), usage('second', '2026-10-13T09:00:01Z')]);
  try {
    const now = Date.parse('2026-10-14T09:00:00Z');
    const first = timeline(f.store, { days: 1, limit: 1 }, now); assert.equal(first.matchedEvents, 2);
    assert.equal(timeline(f.store, { days: 1, limit: 1 }, now + 2000).matchedEvents, 0);
    const old = timeline(f.store, { days: 1, limit: 1, cursor: first.nextCursor! }, now + 2000);
    assert.equal(old.matchedEvents, 2); assert.equal(old.items[0].line, 3);
  } finally { await f.close(); }
});

test('event-time paging handles equal, out-of-order and unknown timestamps in both directions', async () => {
  const late = '2026-10-13T09:00:00Z'; const early = '2026-10-13T08:00:00Z';
  const f = await fixture([header(), usage('late', late), usage('early', early), usage('equal', early), usage('untimed')]);
  try {
    const collect = (direction: 'asc' | 'desc') => { let page = timeline(f.store, { order: 'time', direction, limit: 1 }); const lines = page.items.map(item => item.line); while (page.nextCursor) { page = timeline(f.store, { order: 'time', direction, limit: 1, cursor: page.nextCursor }); lines.push(...page.items.map(item => item.line)); } return lines; };
    assert.deepEqual(collect('asc'), [3, 4, 2, 1, 5]); assert.deepEqual(collect('desc'), [2, 4, 3, 5, 1]);
    const bounded = timeline(f.store, { from: '2026-10-13T08:30:00Z', to: '2026-10-13T10:00:00Z' }); assert.deepEqual(bounded.items.map(item => item.line), [2]); assert.equal(bounded.unknownTimes, 0);
    assert.equal(timeline(f.store, { from: '2026-10-13T08:30:00Z', includeUnknownTime: true }).unknownTimes, 2);
    assert.equal(timeline(f.store, { provider: 'openai', serviceTier: 'fast', attributedModel: 'gpt-observed' }).matchedEvents, 4);
  } finally { await f.close(); }
});

test('inclusive/exclusive agent filtering follows captured parent relationships and metadata evidence links', async () => {
  const f = await fixture([header(), usage('root')]);
  try {
    await writeFile(path.join(f.root, 'child.jsonl'), line([header('timeline-child', 'timeline-root'), usage('child', undefined, 'timeline-child')])); await f.collector.scan();
    assert.equal(timeline(f.store, { runId: 'timeline-root' }).matchedEvents, 4); assert.equal(timeline(f.store, { agentId: 'timeline-root', agentMode: 'exclusive' }).matchedEvents, 2); assert.equal(timeline(f.store, { agentId: 'timeline-root', agentMode: 'inclusive' }).matchedEvents, 4);
    const event = timeline(f.store, { eventKind: 'token_usage_record' }).items[0]; assert.equal(timeline(f.store, { evidenceRef: event.evidenceRef }).matchedEvents, 1);
    const finding = `finding:${'a'.repeat(64)}`; f.store.db.prepare('INSERT INTO incidents VALUES(?,?,?,?)').run(finding, f.store.workspaceId, event.sourceId, JSON.stringify({ evidenceRefs: [event.evidenceRef] }));
    assert.equal(timeline(f.store, { findingId: finding }).items[0].id, event.id);
    const old = timeline(f.store, { limit: 1 }); deleteSource(f.store, event.sourceId); assert.throws(() => timeline(f.store, { limit: 1, cursor: old.nextCursor! }), /TIMELINE_SNAPSHOT_INVALIDATED/);
    assert.equal(f.store.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { await f.close(); }
});

test('schema-10 migration backfills metadata search without rewriting historical ledger payloads', async () => {
  const f = await fixture([header(), usage('stored')]); let open = true;
  try {
    const before = f.store.db.prepare('SELECT id,entry FROM ledger_payloads ORDER BY id').all();
    f.store.db.exec('DROP TABLE timeline_events; DROP INDEX timeline_ledger_observation; PRAGMA user_version=10;'); f.store.close(); open = false;
    const upgraded = new InspectorStore(f.dbfile); try { assert.equal(upgraded.db.prepare('PRAGMA user_version').get()!.user_version, 11); assert.deepEqual(upgraded.db.prepare('SELECT id,entry FROM ledger_payloads ORDER BY id').all(), before); assert.equal(timeline(upgraded, { search: 'gpt-observed' }).matchedEvents, 1); assert.equal(upgraded.summary().usage.total.value, '12'); } finally { upgraded.close(); }
  } finally { if (open) f.store.close(); await rm(f.root, { recursive: true, force: true }); }
});
