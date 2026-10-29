import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, appendFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { retryProgress } from '../src/diagnostics/retry-progress';
import { analyze } from '../src/diagnostics/analyze';
import { processHandle } from '../src/accounting/tool-metadata';

const at = (second: number) => new Date(Date.UTC(2026, 9, 14, 4, 0, second)).toISOString();
const call = (id: string, second: number, name = 'exec_command', args: Record<string, unknown> = { cmd: 'npm test' }) => ({ type: 'response_item', timestamp: at(second), payload: { type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) } });
const result = (id: string, second: number, output: string) => ({ type: 'response_item', timestamp: at(second), payload: { type: 'function_call_output', call_id: id, output } });
const usage = (id: string, second: number) => ({ type: 'token_usage_record', timestamp: at(second), payload: { thread_id: 'retry-root', response_id: id, usage: { input_tokens: 10, output_tokens: 2 } } });
async function fixture(rows: unknown[], keyed = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retry-progress-')); const file = path.join(root, 'run.jsonl'); const store = new InspectorStore(path.join(root, 'index.sqlite'));
  await writeFile(file, [{ type: 'session_meta', payload: { id: 'retry-root', model_provider: 'openai' } }, ...rows].map(row => JSON.stringify(row)).join('\n') + '\n');
  const collector = new IndexCollector(store, [root], keyed ? 'synthetic-retry-key' : undefined); await collector.scan();
  return { root, file, store, collector, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('a successful comparable command resolves recurrence without declaring task acceptance or savings', async () => {
  const rows = Array.from({ length: 3 }, (_, i) => [call(`failure-${i}`, i * 3), usage(`usage-${i}`, i * 3 + 1), result(`failure-${i}`, i * 3 + 2, 'Error: expected 4, received 5\nProcess exited with code 1')]).flat();
  const f = await fixture(rows);
  try {
    let view = retryProgress(f.store, {}); assert.equal(view.episodes[0].status, 'recurring_failure'); assert.equal(view.episodes[0].attemptCount, 3); assert.equal(view.episodes[0].associatedUsage.value, '36');
    await appendFile(f.file, [call('success', 10), usage('usage-success', 11), result('success', 12, 'Process exited with code 0')].map(row => JSON.stringify(row)).join('\n') + '\n'); await f.collector.scan();
    view = retryProgress(f.store, {}); assert.equal(view.episodes[0].status, 'command_succeeded'); assert.equal(view.episodes[0].attemptCount, 4); assert.equal(view.episodes[0].failures, 3);
    assert.equal(view.episodes[0].associatedUsage.value, '48'); assert.equal(view.episodes[0].avoidableUsage.value, null); assert.equal(f.store.summary().usage.total.value, '48');
    const finding = analyze(f.store).findings.find(finding => finding.detectorId === 'retry-recurrence')!; assert.ok(finding.suppressionReasons.some(reason => reason.includes('exit code zero')));
    assert.equal(JSON.stringify(view).includes('expected 4'), false); assert.equal(JSON.stringify(view).includes('commandFingerprint'), false);
  } finally { await f.close(); }
});

test('linked process polling updates one attempt and unlinked polling cannot create a new failed execution', async () => {
  const f = await fixture([call('failure', 0), result('failure', 1, 'Error A\nProcess exited with code 1'), call('running', 2), result('running', 3, 'Process running with session ID 77'),
    call('poll-a', 4, 'write_stdin', { session_id: 77 }), result('poll-a', 5, 'Still running'), call('poll-b', 6, 'write_stdin', { session_id: 77 }), result('poll-b', 7, 'Process exited with code 0'),
    call('unlinked', 8, 'write_stdin', { session_id: 999 }), result('unlinked', 9, 'Process exited with code 1')]);
  try {
    const view = retryProgress(f.store, {}); assert.equal(view.episodes.length, 1); assert.equal(view.episodes[0].attemptCount, 2); assert.equal(view.episodes[0].polls, 2); assert.equal(view.episodes[0].status, 'command_succeeded'); assert.equal(view.unlinkedPolls, 1);
    assert.equal(view.episodes[0].attempts[1].completedAt, at(7)); assert.equal(view.episodes[0].attempts[1].exitCode, '0');
    assert.equal(processHandle('text(await tools.write_stdin({session_id: 42}));', 'input'), 'session:42'); assert.equal(processHandle('text(await tools.write_stdin({session_id: untrusted}));', 'input'), null);
    assert.equal(processHandle('text(await tools.write_stdin({session_id: 1})); text(await tools.write_stdin({session_id: 2}));', 'input'), null);
  } finally { await f.close(); }
});

test('edits and changed failures remain contextual signals; unknown signatures and time-window splits stay explicit', async () => {
  const f = await fixture([call('one', 0), result('one', 1, 'Error A\nProcess exited with code 1'), call('edit', 2, 'apply_patch', { patch: 'PRIVATE_EDIT_MARKER' }), result('edit', 3, 'Done'),
    call('two', 4), result('two', 5, 'Error B\nProcess exited with code 1'), call('later', 800), result('later', 801, 'Error B\nProcess exited with code 1')]);
  try {
    const view = retryProgress(f.store, {}); assert.equal(view.totalEpisodes, 2); assert.equal(view.episodes[0].status, 'edit_then_retry'); assert.equal(view.episodes[0].edits, 1); assert.equal(view.episodes[0].failureChanges, 1);
    assert.equal(view.episodes[1].attemptCount, 1); assert.equal(JSON.stringify(view).includes('PRIVATE_EDIT_MARKER'), false);
    assert.equal(retryProgress(f.store, { provider: 'unrelated' }).totalEpisodes, 0);
  } finally { await f.close(); }
  const noKey = await fixture([call('one', 0), result('one', 1, 'Error A\nProcess exited with code 1')], false);
  try { assert.equal(retryProgress(noKey.store, {}).episodes.length, 0); } finally { await noKey.close(); }
});

test('recurrence after an edit becomes visible again and poll-completed attempts retain resolved finding state', async () => {
  const rows: unknown[] = [call('first', 0), result('first', 1, 'Error A\nProcess exited with code 1'), call('edit', 2, 'apply_patch', { patch: 'fixture' }), result('edit', 3, 'Done')];
  for (let i = 0; i < 3; i++) rows.push(call(`async-${i}`, 4 + i * 4), result(`async-${i}`, 5 + i * 4, `Process running with session ID ${100 + i}`), call(`poll-${i}`, 6 + i * 4, 'write_stdin', { session_id: 100 + i }), result(`poll-${i}`, 7 + i * 4, 'Error A\nProcess exited with code 1'));
  const f = await fixture(rows);
  try {
    let view = retryProgress(f.store, {}); assert.equal(view.episodes[0].status, 'recurring_failure'); assert.equal(view.episodes[0].consecutiveFailures, 3); assert.equal(view.episodes[0].attemptCount, 4); assert.equal(view.episodes[0].polls, 3);
    const candidate = analyze(f.store).findings.find(item => item.detectorId === 'retry-recurrence')!; assert.ok(candidate); assert.equal(candidate.suppressionReasons.length, 0);
    await appendFile(f.file, [call('success', 20), result('success', 21, JSON.stringify({ exit_code: 0, output: 'done' }))].map(row => JSON.stringify(row)).join('\n') + '\n'); await f.collector.scan();
    view = retryProgress(f.store, {}); assert.equal(view.episodes[0].status, 'command_succeeded'); assert.equal(view.episodes[0].consecutiveFailures, 0); assert.equal(view.episodes[0].peakComparableFailures, 3);
    const resolved = analyze(f.store).findings.find(item => item.id === candidate.id)!; assert.ok(resolved.suppressionReasons.some(reason => reason.includes('exit code zero')));
  } finally { await f.close(); }
});
