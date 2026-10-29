import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { analyze, toolsPage } from '../src/diagnostics/analyze';
import { quotas } from '../src/storage/quotas';
import { literalCommand } from '../src/accounting/tool-metadata';

test('wrapped reads and timing-varying failures link to a non-duplicated ledger union', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-diagnostics-')); const store = new InspectorStore(path.join(root, 'index.sqlite'));
  try {
    const records: unknown[] = [{ type: 'session_meta', payload: { id: 'diagnostics-thread', model_provider: 'openai' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Inspect the project.' }] } }];
    for (let i = 0; i < 6; i++) {
      const read = i % 2 === 0; const at = new Date(Date.UTC(2026, 9, 13, 0, 0, i)); const callId = `call-${i}`;
      records.push({ type: 'response_item', timestamp: at.toISOString(), payload: { type: 'function_call', call_id: callId, name: 'functions.exec', arguments: `text(await tools.exec_command(${JSON.stringify({ cmd: read ? 'cat source.ts' : 'npm test' })}));` } },
        { type: 'token_usage_record', timestamp: at.toISOString(), payload: { thread_id: 'diagnostics-thread', response_id: `response-${i}`, usage: { input_tokens: 10, output_tokens: 2 } } },
        { type: 'response_item', timestamp: new Date(at.getTime() + 100).toISOString(), payload: { type: 'function_call_output', call_id: callId, output: read ? 'a'.repeat(10000) : `Wall time: ${i}.123 seconds\nError: Expected value 4, received 5\nProcess exited with code 1` } });
    }
    await writeFile(path.join(root, 'sample.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n');
    const collector = new IndexCollector(store, [root], 'local-fixture-fingerprint-key'); await collector.scan();
    const result = analyze(store); assert.equal(result.findings.length, 2);
    assert.equal(result.findings.find(f => f.detectorId === 'repeated-read')!.associatedUsage.value, '60');
    assert.equal(result.findings.find(f => f.detectorId === 'retry-recurrence')!.associatedUsage.value, '60');
    assert.equal(result.associatedUnionUsage.value, '72'); assert.equal(store.summary().usage.total.value, '72');
    assert.equal(result.findings.every(f => f.avoidableTokens.value === null), true);
    assert.equal(result.context.find(c => c.origin === 'project_file')!.occurrences, 3);
    assert.equal(result.context.find(c => c.origin === 'user_prompt')!.occurrences, 1);
    assert.equal(literalCommand('text(await tools.exec_command({cmd: "cat " + untrustedPath}));'), null);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test('passive quota preserves source windows and missing values, with account totals unavailable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-quotas-')); const store = new InspectorStore(path.join(root, 'index.sqlite'));
  try {
    await writeFile(path.join(root, 'sample.jsonl'), [
      { type: 'session_meta', payload: { id: 'quota-thread', model_provider: 'openai' } },
      { type: 'event_msg', timestamp: '2026-10-13T00:00:00Z', payload: { type: 'token_count', rate_limits: { limit_id: 'codex', primary: { used_percent: 12.345, window_minutes: 270, resets_at: 1791858000 }, secondary: { used_percent: 2, window_minutes: null, resets_at: null }, credits: { balance: 'SECRET_MARKER' } } } },
    ].map(record => JSON.stringify(record)).join('\n') + '\n');
    const collector = new IndexCollector(store, [root]); await collector.scan(); const view = quotas(store);
    assert.equal(view.state, 'available'); assert.equal(view.snapshots[0].primary!.windowMinutes, '270'); assert.equal(view.snapshots[0].primary!.usedPercent, '12.345');
    assert.equal(view.snapshots[0].secondary!.windowMinutes, null); assert.equal(view.snapshots[0].secondary!.resetsAt, null);
    assert.equal(view.accountTotal.value, null); assert.equal(view.reconciliationGap.value, null);
    assert.equal(JSON.stringify(view).includes('SECRET_MARKER'), false); assert.equal(JSON.stringify(store.db.prepare('SELECT normalized FROM observations').all()).includes('SECRET_MARKER'), false);
    assert.equal(quotas(store, { machineId: 'another-device' }).state, 'unavailable');
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});


test('tool paging reaches every indexed call and rejects changed or mismatched cursors', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-tool-pages-')); const store = new InspectorStore(':memory:');
  try {
    const records: unknown[] = [{ type: 'session_meta', payload: { id: 'tool-page-thread', model_provider: 'openai' } }];
    for (let i = 0; i < 215; i++) records.push({ type: 'response_item', payload: { type: 'function_call', call_id: `call-${i}`, name: 'exec_command', arguments: JSON.stringify({ cmd: 'npm test' }) } });
    const source = path.join(root, 'sample.jsonl'); await writeFile(source, records.map(record => JSON.stringify(record)).join('\n') + '\n');
    const collector = new IndexCollector(store, [root]); await collector.scan();
    const first = toolsPage(store); assert.equal(first.items.length, 200); assert.ok(first.nextCursor);
    const last = toolsPage(store, { cursor: first.nextCursor! }); assert.equal(last.items.length, 15); assert.equal(last.nextCursor, null);
    assert.equal(new Set([...first.items, ...last.items].map(item => item.id)).size, 215);
    assert.throws(() => toolsPage(store, { cursor: first.nextCursor!, runId: 'another-thread' }), /INVALID_CURSOR/);
    const { appendFile } = await import('node:fs/promises');
    await appendFile(source, JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-1', output: 'finished' } }) + '\n');
    await collector.scan(); assert.throws(() => toolsPage(store, { cursor: first.nextCursor! }), /REVISION_CHANGED/);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
