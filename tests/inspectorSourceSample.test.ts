import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectSourceSample, SAMPLE_MAX_BYTES, SAMPLE_MAX_RECORDS } from '../src/collector/source-sample';
import type { SampleCapability, SourceSampleReport } from '../src/shared/inspector';

const header = { type: 'session_meta', payload: { id: 'sample-thread', model_provider: 'openai', model: 'gpt-6-sol', cli_version: '0.162.0-alpha.17.2' } };
const lines = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const cap = (report: SourceSampleReport, id: SampleCapability) => report.capabilities.find(item => item.id === id)!;
async function fixture(body: string | Buffer, run: (file: string, root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-sample-')); const file = path.join(root, 'fixture.jsonl');
  try { await writeFile(file, body); await run(file, root); } finally { await chmod(file, 0o600).catch(() => {}); await rm(root, { recursive: true, force: true }); }
}
test('legacy counters are usable partial evidence; absent cache/response identity is not invented and no content is returned', async () => {
  const body = lines([header, { timestamp: '2026-10-14T00:00:00Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 0 } }, private_content: 'PRIVATE_MARKER' } }]);
  await fixture(body, async file => {
    const report = await inspectSourceSample(file); assert.equal(report.state, 'partial'); assert.equal(report.records, 2);
    assert.equal(cap(report, 'usage_snapshots').usableRecords, 1); assert.equal(cap(report, 'output').usableRecords, 1);
    assert.equal(cap(report, 'response_identity').state, 'not_observed'); assert.equal(cap(report, 'cached_input').state, 'not_observed');
    assert.deepEqual(report.runtimeVersions, ['0.162.0-alpha.17.2']); assert.equal(report.runtimeUnknown, false);
    assert(!JSON.stringify(report).includes('PRIVATE_MARKER')); assert(!JSON.stringify(report).includes(file));
    assert(!('total' in report)); assert.equal(await readFile(file, 'utf8'), body);
  });
});
test('richer responses expose independent fields; tool matching respects thread scope and rejects repeated ambiguous IDs', async () => {
  await fixture(lines([header,
    { timestamp: '2026-10-14T00:00:01Z', type: 'token_usage_record', payload: { thread_id: 'sample-thread', response_id: 'sample-response', usage: { input_tokens: 10, cached_input_tokens: 8, output_tokens: 4, reasoning_output_tokens: 2 } } },
    { type: 'response_item', payload: { type: 'function_call', call_id: 'same-id', name: 'exec_command', arguments: 'PRIVATE_COMMAND' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'same-id', output: 'PRIVATE_OUTPUT' } },
    { type: 'compacted', payload: {} },
  ]), async file => {
    const report = await inspectSourceSample(file); assert.equal(report.state, 'ready');
    for (const id of ['response_identity','input','output','cached_input','reasoning_output','compaction'] as const) assert.equal(cap(report, id).usableRecords, 1);
    assert.equal(cap(report, 'context_manifests').state, 'unsupported'); assert.equal(report.toolPairing.matched, 1);
    assert(!JSON.stringify(report).includes('PRIVATE_')); assert(!JSON.stringify(report).includes('sample-response'));
  });
  await fixture(lines([header,
    { type: 'response_item', payload: { type: 'function_call', call_id: 'same-id' } },
    { ...header, payload: { ...header.payload, id: 'different-thread' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'same-id', output: 'private' } },
    { type: 'response_item', payload: { type: 'function_call', call_id: 'repeated' } },
    { type: 'response_item', payload: { type: 'function_call', call_id: 'repeated' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'repeated' } },
  ]), async file => { const report = await inspectSourceSample(file); assert.equal(report.toolPairing.matched, 0); assert.equal(cap(report, 'tool_pairing').state, 'partial'); });
});
test('unknown formats, malformed values, record/prefix bounds and incomplete UTF-8 tails are explicit', async () => {
  await fixture(lines([{ type: 'unknown_usage', payload: { input_tokens: 9999, output_tokens: 9999 } }]), async file => { const report = await inspectSourceSample(file); assert.equal(report.state, 'unsupported'); assert.equal(report.unsupportedRecords, 1); assert.equal(cap(report, 'usage_snapshots').state, 'not_observed'); });
  await fixture(lines([header, { type: 'token_usage_record', payload: { thread_id: 'sample-thread', response_id: 'bad', usage: { input_tokens: 10, cached_input_tokens: 11, output_tokens: 2 } } }]) + 'invalid JSON\n', async file => { const report = await inspectSourceSample(file); assert.equal(report.state, 'partial'); assert.equal(report.invalidRecords, 2); assert.equal(cap(report, 'input').state, 'invalid'); });
  await fixture(lines([header, ...Array.from({ length: SAMPLE_MAX_RECORDS }, () => ({ type: 'event_msg', payload: { type: 'agent_message' } }))]), async file => { const report = await inspectSourceSample(file); assert.equal(report.records, SAMPLE_MAX_RECORDS); assert(report.limited); });
  await fixture(Buffer.concat([Buffer.from(lines([header])), Buffer.alloc(SAMPLE_MAX_BYTES, 120), Buffer.from([0xc3])]), async file => { const report = await inspectSourceSample(file); assert.equal(report.sampledBytes, SAMPLE_MAX_BYTES); assert(report.limited); assert(report.pendingTailBytes > 0); assert.equal(report.invalidRecords, 0); });
  await fixture(lines([header]) + 'x'.repeat(2 * 1024 * 1024 + 1) + '\n', async file => { const report = await inspectSourceSample(file); assert.equal(report.oversizedRecords, 1); assert.equal(report.state, 'partial'); });
});
test('denied/missing/non-trace/symlink inputs do not crash or expose source paths', async () => {
  await fixture(lines([header]), async (file, root) => {
    const link = path.join(root, 'link.jsonl'); await symlink(file, link); assert.equal((await inspectSourceSample(link)).state, 'unavailable');
    assert.equal((await inspectSourceSample(path.join(root, 'missing.jsonl'))).state, 'unavailable');
    assert.deepEqual((await inspectSourceSample(path.join(root, 'credential.key'))).reasons, ['JSONL_REQUIRED']);
    if (process.getuid?.() !== 0 && process.platform !== 'win32') { await chmod(file, 0); const denied = await inspectSourceSample(file); assert.equal(denied.state, 'permission_denied'); assert(!JSON.stringify(denied).includes(file)); await chmod(file, 0o600); }
  });
});
