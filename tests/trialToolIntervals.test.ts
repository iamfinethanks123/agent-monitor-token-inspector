import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { trialResources } from '../src/benchmarks/resources';
import { saveContract, importTrial, experiments } from '../src/benchmarks/experiments';
import { compareTrials } from '../src/benchmarks/comparison';
import { report } from '../src/reporting/report';

const time = (second: number) => new Date(Date.UTC(2026, 9, 15, 0, 0, second)).toISOString();
const call = (id: string, second: number) => ({ type: 'response_item', timestamp: time(second), payload: { type: 'function_call', call_id: id, name: 'exec_command', arguments: '{}' } });
const output = (id: string, second: number) => ({ type: 'response_item', timestamp: time(second), payload: { type: 'function_call_output', call_id: id, output: 'Process exited with code 0' } });
const lines = (records: unknown[]) => records.map(record => JSON.stringify(record)).join('\n') + '\n';
async function fixture(run: (store: InspectorStore, collector: IndexCollector, file: string) => Promise<void>, invalidEnd = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'trial-intervals-')); const file = path.join(root, 'run.jsonl'); const store = new InspectorStore(':memory:'); const collector = new IndexCollector(store, [root]);
  try {
    await writeFile(file, lines([{ type: 'session_meta', payload: { id: 'tool-time-run', model_provider: 'openai' } }, call('a', 0), call('b', 2), output('a', 4), output('b', 6), call('c', 8), output('c', invalidEnd ? 7 : 10), call('open', 11), { type: 'token_usage_record', timestamp: time(12), payload: { thread_id: 'tool-time-run', response_id: 'one', usage: { input_tokens: 10, output_tokens: 2 } } }]));
    await collector.scan(); await run(store, collector, file);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
}

test('parallel call intervals form a union; frozen partial trials keep their timing and export it', async () => {
  await fixture(async (store, collector, file) => {
    const resources = trialResources(store, { runId: 'tool-time-run' });
    assert.equal(resources.observedWindowMs, '0');
    assert.deepEqual(resources.toolIntervals, { knownUnionMs: '8000', indexedCalls: 4, timedCalls: 3, missingCalls: 1, invalidCalls: 0, clockScope: 'single_machine', recordedComplete: false });
    const contract = saveContract(store, { runId: 'tool-time-run', objective: 'Timing snapshot', acceptance: 'User review required', environment: 'fixture' });
    const trial = importTrial(store, { id: 'timing-snapshot', contractId: contract.id, contractRevision: 1, runId: 'tool-time-run', variant: 'baseline', outcome: 'unverified', acceptanceReviewed: false, evidenceRefs: [], environment: 'fixture', cacheCondition: 'unknown', excludedReason: null });
    await appendFile(file, lines([output('open', 14)])); await collector.scan();
    assert.equal(trialResources(store, { runId: 'tool-time-run' }).toolIntervals?.knownUnionMs, '11000');
    assert.equal(trialResources(store, { runId: 'tool-time-run' }).toolIntervals?.recordedComplete, true);
    const frozen = experiments(store, contract.id); assert.deepEqual(frozen.trials[0].resources?.toolIntervals, trial.resources?.toolIntervals);
    assert.equal(frozen.variants[0].distributions.toolIntervalUnionMs.count, 0); assert.equal(frozen.variants[0].distributions.toolIntervalUnionMs.missing, 1);
    assert.equal(store.summary().usage.total.value, '12');
    assert.match(report(store, {}, 'json', { contractId: contract.id }).body, /"knownUnionMs": "8000"/);
    assert.match(report(store, {}, 'markdown', { contractId: contract.id }).body, /Recorded tool interval union: 8000 ms/);
    const csv = report(store, {}, 'csv', { contractId: contract.id, table: 'trials' }).body; assert.match(csv, /recorded_tool_union_ms/); assert.match(csv, /,"8000","4","3","1","0","false","single_machine"/);
  });
});

test('reversed call timestamps stay invalid and never become negative or inferred waiting time', async () => {
  await fixture(async store => {
    const resources = trialResources(store, { runId: 'tool-time-run' }); assert.equal(resources.toolIntervals?.knownUnionMs, '6000'); assert.equal(resources.toolIntervals?.invalidCalls, 1); assert.equal(resources.toolIntervals?.recordedComplete, false); assert.equal(store.summary().usage.total.value, '12');
  }, true);
});

test('timing distributions retain old snapshots as missing and never change token eligibility', async () => {
  await fixture(async (store, collector, file) => {
    await appendFile(file, lines([output('open', 14)])); await collector.scan();
    const contract = saveContract(store, { runId: 'tool-time-run', objective: 'Timing comparison', acceptance: 'Independent review', environment: 'fixture' });
    const trial = importTrial(store, { id: 'complete-time', contractId: contract.id, contractRevision: 1, runId: 'tool-time-run', variant: 'baseline', outcome: 'unverified', acceptanceReviewed: false, evidenceRefs: [], environment: 'fixture', cacheCondition: 'unknown', excludedReason: null });
    const old = structuredClone(trial); old.id = 'old-snapshot'; delete old.resources!.toolIntervals;
    const before = compareTrials([contract], [old]); const after = compareTrials([contract], [trial, old]);
    assert.deepEqual(after.variants[0].distributions.toolIntervalUnionMs, { count: 1, missing: 1, minimum: '11000', median: '11000', maximum: '11000' });
    assert.deepEqual(after.variants[0].reasons, before.variants[0].reasons); assert.equal(after.recommendation, null); assert.equal(old.resources?.toolIntervals, undefined);
  });
});

test('unverified cross-machine clocks do not produce a combined tool duration', async () => {
  await fixture(async (store, collector, file) => {
    await writeFile(path.join(path.dirname(file), 'other.jsonl'), lines([{ type: 'session_meta', payload: { id: 'other-clock', model_provider: 'openai' } }, call('other', 0), output('other', 1)]));
    await collector.scan(); const source = store.sources().find(source => source.threadId === 'other-clock')!; const cursor = store.getSource(source.id)!; cursor.machineId = 'other-machine';
    store.db.prepare('UPDATE sources SET machine_id=?,cursor=? WHERE id=?').run(cursor.machineId, JSON.stringify(cursor), cursor.id);
    const timing = trialResources(store, {}).toolIntervals; assert.equal(timing?.clockScope, 'unverified'); assert.equal(timing?.knownUnionMs, null); assert.equal(timing?.recordedComplete, false);
  });
});
