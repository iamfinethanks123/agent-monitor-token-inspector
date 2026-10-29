import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { timeline } from '../src/storage/timeline';
import { timelineInvestigations } from '../src/diagnostics/timeline-investigations';
import { deleteSource } from '../src/storage/privacy';

const at = (second: number) => new Date(Date.UTC(2026, 9, 14, 6, 0, second)).toISOString();
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'timeline-investigations-')); const file = path.join(root, 'root.jsonl'); const store = new InspectorStore(path.join(root, 'index.sqlite'));
  const records: unknown[] = [{ type: 'session_meta', payload: { id: 'investigation-root', model_provider: 'openai', model: 'gpt-6-sol' } }];
  for (let i = 0; i < 3; i++) records.push({ type: 'response_item', timestamp: at(i * 3), payload: { type: 'function_call', call_id: `call-${i}`, name: 'exec_command', arguments: JSON.stringify({ cmd: 'npm test' }) } },
    { type: 'token_usage_record', timestamp: at(i * 3 + 1), payload: { thread_id: 'investigation-root', response_id: `response-${i}`, usage: { input_tokens: 10, output_tokens: 2 } } },
    { type: 'response_item', timestamp: at(i * 3 + 2), payload: { type: 'function_call_output', call_id: `call-${i}`, output: 'Error: fixture\nProcess exited with code 1' } });
  records.push({ type: 'compacted', timestamp: at(10), payload: {} }, { type: 'response_item', timestamp: at(11), payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'PRIVATE_MARKER_TEXT' }] } });
  await writeFile(file, records.map(record => JSON.stringify(record)).join('\n') + '\ninvalid JSON\n'); const collector = new IndexCollector(store, [root], 'fixture-investigation-key'); await collector.scan();
  return { root, file, store, collector, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('exclusive category counts cover the full snapshot and category cursors remain scope-bound', async () => {
  const f = await fixture();
  try {
    const all = timeline(f.store); assert.equal(all.laneCounts.reduce((sum, item) => sum + item.events, 0), all.matchedEvents);
    assert.equal(all.laneCounts.find(item => item.lane === 'errors')!.events, 3); assert.equal(all.laneCounts.find(item => item.lane === 'usage')!.events, 3); assert.equal(all.laneCounts.find(item => item.lane === 'gaps')!.events, 1);
    const first = timeline(f.store, { lane: 'usage', limit: 1 }); assert.equal(first.items[0].lane, 'usage'); assert.equal(first.matchedEvents, 3); assert.ok(first.laneCounts.some(item => item.lane === 'tools'));
    await appendFile(f.file, JSON.stringify({ type: 'token_usage_record', timestamp: at(12), payload: { thread_id: 'investigation-root', response_id: 'appended', usage: { input_tokens: 20, output_tokens: 2 } } }) + '\n'); await f.collector.scan();
    const next = timeline(f.store, { lane: 'usage', limit: 1, cursor: first.nextCursor! }); assert.equal(next.matchedEvents, 3);
    assert.throws(() => timeline(f.store, { lane: 'errors', limit: 1, cursor: first.nextCursor! }), /INVALID_CURSOR/);
    assert.equal(f.store.summary().usage.total.value, '58'); assert.throws(() => timeline(f.store, { lane: 'invalid' }), /INVALID_TIMELINE_QUERY/);
  } finally { await f.close(); }
});

test('current finding/compaction/retry markers use retained source anchors and gaps preserve unknown time', async () => {
  const f = await fixture();
  try {
    const view = timelineInvestigations(f.store); assert.ok(view.markers.some(marker => marker.kind === 'finding')); assert.ok(view.markers.some(marker => marker.kind === 'retry')); assert.ok(view.markers.some(marker => marker.kind === 'compaction'));
    const gap = view.markers.find(marker => marker.kind === 'gap')!; assert.equal(gap.timestamp, null); assert.equal(gap.timeBasis, 'unknown');
    assert.equal(JSON.stringify(view).includes('PRIVATE_MARKER_TEXT'), false); assert.equal(f.store.summary().usage.total.value, '36');
    for (const marker of view.markers) assert.equal(timeline(f.store, { evidenceRef: marker.evidenceRef }).matchedEvents, 1);
    assert.equal(timelineInvestigations(f.store, { provider: 'unrelated' }).markers.length, 0);
    const bounded = timelineInvestigations(f.store, { from: at(0), to: at(11) }); assert.equal(bounded.markers.some(marker => marker.kind === 'gap'), false);
    deleteSource(f.store, f.store.sources()[0].id); assert.equal(timelineInvestigations(f.store).markers.length, 0); assert.equal(f.store.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { await f.close(); }
});
