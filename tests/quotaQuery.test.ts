import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { quotas } from '../src/storage/quotas';
import type { InspectorQuery } from '../src/shared/inspector';
const stamp = (second: number) => new Date(Date.UTC(2026, 9, 15, 0, 0, second)).toISOString();
const point = (second: number, limit: string | null = 'codex', percent = 12.345) => ({ type: 'event_msg', timestamp: stamp(second), payload: { type: 'token_count', rate_limits: { ...(limit ? { limit_id: limit } : {}), primary: { used_percent: percent, window_minutes: 270, resets_at: null } } } });
const lines = (records: unknown[]) => records.map(record => JSON.stringify(record)).join('\n') + '\n';
function previousIds(store: InspectorStore, query: InspectorQuery) {
  const f = store.metadataFilter(query, 'o.timestamp', 'COALESCE(a.normalized,o.normalized)', 'context.');
  const fields = `SELECT o.id,o.source_id,o.timestamp,o.rowid,json_extract(COALESCE(a.normalized,o.normalized),'$.metadata.quota') AS quota FROM observations o JOIN sources s ON s.id=o.source_id LEFT JOIN source_analysis v ON v.source_id=o.source_id LEFT JOIN observation_analyses a ON a.observation_id=o.id AND a.revision=v.revision WHERE ${f.sql} AND o.kind='event_msg/token_count' AND json_type(COALESCE(a.normalized,o.normalized),'$.metadata.quota')='object'`;
  return { snapshots: store.db.prepare(`WITH candidates AS (${fields}), ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY source_id,json_extract(quota,'$.limitId') ORDER BY timestamp DESC,rowid DESC) AS rank FROM candidates) SELECT id FROM ranked WHERE rank=1 ORDER BY timestamp DESC,rowid DESC LIMIT 200`).all(...f.args).map(row => String(row.id)), history: store.db.prepare(`${fields} ORDER BY o.timestamp DESC,o.rowid DESC LIMIT 200`).all(...f.args).map(row => String(row.id)) };
}

test('single-pass quota results preserve source buckets, ties, scopes and active analysis', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'quota-query-')); const store = new InspectorStore(':memory:');
  try {
    for (const [thread, model] of [['a', 'model-a'], ['b', 'model-b']]) await writeFile(path.join(root, thread + '.jsonl'), lines([{ type: 'session_meta', payload: { id: thread, model_provider: 'openai', cwd: '/fixture/' + thread } }, { type: 'turn_context', payload: { model } }, point(1), point(2), point(2, 'codex', 15), point(3, 'second-limit'), point(4, null), { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'not a quota record' }] } }]));
    await new IndexCollector(store, [root]).scan();
    assert.equal(quotas(store).snapshots[0].primary?.usedPercent, '12.345');
    const row = store.db.prepare("SELECT id,source_id,normalized FROM observations WHERE kind='event_msg/token_count' ORDER BY rowid DESC LIMIT 1").get()!;
    const normalized = JSON.parse(String(row.normalized)); normalized.metadata.quota.primary.usedPercent = '99'; normalized.context.requestedModel = 'model-reparsed';
    const revision = Number(store.db.prepare('INSERT INTO revisions(created_at,policy_version) VALUES(?,?)').run(new Date().toISOString(), 'fixture-analysis').lastInsertRowid);
    store.db.prepare('INSERT INTO observation_analyses VALUES(?,?,?)').run(row.id, revision, JSON.stringify(normalized)); store.db.prepare('INSERT INTO source_analysis VALUES(?,?)').run(row.source_id, revision);
    const queries: InspectorQuery[] = [{}, { runId: 'a' }, { machineId: store.machineId }, { machineId: 'missing' }, { requestedModel: 'model-reparsed' }, { attributedModel: 'model-a' }, { provider: 'openai' }, { provider: null }, { from: stamp(2), to: stamp(4) }];
    for (const query of queries) { const expected = previousIds(store, query); const actual = quotas(store, query); assert.deepEqual(actual.snapshots.map(row => row.id), expected.snapshots); assert.deepEqual(actual.history.map(row => row.id), expected.history); }
    assert.equal(quotas(store, { requestedModel: 'model-reparsed' }).snapshots[0].primary?.usedPercent, '99'); assert.equal(quotas(store).accountTotal.value, null);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test('400-row union retains both independent 200-row limits under a hot source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'quota-limits-')); const store = new InspectorStore(':memory:');
  try {
    for (let index = 0; index < 205; index++) await writeFile(path.join(root, `${index}.jsonl`), lines([{ type: 'session_meta', payload: { id: `thread-${index}`, model_provider: 'openai' } }, point(index)]));
    await writeFile(path.join(root, 'hot.jsonl'), lines([{ type: 'session_meta', payload: { id: 'hot', model_provider: 'openai' } }, ...Array.from({ length: 450 }, (_, index) => point(1000 + index))]));
    await new IndexCollector(store, [root]).scan(); const expected = previousIds(store, {}); const actual = quotas(store);
    assert.equal(actual.snapshots.length, 200); assert.equal(actual.history.length, 200); assert.deepEqual(actual.snapshots.map(row => row.id), expected.snapshots); assert.deepEqual(actual.history.map(row => row.id), expected.history);
    assert.equal(new Set(actual.history.map(row => row.sourceId)).size, 1); assert.equal(new Set(actual.snapshots.map(row => row.sourceId)).size, 200);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test('cache handles append-only changes incrementally and rebuilds after deletions without leaking caller mutations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'quota-cache-')); const store = new InspectorStore(':memory:'); const file = path.join(root, 'run.jsonl');
  try {
    await writeFile(file, lines([{ type: 'session_meta', payload: { id: 'cached', model_provider: 'openai' } }, point(1), point(2)])); const collector = new IndexCollector(store, [root]); await collector.scan();
    const originalPrepare = store.db.prepare.bind(store.db); const queries: string[] = [];
    store.db.prepare = sql => { if (sql.includes('WITH candidates AS MATERIALIZED')) queries.push(sql); return originalPrepare(sql); };
    const first = quotas(store); first.snapshots[0].primary!.usedPercent = 'caller-mutation';
    assert.equal(quotas(store).snapshots[0].primary!.usedPercent, '12.345'); assert.equal(queries.length, 1);
    await appendFile(file, lines([{ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [] } }])); await collector.scan(); quotas(store); assert.equal(queries.length, 1);
    for (const second of [3, -5]) { await appendFile(file, lines([point(second)])); await collector.scan(); const next = quotas(store); assert.deepEqual(next.history.map(row => row.id), previousIds(store, {}).history); assert.match(queries.at(-1)!, /e.sequence>\?/); }
    const oldest = store.db.prepare("SELECT id FROM observations WHERE kind='event_msg/token_count' ORDER BY rowid LIMIT 1").get()!;
    store.db.prepare('DELETE FROM observations WHERE id=?').run(oldest.id); assert.deepEqual(quotas(store).history.map(row => row.id), previousIds(store, {}).history); assert.doesNotMatch(queries.at(-1)!, /e.sequence>\?/);
    const removed = store.db.prepare("SELECT id FROM observations WHERE kind='event_msg/token_count' ORDER BY rowid LIMIT 1").get()!; store.db.prepare('DELETE FROM observations WHERE id=?').run(removed.id);
    await appendFile(file, lines([point(4)])); await collector.scan(); assert.deepEqual(quotas(store).history.map(row => row.id), previousIds(store, {}).history); assert.doesNotMatch(queries.at(-1)!, /e.sequence>\?/);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
