import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { manualUsd, setManualUsdPrice, clearManualUsdPrice } from '../src/accounting/manual-usd';
import { timeCharts } from '../src/accounting/time-charts';
import { report } from '../src/reporting/report';

async function fixture(large = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-usd-')); const store = new InspectorStore(':memory:'); const now = Date.now();
  const records = [{ type: 'session_meta', payload: { id: 'usd-run', model_provider: 'openai' } },
    { type: 'token_usage_record', timestamp: new Date(now - 1000).toISOString(), payload: { thread_id: 'usd-run', response_id: 'first', usage: { input_tokens: large ? '9007199254740993' : '100', cached_input_tokens: large ? '0' : '80', output_tokens: large ? '2' : '20', reasoning_output_tokens: large ? '1' : '10' } } },
    ...(!large ? [{ type: 'token_usage_record', timestamp: new Date(now - 500).toISOString(), payload: { thread_id: 'usd-run', response_id: 'second', usage: { input_tokens: '50', output_tokens: '10' } } }] : [])];
  await writeFile(path.join(root, 'run.jsonl'), records.map(row => JSON.stringify(row)).join('\n') + '\n'); await new IndexCollector(store, [root]).scan();
  return { root, store, now, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('uniform/component USD scenarios preserve subsets, unknowns and immutable report prices', async () => {
  const f = await fixture();
  try {
    const empty = manualUsd(f.store); assert.equal(empty.amount, null); assert.equal(empty.unpricedEntries, 2);
    const first = setManualUsdPrice(f.store, { mode: 'uniform', uniformRate: '1.25' }); assert.equal(manualUsd(f.store).amount, '0.000225000000');
    const frozen = report(f.store, {}, 'json').body; const archived = JSON.parse(frozen); assert.equal(archived.manualUsdEstimate.price.id, first.id);
    setManualUsdPrice(f.store, { mode: 'components', inputRate: '3', cachedInputRate: '0.5', outputRate: '10' });
    const components = manualUsd(f.store); assert.equal(components.amount, '0.000300000000'); assert.equal(components.pricedEntries, 1); assert.equal(components.unpricedEntries, 1); assert.equal(components.complete, false);
    assert.equal(JSON.parse(frozen).manualUsdEstimate.amount, '0.000225000000'); assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM manual_usd_prices').get()!.n, 2);
    const chart = timeCharts(f.store, {}, 1, 1, f.now); assert.equal(chart.timedUsdUnits, '300000000'); assert.equal(chart.usdUnpricedEntries, 1); assert.equal(chart.buckets[0].usdUnits, '300000000'); assert.equal(chart.machines[0].usdUnits, chart.timedUsdUnits);
    assert.equal(f.store.summary().usage.total.value, '180'); clearManualUsdPrice(f.store); assert.equal(manualUsd(f.store).amount, null); assert.equal(f.store.summary().usage.total.value, '180');
  } finally { await f.close(); }
});

test('equal input/cache rates are comparable without fabricating missing cache amounts', async () => {
  const f = await fixture();
  try {
    setManualUsdPrice(f.store, { mode: 'components', inputRate: '1', cachedInputRate: '1', outputRate: '2' });
    const view = manualUsd(f.store); assert.equal(view.amount, '0.000210000000'); assert.equal(view.complete, true);
    assert.throws(() => setManualUsdPrice(f.store, { mode: 'uniform', uniformRate: '1e3' }), /INVALID_USD_RATE/);
    assert.throws(() => setManualUsdPrice(f.store, { mode: 'components', inputRate: '1', cachedInputRate: '-1', outputRate: '2' }), /INVALID_USD_RATE/);
  } finally { await f.close(); }
});

test('USD calculations above the JavaScript safe integer limit remain exact', async () => {
  const f = await fixture(true);
  try { setManualUsdPrice(f.store, { mode: 'uniform', uniformRate: '2' }); assert.equal(manualUsd(f.store).amount, '18014398509.481990000000'); }
  finally { await f.close(); }
});
