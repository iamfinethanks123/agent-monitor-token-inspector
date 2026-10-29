import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AUTOMATIC_USD_PRICE, automaticEntryUsd } from '../src/accounting/automatic-usd';
import { components, metric } from '../src/accounting/integers';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { manualUsd, setManualUsdPrice, clearManualUsdPrice } from '../src/accounting/manual-usd';
import { timeCharts } from '../src/accounting/time-charts';
import { report } from '../src/reporting/report';
import type { LedgerEntry } from '../src/shared/inspector';

function response(input = '100', cache: string | null = '80', writes: string | null = '10'): LedgerEntry {
  return { id: 'fixture', revision: 1, scopeId: 'scope:fixture', identity: { workspaceId: 'fixture', originMachineId: 'fixture', projectId: null, runId: 'fixture', agentId: null, provider: 'openai', threadId: 'fixture', sessionId: null, rootTurnId: null, turnId: null, responseId: 'fixture' },
    grain: 'response', startAt: null, endAt: '2026-10-13T00:00:00Z', model: { requestedModel: 'gpt-6-astra', observedModel: 'gpt-6.1-sol', providerRoute: 'openai', serviceTier: 'standard', quotaAlias: null, provenance: 'observed', evidenceRefs: [] },
    usage: components({ input, cachedInput: cache, cacheWriteInput: writes, output: '20', reasoningOutput: '10', total: (BigInt(input) + 20n).toString() }, 'observed', 'provider_response', []), nativeTotal: metric(null, 'unknown', 'unknown'), evidenceRefs: [], evidenceCount: 1, controlObservationRefs: [], selectionStatus: 'selected', reconciliation: 'matched', issues: [], coverage: { fromSequence: null, toSequence: null, excludesResponses: false, priorHistory: false }, policyVersion: 'fixture' };
}

test('official per-model rates use disjoint cache partitions and never add reasoning twice', () => {
  const sol = response(); const exact = automaticEntryUsd(sol, AUTOMATIC_USD_PRICE);
  assert.deepEqual(exact, { lower: 253000000n, upper: 253000000n, assumptions: [] });
  sol.usage.reasoningOutput.value = '20'; assert.deepEqual(automaticEntryUsd(sol, AUTOMATIC_USD_PRICE), exact);
  sol.model.observedModel = 'gpt-6-astra'; assert.deepEqual(automaticEntryUsd(sol, AUTOMATIC_USD_PRICE), { lower: 1305000000n, upper: 1305000000n, assumptions: [] });
  sol.model.serviceTier = 'fast'; assert.deepEqual(automaticEntryUsd(sol, AUTOMATIC_USD_PRICE), { lower: 2610000000n, upper: 2610000000n, assumptions: [] });
});

test('unknown cache quantities produce bounds; unknown models, providers and tiers stay unpriced', () => {
  assert.deepEqual(automaticEntryUsd(response('100', '80', null), AUTOMATIC_USD_PRICE), { lower: 248000000n, upper: 258000000n, assumptions: ['CACHE_WRITE_RANGE'] });
  assert.deepEqual(automaticEntryUsd(response('100', null, '0'), AUTOMATIC_USD_PRICE), { lower: 210000000n, upper: 400000000n, assumptions: ['CACHE_READ_RANGE'] });
  assert.deepEqual(automaticEntryUsd(response('100', null, null), AUTOMATIC_USD_PRICE), { lower: 210000000n, upper: 450000000n, assumptions: ['CACHE_READ_RANGE', 'CACHE_WRITE_RANGE'] });
  assert.deepEqual(automaticEntryUsd(response('100', '80', '30'), AUTOMATIC_USD_PRICE), { reason: 'INVALID_CACHE_PARTITIONS' });
  const unknown = response(); unknown.model.observedModel = 'codex-auto-review'; assert.deepEqual(automaticEntryUsd(unknown, AUTOMATIC_USD_PRICE), { reason: 'NO_OFFICIAL_MODEL_PRICE' });
  unknown.model.observedModel = 'gpt-6.1-sol'; unknown.model.providerRoute = 'proxy'; assert.deepEqual(automaticEntryUsd(unknown, AUTOMATIC_USD_PRICE), { reason: 'UNSUPPORTED_PROVIDER' });
  unknown.model.providerRoute = 'openai'; unknown.model.serviceTier = 'custom'; assert.deepEqual(automaticEntryUsd(unknown, AUTOMATIC_USD_PRICE), { reason: 'UNSUPPORTED_SERVICE_TIER' });
  unknown.model.serviceTier = null; unknown.model.observedModel = null; unknown.model.requestedModel = 'gpt-6.1-sol';
  assert.deepEqual(automaticEntryUsd(unknown, AUTOMATIC_USD_PRICE), { lower: 253000000n, upper: 253000000n, assumptions: ['REQUESTED_MODEL', 'STANDARD_TIER_ASSUMED'] });
  unknown.usage.input.value = null; assert.deepEqual(automaticEntryUsd(unknown, AUTOMATIC_USD_PRICE), { reason: 'MISSING_INPUT_OR_OUTPUT' });
});

