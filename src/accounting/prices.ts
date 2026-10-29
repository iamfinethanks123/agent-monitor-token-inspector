import { InspectorStore, validateQuery } from '../storage/InspectorStore';
import { digest, object, timestamp } from './codex-observations';
import { integer } from './integers';
import type { LedgerEntry, PriceAnalytics, PriceSnapshot, PriceTier } from '../shared/inspector';

const RATE_SCALE = 1_000_000n;
const MONEY_SCALE = 1_000_000_000_000n;
function rate(value: unknown): string { if (typeof value !== 'string' || !/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/.test(value)) throw new Error('INVALID_RATE'); return value; }
function rateInteger(value: string): bigint { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(6, '0')); }
function money(value: bigint): string { return `${value / MONEY_SCALE}.${(value % MONEY_SCALE).toString().padStart(12, '0')}`; }
function name(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_.:/-]{1,256}$/.test(value)) throw new Error('INVALID_PRICE_IDENTITY'); return value; }

export function savePrice(store: InspectorStore, input: unknown): PriceSnapshot {
  const value = object(input); if (!value || Object.keys(value).some(key => !['provider', 'model', 'serviceTier', 'currency', 'effectiveAt', 'sourceUrl', 'asOf', 'reviewed', 'attribution', 'cacheWritePolicy', 'tiers'].includes(key))) throw new Error('INVALID_PRICE_CARD');
  if (value.reviewed !== true || !['observed', 'requested_reviewed'].includes(String(value.attribution)) || !['included', 'unsupported'].includes(String(value.cacheWritePolicy))) throw new Error('PRICE_REVIEW_REQUIRED');
  if (typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency)) throw new Error('INVALID_CURRENCY');
  const effectiveAt = timestamp(value.effectiveAt); const asOf = timestamp(value.asOf); if (!effectiveAt || !asOf) throw new Error('INVALID_PRICE_DATE');
  const url = new URL(String(value.sourceUrl)); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('INVALID_PRICE_SOURCE');
  if (!Array.isArray(value.tiers) || value.tiers.length < 1 || value.tiers.length > 20) throw new Error('INVALID_PRICE_TIERS');
  const tiers: PriceTier[] = value.tiers.map(inputTier => {
    const tier = object(inputTier); if (!tier || Object.keys(tier).some(key => !['minimumInput', 'inputRate', 'cachedInputRate', 'outputRate'].includes(key))) throw new Error('INVALID_PRICE_TIERS');
    return { minimumInput: integer(tier.minimumInput), inputRate: rate(tier.inputRate), cachedInputRate: rate(tier.cachedInputRate), outputRate: rate(tier.outputRate) };
  });
  if (tiers[0].minimumInput !== '0' || tiers.some((tier, i) => i > 0 && BigInt(tier.minimumInput) <= BigInt(tiers[i - 1].minimumInput))) throw new Error('INVALID_PRICE_TIERS');
  const card = { provider: name(value.provider), model: name(value.model), serviceTier: value.serviceTier === null ? null : name(value.serviceTier), currency: value.currency,
    effectiveAt, sourceUrl: url.href, asOf, reviewed: true as const, attribution: value.attribution as PriceSnapshot['attribution'], cacheWritePolicy: value.cacheWritePolicy as PriceSnapshot['cacheWritePolicy'], tiers };
  const id = `price:${digest(JSON.stringify(card))}`; const record = { id, ...card };
  store.db.prepare('INSERT OR IGNORE INTO price_snapshots VALUES(?,?,?)').run(id, store.workspaceId, JSON.stringify(record)); store.audit('price_snapshot.add', id); return record;
}

