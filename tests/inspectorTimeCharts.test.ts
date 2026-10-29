import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { timeCharts } from '../src/accounting/time-charts';

test('minute/day buckets reconcile exact response totals, subset coverage and shared filters', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-time-charts-')); const store = new InspectorStore(':memory:'); const now = Date.parse('2026-10-13T08:00:00Z');
  try {
    const header = { type: 'session_meta', payload: { id: 'chart-run', model_provider: 'openai', cwd: '/PRIVATE_CHART_PROJECT' } };
    const usage = (id: string, at: number, input: string, cache?: number, reasoning?: number) => ({ type: 'token_usage_record', timestamp: new Date(at).toISOString(), payload: { thread_id: 'chart-run', response_id: id, usage: { input_tokens: input, output_tokens: 2, ...(cache === undefined ? {} : { cached_input_tokens: cache }), ...(reasoning === undefined ? {} : { reasoning_output_tokens: reasoning }) } } });
    await writeFile(path.join(root, 'run.jsonl'), [header, { type: 'turn_context', payload: { model: 'gpt-chart', turn_id: 'chart-turn' } }, usage('first', now - 90000, '9007199254740993', 10, 1), usage('second', now - 30000, '10'), usage('outside', now - 2 * 86400000, '100', 10, 1)].map(row => JSON.stringify(row)).join('\n') + '\n');
    await new IndexCollector(store, [root]).scan();
    const day = timeCharts(store, { runId: 'chart-run' }, 1440, 1, now); assert.equal(day.buckets.length, 1440); assert.equal(day.timedKnownTotal, '9007199254741007');
    assert.equal(day.buckets.reduce((sum, bucket) => sum + BigInt(bucket.total ?? '0'), 0n).toString(), day.timedKnownTotal);
    assert.equal(day.buckets.at(-2)!.cacheCoveredInput, '9007199254740993'); assert.equal(day.buckets.at(-2)!.cacheCoveredCached, '10');
    assert.equal(day.buckets.at(-1)!.cachedInput, null); assert.equal(day.buckets.at(-1)!.knownUncachedInput, '0'); assert.ok(day.buckets.at(-1)!.partialFields.includes('cachedInput'));
    assert.equal(day.machines[0].total, day.timedKnownTotal); assert.equal(day.models[0].total, day.timedKnownTotal); assert.equal(day.projects[0].total, day.timedKnownTotal);
    const minute = timeCharts(store, { runId: 'chart-run' }, 1, 1, now); assert.equal(minute.buckets.length, 1); assert.equal(minute.timedKnownTotal, '12');
    const daily = timeCharts(store, { runId: 'chart-run' }, 1440, 1440, now); assert.equal(daily.buckets.length, 1); assert.equal(daily.timedKnownTotal, day.timedKnownTotal);
    assert.equal(timeCharts(store, { requestedModel: 'not-this-model' }, 1440, 1, now).timedKnownTotal, '0');
    assert.equal(timeCharts(store, { machineId: 'not-this-machine' }, 1440, 1, now).machines.length, 0);
    assert.equal(JSON.stringify(day).includes('PRIVATE_CHART_PROJECT'), false);
    assert.throws(() => timeCharts(store, {}, 1, 1440, now), /INVALID_CHART_TIME/); assert.throws(() => timeCharts(store, {}, '1', 1, now), /INVALID_CHART_TIME/);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test('untimed cumulative history stays outside minute charts and intervals are not response counts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-chart-intervals-')); const store = new InspectorStore(':memory:'); const now = Date.parse('2026-10-13T08:00:00Z');
  try {
    const counter = (value: number, timestamp?: string) => ({ type: 'event_msg', ...(timestamp ? { timestamp } : {}), payload: { type: 'token_count', info: { total_token_usage: { input_tokens: value, output_tokens: 0 } } } });
    await writeFile(path.join(root, 'run.jsonl'), [{ type: 'session_meta', payload: { id: 'interval-run', model_provider: 'openai' } }, counter(100), counter(150, new Date(now - 30000).toISOString())].map(row => JSON.stringify(row)).join('\n') + '\n');
    await new IndexCollector(store, [root]).scan(); const result = timeCharts(store, {}, 1, 1, now);
    assert.equal(result.untimedKnownTotal, '100'); assert.equal(result.timedKnownTotal, '50'); assert.equal(result.buckets[0].responseEntries, 0); assert.equal(result.buckets[0].intervalEntries, 1);
    assert.equal(result.buckets[0].responseTotal, '0'); assert.ok(result.notes[0].includes('recorded end'));
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
