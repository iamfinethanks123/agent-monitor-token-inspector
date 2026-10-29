import { digest } from './codex-observations';
import { AUTOMATIC_USD_DEFINITION as definition } from '../shared/automatic-usd-prices';
import type { LedgerEntry, ManualUsdPrice } from '../shared/inspector';

export const AUTOMATIC_USD_PRICE: ManualUsdPrice = { id: `usd:official:${digest(JSON.stringify(definition))}`, ...definition };
export const scaledRate = (value: string) => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0')); };
export type UsdEntryEstimate = { lower: bigint; upper: bigint; assumptions: string[] } | { reason: string };

export function automaticEntryUsd(entry: LedgerEntry, price: ManualUsdPrice): UsdEntryEstimate {
  if (entry.grain === 'aggregate') return { reason: 'AGGREGATE_MODEL_UNVERIFIED' };
  if (entry.model.providerRoute && entry.model.providerRoute !== 'openai') return { reason: 'UNSUPPORTED_PROVIDER' };
  const model = entry.model.observedModel ?? entry.model.requestedModel;
  const card = price.catalog?.find(card => card.model === model);
  if (!card) return { reason: 'NO_OFFICIAL_MODEL_PRICE' };
  const input = entry.usage.input.value; const output = entry.usage.output.value;
  if (input === null || output === null) return { reason: 'MISSING_INPUT_OR_OUTPUT' };
  const assumptions: string[] = [];
  if (!entry.model.observedModel) assumptions.push('REQUESTED_MODEL');
  if (!entry.model.providerRoute) assumptions.push('OPENAI_ROUTE_ASSUMED');
  const serviceTier = entry.model.serviceTier;
  const multiplier = serviceTier === null || serviceTier === 'auto' ? '1' : card.serviceMultipliers[serviceTier];
  if (!multiplier) return { reason: 'UNSUPPORTED_SERVICE_TIER' };
  if (serviceTier === null || serviceTier === 'auto') assumptions.push('STANDARD_TIER_ASSUMED');
  const i = BigInt(input); const o = BigInt(output);
  const cached = entry.usage.cachedInput.value; const writes = entry.usage.cacheWriteInput.value;
  const wMin = writes === null ? 0n : BigInt(writes);
  const cMin = cached === null ? 0n : BigInt(cached);
  if (cMin + wMin > i) return { reason: 'INVALID_CACHE_PARTITIONS' };
  const cMax = cached === null ? i - wMin : cMin;
  const wMax = writes === null ? i - cMin : wMin;
  if (cached === null && i > 0n) assumptions.push('CACHE_READ_RANGE');
  if (writes === null && i > cMin) assumptions.push('CACHE_WRITE_RANGE');
  const pi = scaledRate(card.inputRate); const pc = scaledRate(card.cachedInputRate); const pw = scaledRate(card.cacheWriteRate); const po = scaledRate(card.outputRate);
  const cost = (c: bigint, w: bigint, long: boolean) => ((i - c - w) * pi + c * pc + w * pw) * (long ? 2n : 1n) + o * po * (long ? 3n : 2n) / 2n;
  // Only a single response's input establishes the context tier. An interval may contain many requests.
  const longKnown = entry.grain === 'response' && i > 272000n;
  const longPossible = i > 272000n;
  if (entry.grain !== 'response' && longPossible) assumptions.push('CONTEXT_TIER_RANGE');
  const scale = scaledRate(multiplier);
  return { lower: cost(cMax, wMin, longKnown) * scale / 1000000n, upper: cost(cMin, wMax, longPossible) * scale / 1000000n, assumptions };
}
