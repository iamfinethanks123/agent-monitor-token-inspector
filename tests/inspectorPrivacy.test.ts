import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { addRoot, applyRetention, deleteSource, privacy, setRetention, setRoot } from '../src/storage/privacy';

test('source deletion suppresses reimport while original Codex logs remain unchanged', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-privacy-')); const store = new InspectorStore(path.join(root, 'index.sqlite'));
  try {
    const filename = path.join(root, 'sample.jsonl'); const original = [
      { type: 'session_meta', payload: { id: 'privacy-thread', model_provider: 'openai' } },
      { type: 'token_usage_record', payload: { thread_id: 'privacy-thread', response_id: 'response-privacy', usage: { input_tokens: 10, output_tokens: 2 } } },
    ].map(r => JSON.stringify(r)).join('\n') + '\n';
    await writeFile(filename, original); await addRoot(store, root); const collector = new IndexCollector(store, [root]); await collector.scan();
    assert.equal(store.summary().usage.total.value, '12');
    const source = store.sources()[0]; deleteSource(store, source.id);
    assert.equal(store.sources().length, 0); assert.equal(store.summary().selectedEntries, 0);
    assert.equal(await readFile(filename, 'utf8'), original); await collector.scan(); assert.equal(store.observationCount(), 0);
    assert.equal(privacy(store).excludedSources, 1);
    const selected = privacy(store).roots[0]; setRoot(store, { id: selected.id, enabled: false }); assert.equal(privacy(store).roots[0].enabled, false);
    setRetention(store, { eventDays: 14, usageDays: 90, rawCopies: false, textSearch: false }); assert.equal(privacy(store).retention.usageDays, 90);
    assert.throws(() => setRetention(store, { eventDays: 90, usageDays: 14, rawCopies: false, textSearch: false }), /INVALID_RETENTION/);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test('receipt retention expires old usage in an active stream without restoring its cumulative history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-retention-')); const store = new InspectorStore(path.join(root, 'index.sqlite'));
  try {
    const filename = path.join(root, 'sample.jsonl');
    const counter = (input: number) => ({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, output_tokens: input / 10, total_tokens: input + input / 10 } } } });
    await writeFile(filename, [{ type: 'session_meta', payload: { id: 'retained-thread', model_provider: 'openai' } }, counter(100), counter(200), counter(300)].map(r => JSON.stringify(r)).join('\n') + '\n');
    const collector = new IndexCollector(store, [root]); await collector.scan(); assert.equal(store.summary().usage.total.value, '330');
    store.db.prepare('UPDATE observations SET received_at=? WHERE line<=2').run('2025-01-01T00:00:00.000Z');
    applyRetention(store);
    assert.equal(store.observationCount(), 2); assert.equal(store.summary().usage.total.value, '110');
    assert.ok(store.sources()[0].issues.includes('USAGE_RETENTION_GAP'));
    await collector.scan(); assert.equal(store.observationCount(), 2); assert.equal(store.summary().usage.total.value, '110');
    await writeFile(filename, JSON.stringify(counter(400)) + '\n', { flag: 'a' }); await collector.scan();
    assert.equal(store.summary().usage.total.value, '220');
    const result = await collector.reparse(); assert.equal(result.sourcesReparsed, 1); assert.equal(store.summary().usage.total.value, '220');
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test('reparse publishes a new analysis and preserves the last valid ledger when original bytes change', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-reparse-')); const store = new InspectorStore(path.join(root, 'index.sqlite'));
  try {
    const filename = path.join(root, 'sample.jsonl'); const original = [
      { type: 'session_meta', payload: { id: 'reparse-thread', model_provider: 'openai' } },
      { type: 'token_usage_record', payload: { thread_id: 'reparse-thread', response_id: 'reparse-response', usage: { input_tokens: 10, output_tokens: 2 } } },
    ].map(r => JSON.stringify(r)).join('\n') + '\n';
    await writeFile(filename, original); const collector = new IndexCollector(store, [root]); await collector.scan();
    const oldRevision = store.revision(); const rawBefore = store.db.prepare('SELECT normalized FROM observations ORDER BY line').all();
    const result = await collector.reparse(); assert.equal(result.sourcesReparsed, 1); assert.ok(result.revision > oldRevision);
    assert.deepEqual(store.db.prepare('SELECT normalized FROM observations ORDER BY line').all(), rawBefore);
    assert.equal(store.summary().usage.total.value, '12'); assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM observation_analyses').get()!.n, 2);
    await writeFile(filename, original.replace('input_tokens":10', 'input_tokens":99'));
    const bad = await collector.reparse(); assert.equal(bad.sourcesReparsed, 0); assert.equal(bad.unavailable[0].reason, 'SOURCE_CHANGED_DURING_REPARSE');
    assert.equal(store.revision(), result.revision); assert.equal(store.summary().usage.total.value, '12');
    deleteSource(store, store.sources()[0].id); assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM observation_analyses').get()!.n, 0);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