test('context boundary uses individual responses; multi-response intervals remain bounded', () => {
  const short = response('272000', '0', '0'); short.usage.output.value = '2';
  assert.deepEqual(automaticEntryUsd(short, AUTOMATIC_USD_PRICE), { lower: 544020000000n, upper: 544020000000n, assumptions: [] });
  const long = response('272001', '0', '0'); long.usage.output.value = '2';
  assert.deepEqual(automaticEntryUsd(long, AUTOMATIC_USD_PRICE), { lower: 1088034000000n, upper: 1088034000000n, assumptions: [] });
  long.grain = 'interval'; assert.deepEqual(automaticEntryUsd(long, AUTOMATIC_USD_PRICE), { lower: 544022000000n, upper: 1088034000000n, assumptions: ['CONTEXT_TIER_RANGE'] });
  const huge = response('9007199254740993', '0', '0'); huge.usage.output.value = '0';
  assert.deepEqual(automaticEntryUsd(huge, AUTOMATIC_USD_PRICE), { lower: 36028797018963972000000n, upper: 36028797018963972000000n, assumptions: [] });
});

test('mixed model defaults reconcile dashboard, chart ranges and immutable report snapshots', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-auto-usd-')); const store = new InspectorStore(':memory:'); const now = Date.now();
  try {
    const usage = (model: string, id: string, writes: number | null) => ({ type: 'token_usage_record', timestamp: new Date(now - 1000).toISOString(), payload: { thread_id: 'auto-usd', response_id: id, model, service_tier: 'standard', usage: { input_tokens: 100, cached_input_tokens: 80, ...(writes === null ? {} : { cache_write_input_tokens: writes }), output_tokens: 20, reasoning_output_tokens: 10 } } });
    await writeFile(path.join(root, 'run.jsonl'), [{ type: 'session_meta', payload: { id: 'auto-usd', model_provider: 'openai' } }, usage('gpt-6.1-sol', 'sol', 10), usage('gpt-6-astra', 'astra', 10), usage('gpt-6.1-sol', 'range', null), usage('codex-auto-review', 'unknown', 0)].map(row => JSON.stringify(row)).join('\n') + '\n');
    await new IndexCollector(store, [root]).scan();
    const view = manualUsd(store); assert.equal(view.price?.mode, 'automatic'); assert.equal(view.amount, '0.001806000000'); assert.equal(view.upperAmount, '0.001816000000'); assert.equal(view.pricedEntries, 3); assert.equal(view.unpricedEntries, 1); assert.equal(view.complete, false);
    const chart = timeCharts(store, {}, 1, 1, now); assert.equal(chart.timedUsdUnits, BigInt(view.amount.replace('.', '')).toString()); assert.equal(chart.timedUsdUpperUnits, BigInt(view.upperAmount.replace('.', '')).toString()); assert.equal(chart.usdUnpricedEntries, 1);
    assert.equal(manualUsd(store, { attributedModel: 'gpt-6.1-sol' }).amount, '0.000501000000'); assert.equal(store.ledger({ attributedModel: 'gpt-6.1-sol' }).items.length, 2);
    assert.equal(chart.machines[0].usdUpperUnits, chart.timedUsdUpperUnits); assert.equal(chart.models.find(group => group.id === 'gpt-6.1-sol')?.usdUnits, '501000000'); assert.equal(chart.models.find(group => group.id === 'codex-auto-review')?.usdUnits, null);
    const frozen = report(store, {}, 'json').body; assert.equal(JSON.parse(frozen).manualUsdEstimate.price.catalog.length, 7);
    setManualUsdPrice(store, { mode: 'uniform', uniformRate: '1' }); assert.equal(manualUsd(store).amount, '0.000480000000'); assert.equal(JSON.parse(frozen).manualUsdEstimate.amount, view.amount);
    clearManualUsdPrice(store); assert.equal(manualUsd(store).price, null); setManualUsdPrice(store, { mode: 'automatic' }); assert.equal(manualUsd(store).price?.id, view.price?.id);
    const md = report(store, {}, 'markdown').body; assert.ok(md.includes('CACHE_WRITE_RANGE')); assert.ok(md.includes('https://developers.openai.com/api/docs/models/gpt-6.1-sol')); assert.ok(md.includes('Current official API-equivalent'));
    assert.equal(store.summary().usage.total.value, '480');
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
