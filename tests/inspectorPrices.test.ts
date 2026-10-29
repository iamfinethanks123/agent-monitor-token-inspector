import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { savePrice, priceAnalytics } from '../src/accounting/prices';

test('immutable price snapshots use exact decimals, request tiers and unpriced coverage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-prices-')); const store = new InspectorStore(path.join(root, 'index.sqlite'));
  try {
    const records = [
      { type: 'session_meta', payload: { id: 'price-thread', model_provider: 'openai' } },
      { type: 'token_usage_record', timestamp: '2026-10-12T00:00:00Z', ordinal: 1, payload: { thread_id: 'price-thread', response_id: 'response-a', model: 'fixture-model', usage: { input_tokens: 12000, cached_input_tokens: 8000, output_tokens: 1000 } } },
      { type: 'token_usage_record', timestamp: '2026-10-12T00:01:00Z', ordinal: 2, payload: { thread_id: 'price-thread', response_id: 'response-b', model: 'fixture-model', usage: { input_tokens: 12000, output_tokens: 1000 } } },
    ];
    await writeFile(path.join(root, 'sample.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n'); await new IndexCollector(store, [root]).scan();
    const base = { provider: 'openai', model: 'fixture-model', serviceTier: null, currency: 'USD', sourceUrl: 'https://example.com/fixture-pricing', asOf: '2026-10-12T00:00:00Z', reviewed: true as const,
      attribution: 'observed' as const, cacheWritePolicy: 'included' as const };
    const first = savePrice(store, { ...base, effectiveAt: '2026-10-01T00:00:00Z', tiers: [{ minimumInput: '0', inputRate: '1', cachedInputRate: '0.1', outputRate: '5' }] });
    const historical = priceAnalytics(store); assert.equal(historical.currencies[0].amount, '0.009800000000'); assert.equal(historical.unpricedEntries, 1);
    const next = savePrice(store, { ...base, effectiveAt: '2026-10-12T01:00:00Z', tiers: [{ minimumInput: '0', inputRate: '2', cachedInputRate: '0.2', outputRate: '10' }] });
    assert.notEqual(first.id, next.id); assert.equal(priceAnalytics(store).currencies[0].amount, '0.009800000000');
    assert.equal(priceAnalytics(store, {}, 'current').currencies[0].amount, '0.019600000000');
    assert.equal(priceAnalytics(store).cards.length, 2); assert.equal(historical.currencies[0].amount, '0.009800000000');
    assert.throws(() => savePrice(store, { ...base, reviewed: false }), /PRICE_REVIEW_REQUIRED/);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