export function priceAnalytics(store: InspectorStore, input: unknown = {}, modeValue: unknown = 'historical'): PriceAnalytics {
  const query = validateQuery(input); if (!['historical', 'current'].includes(String(modeValue))) throw new Error('INVALID_PRICE_MODE'); const mode = modeValue as 'historical' | 'current';
  const cards = store.db.prepare('SELECT record FROM price_snapshots WHERE workspace_id=? ORDER BY rowid').all(store.workspaceId).map(row => JSON.parse(String(row.record)) as PriceSnapshot);
  const filter = store.queryFilter(query, 'l'); const currencies = new Map<string, { amount: bigint; tokens: bigint; count: number }>(); const reasons = new Map<string, number>(); const snapshots = new Set<string>(); let unpricedEntries = 0;
  const unpriced = (reason: string) => { unpricedEntries++; reasons.set(reason, (reasons.get(reason) ?? 0) + 1); };
  for (const row of store.db.prepare(`SELECT l.entry FROM scope_state a CROSS JOIN ledger l ON a.scope_id=l.scope_id AND a.active_revision=l.revision WHERE ${filter.sql} AND l.status='selected'`).iterate(...filter.args)) {
    const entry = JSON.parse(String(row.entry)) as LedgerEntry;
    const i = entry.usage.input.value; const c = entry.usage.cachedInput.value; const o = entry.usage.output.value;
    if (i === null || c === null || o === null) { unpriced('MISSING_INPUT_CACHE_OR_OUTPUT'); continue; }
    if (entry.grain === 'aggregate') { unpriced('UNTIMED_AGGREGATE_MODEL_UNKNOWN'); continue; }
    const at = mode === 'current' ? new Date().toISOString() : entry.endAt; if (!at) { unpriced('EXECUTION_TIME_UNKNOWN'); continue; }
    const available = cards.filter(card => card.provider === entry.model.providerRoute && card.serviceTier === entry.model.serviceTier
      && card.effectiveAt <= at && card.model === (card.attribution === 'observed' ? entry.model.observedModel : entry.model.requestedModel)).sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));
    const card = available[0]; if (!card) { unpriced('NO_REVIEWED_ROUTE_MODEL_TIER_CARD'); continue; }
    if (available.some(other => other.id !== card.id && other.effectiveAt === card.effectiveAt)) { unpriced('CONFLICTING_PRICE_SNAPSHOTS'); continue; }
    if (card.cacheWritePolicy === 'unsupported' && entry.usage.cacheWriteInput.value !== '0') { unpriced('CACHE_WRITE_TREATMENT_UNKNOWN'); continue; }
    if (card.tiers.length > 1 && entry.grain !== 'response') { unpriced('CONTEXT_TIER_REQUIRES_RESPONSE_SCOPE'); continue; }
    if (mode === 'historical' && entry.grain === 'interval' && entry.startAt && entry.startAt < card.effectiveAt) { unpriced('INTERVAL_CROSSES_PRICE_BOUNDARY'); continue; }
    const tier = [...card.tiers].reverse().find(t => BigInt(i) >= BigInt(t.minimumInput))!;
    const amount = (BigInt(i) - BigInt(c)) * rateInteger(tier.inputRate) + BigInt(c) * rateInteger(tier.cachedInputRate) + BigInt(o) * rateInteger(tier.outputRate);
    const currency = currencies.get(card.currency) ?? { amount: 0n, tokens: 0n, count: 0 }; currency.amount += amount; currency.tokens += BigInt(entry.usage.total.value ?? '0'); currency.count++; currencies.set(card.currency, currency); snapshots.add(card.id);
  }
  return { revision: store.revision(), mode, cards, currencies: [...currencies].map(([currency, value]) => ({ currency, amount: money(value.amount), pricedEntries: value.count, tokenSubtotal: value.tokens.toString() })),
    unpricedEntries, reasons: [...reasons].map(([reason, entries]) => ({ reason, entries })), snapshotIds: [...snapshots],
    notes: ['API-equivalent estimate using user-reviewed immutable rate cards; not a subscription charge, refund, or quota conversion.', 'Known subtotals exclude unpriced entries; currencies are never added together.',
      'Rates are per one million tokens; decimal arithmetic is exact to 12 fractional currency digits.', 'Requested-model pricing is enabled only by an explicitly reviewed requested-model card.', 'Context tiers use individual response input; reasoning has no separate surcharge.'] };
}
