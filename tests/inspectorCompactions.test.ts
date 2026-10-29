import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { analyze } from '../src/diagnostics/analyze';
import { trialResources } from '../src/benchmarks/resources';

const at = (second: number) => new Date(Date.UTC(2026, 9, 14, 0, 0, second)).toISOString();
const usage = (id: string, second: number, input: number, model = 'gpt-6-sol') => ({ type: 'token_usage_record', timestamp: at(second), payload: {
  thread_id: 'compact-thread', response_id: id, model, usage: { input_tokens: input, output_tokens: 2 },
} });
const phase = (type: string, id: string, second: number) => ({ type: 'event_msg', timestamp: at(second), payload: {
  type, thread_id: 'compact-thread', turn_id: 'turn-a', item: { type: 'ContextCompaction', id },
} });
const marker = (type: string, second: number) => ({ type, timestamp: at(second), payload: type === 'event_msg' ? { type: 'context_compacted' } : { message: 'PRIVATE_SUMMARY_MARKER' } });
async function fixture(records: unknown[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-compactions-')); const store = new InspectorStore(path.join(root, 'index.sqlite'));
  const file = path.join(root, 'run.jsonl');
  await writeFile(file, [{ type: 'session_meta', payload: { id: 'compact-thread', model_provider: 'openai' } },
    { type: 'turn_context', payload: { model: 'gpt-6-sol', turn_id: 'turn-a' } }, ...records].map(row => JSON.stringify(row)).join('\n') + '\n');
  const collector = new IndexCollector(store, [root]); await collector.scan();
  return { store, collector, file, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('one lifecycle and adjacent legacy aliases retain evidence without a false three-compaction burst', async () => {
  const f = await fixture([usage('before', 0, 100000), phase('item_started', 'compact-a', 1), phase('item_completed', 'compact-a', 2),
    marker('event_msg', 2), marker('compacted', 2), usage('after', 3, 20000)]);
  try {
    const view = analyze(f.store); assert.equal(view.compactionCount, 1); assert.equal(view.compactionMarkers, 4);
    const operation = view.compactions[0]; assert.equal(operation.itemId, 'compact-a'); assert.equal(operation.state, 'completed');
    assert.equal(operation.durationMs, 1000); assert.equal(operation.deduplication, 'adjacent_alias'); assert.equal(operation.evidenceRefs.length, 4);
    assert.equal(operation.before!.input.value, '100000'); assert.equal(operation.after!.input.value, '20000'); assert.equal(operation.inputChange, '-80000');
    assert.ok(operation.after!.input.assumptions.some(issue => issue.includes('context-size proxy'))); assert.equal(operation.overhead.value, null);
    assert.equal(view.findings.some(item => item.detectorId === 'compaction-burst'), false);
    const resources = trialResources(f.store, { runId: 'compact-thread' });
    assert.equal(resources.compactionRecords, 1); assert.equal(resources.compactionOperations, 1);
    assert.equal(f.store.summary().usage.total.value, '120004');
    assert.equal(JSON.stringify(view).includes('PRIVATE_SUMMARY_MARKER'), false);
    const parsed = JSON.stringify(f.store.db.prepare('SELECT normalized FROM observations').all()); assert.equal(parsed.includes('PRIVATE_SUMMARY_MARKER'), false);
    await f.collector.scan(); assert.equal(analyze(f.store).compactionCount, 1);
  } finally { await f.close(); }
});

test('copied lifecycle IDs are one operation; source generations cannot borrow nearby input', async () => {
  const f = await fixture([usage('before', 0, 100), phase('item_started', 'copied', 1), phase('item_completed', 'copied', 2)]);
  try {
    const { readFile } = await import('node:fs/promises');
    const original = await readFile(f.file, 'utf8'); await writeFile(path.join(path.dirname(f.file), 'copy.jsonl'), original); await f.collector.scan();
    assert.equal(analyze(f.store).compactionCount, 1); assert.equal(analyze(f.store).compactionMarkers, 4);
    assert.equal(f.store.summary().usage.total.value, '102');
    await writeFile(f.file, JSON.stringify({ type: 'session_meta', payload: { id: 'compact-thread', model_provider: 'openai' } }) + '\n' + JSON.stringify(usage('new-generation', 10, 5)) + '\n');
    await f.collector.scan();
    const operations = analyze(f.store).compactions;
    assert.equal(operations.length, 1); assert.equal(operations[0].after, null);
  } finally { await f.close(); }
});

test('distinct IDs and standalone markers remain separate, starts do not establish completed bursts, input drops do not create events', async () => {
  const f = await fixture([usage('first', 0, 500), usage('drop', 1, 20, 'gpt-6-luna'), phase('item_started', 'pending', 2),
    phase('item_started', 'a', 3), phase('item_completed', 'a', 4), phase('item_completed', 'a', 4),
    phase('item_started', 'b', 5), phase('item_completed', 'b', 6), marker('compacted', 8), marker('compacted', 9)]);
  try {
    const view = analyze(f.store); assert.equal(view.compactionCount, 5); assert.equal(view.compactionMarkers, 8);
    assert.equal(view.compactions.filter(item => item.state === 'started').length, 1);
    assert.equal(view.compactions.find(item => item.itemId === 'a')!.markers, 3);
    assert.equal(view.compactions.find(item => item.itemId === 'pending')!.after, null);
    assert.equal(view.findings.find(item => item.detectorId === 'compaction-burst')!.occurrences, 4);
    assert.equal(f.store.summary().usage.total.value, '524');
    const noEvents = await fixture([usage('first', 0, 500), usage('drop', 1, 20, 'gpt-6-luna')]);
    try { assert.equal(analyze(noEvents.store).compactionCount, 0); } finally { await noEvents.close(); }
  } finally { await f.close(); }
});

test('date scopes select whole operations, unknown times stay unknown, and proxies respect model/provider boundaries', async () => {
  const f = await fixture([usage('before', 0, 1000), phase('item_started', 'cross-boundary', 1), phase('item_completed', 'cross-boundary', 2),
    usage('after', 3, 100, 'gpt-6-luna'), { type: 'compacted', payload: {} }]);
  try {
    const all = analyze(f.store); assert.equal(all.compactionUnknownTimes, 1);
    assert.ok(all.compactions[0].issues.includes('NEARBY_MODEL_CHANGED')); assert.equal(all.compactions[0].inputChange, '-900');
    const query = { from: at(2), to: at(4), provider: 'openai' };
    const scoped = analyze(f.store, query); assert.equal(scoped.compactionCount, 1); assert.equal(scoped.compactionMarkers, 2);
    assert.equal(scoped.compactions[0].startedAt, at(1)); assert.equal(scoped.compactions[0].before, null); assert.equal(scoped.compactions[0].after!.input.value, '100');
    assert.equal(analyze(f.store, { provider: 'unrelated' }).compactionCount, 0);
    assert.equal(analyze(f.store, { attributedModel: 'gpt-6-sol' }).compactions[0].after, null);
    assert.equal(analyze(f.store, { from: at(0), to: at(2) }).compactionCount, 0);
  } finally { await f.close(); }
});

test('alias linkage needs visible adjacency; intervals cannot masquerade as response input snapshots', async () => {
  const f = await fixture([marker('compacted', 1), { type: 'response_item', timestamp: at(1), payload: { type: 'message', role: 'assistant', content: [] } },
    marker('event_msg', 1), { type: 'event_msg', timestamp: at(2), payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, output_tokens: 2 } } } }]);
  try {
    const view = analyze(f.store); assert.equal(view.compactionCount, 2);
    assert.equal(view.compactions.every(item => item.before === null && item.after === null && item.overhead.value === null), true);
    assert.equal(f.store.summary().usage.total.value, '1002');
  } finally { await f.close(); }
});
