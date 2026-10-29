import { InspectorStore, validateQuery } from '../storage/InspectorStore';
import { digest, object } from './codex-observations';
import type { LedgerEntry, ManualUsdPrice, ManualUsdView, TimeChartGroup } from '../shared/inspector';
import { AUTOMATIC_USD_PRICE, automaticEntryUsd, scaledRate, type UsdEntryEstimate } from './automatic-usd';

function rate(value: unknown): string { if (typeof value !== 'string' || !/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/.test(value)) throw new Error('INVALID_USD_RATE'); return value; }
export const usdAmount = (value: bigint) => `${value / 1000000000000n}.${(value % 1000000000000n).toString().padStart(12, '0')}`;
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' });

export function manualUsdPrice(store: InspectorStore): ManualUsdPrice | null {
  const id = store.getSetting('manual_usd_price'); if (id === 'disabled') return null; if (!id || id === 'automatic') return AUTOMATIC_USD_PRICE;
  const record = store.db.prepare('SELECT record FROM manual_usd_prices WHERE workspace_id=? AND id=?').get(store.workspaceId, id);
  return record ? JSON.parse(String(record.record)) as ManualUsdPrice : null;
}
export function setManualUsdPrice(store: InspectorStore, input: unknown): ManualUsdPrice {
  if (object(input)?.mode === 'automatic') {
    if (Object.keys(object(input)!).some(key => key !== 'mode')) throw new Error('INVALID_USD_PRICE');
    store.setSetting('manual_usd_price', 'automatic'); store.audit('automatic_usd.set', AUTOMATIC_USD_PRICE.id); return AUTOMATIC_USD_PRICE;
  }
  const value = object(input); if (!value || Object.keys(value).some(key => !['mode', 'uniformRate', 'inputRate', 'cachedInputRate', 'outputRate'].includes(key)) || !['uniform', 'components'].includes(String(value.mode))) throw new Error('INVALID_USD_PRICE');
  const rates = value.mode === 'uniform' ? { uniformRate: rate(value.uniformRate), inputRate: null, cachedInputRate: null, outputRate: null } : { uniformRate: null, inputRate: rate(value.inputRate), cachedInputRate: rate(value.cachedInputRate), outputRate: rate(value.outputRate) };
  const definition = { mode: value.mode as ManualUsdPrice['mode'], currency: 'USD' as const, provenance: 'user_defined' as const, ...rates }; const id = `usd:${digest(JSON.stringify([store.workspaceId, definition]))}`;
  const record: ManualUsdPrice = { id, ...definition, createdAt: new Date().toISOString() };
  store.db.exec('BEGIN IMMEDIATE');
  try { store.db.prepare('INSERT OR IGNORE INTO manual_usd_prices VALUES(?,?,?)').run(id, store.workspaceId, JSON.stringify(record)); store.setSetting('manual_usd_price', id); store.audit('manual_usd.set', id); store.db.exec('COMMIT'); }
  catch (error) { store.db.exec('ROLLBACK'); throw error; }
  return manualUsdPrice(store)!;
}
export function clearManualUsdPrice(store: InspectorStore): void { store.setSetting('manual_usd_price', 'disabled'); store.audit('manual_usd.disable', 'current'); }

export function entryUsd(entry: LedgerEntry, price: ManualUsdPrice): bigint | null {
  if (price.mode === 'automatic') { const estimate = automaticEntryUsd(entry, price); return 'reason' in estimate ? null : estimate.lower; }
  if (price.mode === 'uniform') return entry.usage.total.value === null ? null : BigInt(entry.usage.total.value) * scaledRate(price.uniformRate!);
  const input = entry.usage.input.value; const cache = entry.usage.cachedInput.value; const output = entry.usage.output.value;
  if (input === null || output === null) return null;
  const inputRate = scaledRate(price.inputRate!); const cacheRate = scaledRate(price.cachedInputRate!);
  if (cache === null && inputRate !== cacheRate) return null;
  return BigInt(input) * inputRate + (cache === null ? 0n : BigInt(cache) * (cacheRate - inputRate)) + BigInt(output) * scaledRate(price.outputRate!);
}
export function entryUsdEstimate(entry: LedgerEntry, price: ManualUsdPrice): UsdEntryEstimate {
  if (price.mode === 'automatic') return automaticEntryUsd(entry, price);
  const value = entryUsd(entry, price); return value === null ? { reason: 'MISSING_MANUAL_PRICE_COMPONENTS' } : { lower: value, upper: value, assumptions: [] };
}
export function manualUsd(store: InspectorStore, input: unknown = {}): ManualUsdView {
  const query = validateQuery(input); const price = manualUsdPrice(store); const revision = store.revision(); const filter = store.queryFilter(query, 'l'); let known = 0n; let upper = 0n; let priced = 0; let pricedTokens = 0n; let unpriced = 0;
  const reasons = new Map<string, number>(); const assumptions = new Map<string, number>();
  const groups = { days: new Map<string, TimeChartGroup>(), machines: new Map<string, TimeChartGroup>(), models: new Map<string, TimeChartGroup>(), projects: new Map<string, TimeChartGroup>() };
  for (const row of store.db.prepare(`SELECT l.entry,l.revision,l.machine_id FROM scope_state a CROSS JOIN (SELECT m.*,p.entry FROM ledger_memberships m JOIN ledger_payloads p ON p.id=m.payload_id) l ON a.scope_id=l.scope_id AND a.active_revision=l.revision WHERE ${filter.sql} AND l.status='selected'`).iterate(...filter.args)) {
    const entry = JSON.parse(String(row.entry)) as LedgerEntry; entry.revision = Number(row.revision); const value = price ? entryUsdEstimate(entry, price) : { reason: 'CONVERSION_DISABLED' };
    if ('reason' in value) { unpriced++; reasons.set(value.reason, (reasons.get(value.reason) ?? 0) + 1); }
    else { known += value.lower; upper += value.upper; priced++; pricedTokens += BigInt(entry.usage.total.value ?? '0'); for (const assumption of value.assumptions) assumptions.set(assumption, (assumptions.get(assumption) ?? 0) + 1); }
    for (const [dimension, id] of [['days', entry.endAt ? day.format(new Date(entry.endAt)) : '(untimed)'], ['machines', String(row.machine_id)], ['models', entry.model.observedModel ?? entry.model.requestedModel ?? '(unknown)'], ['projects', entry.identity.projectId ?? '(unknown)']] as const) {
      const group = groups[dimension].get(id) ?? { id, total: '0', entries: 0, usdUnits: null, usdUpperUnits: null, usdUnpriced: 0 };
      group.entries++; group.total = (BigInt(group.total) + BigInt(entry.usage.total.value ?? '0')).toString();
      if ('reason' in value) group.usdUnpriced++; else { group.usdUnits = (BigInt(group.usdUnits ?? '0') + value.lower).toString(); group.usdUpperUnits = (BigInt(group.usdUpperUnits ?? '0') + value.upper).toString(); }
      groups[dimension].set(id, group);
    }
  }
  return { revision, price, amount: price && priced ? usdAmount(known) : null, upperAmount: price && priced ? usdAmount(upper) : null, pricedEntries: priced, pricedTokens: pricedTokens.toString(), unpricedEntries: unpriced, complete: !!price && priced > 0 && unpriced === 0 && assumptions.size === 0,
    reasons: [...reasons].map(([reason, entries]) => ({ reason, entries })), assumptions: [...assumptions].map(([assumption, entries]) => ({ assumption, entries })),
    breakdown: { days: [...groups.days.values()].sort((a, b) => a.id.localeCompare(b.id)), machines: [...groups.machines.values()], models: [...groups.models.values()], projects: [...groups.projects.values()] },
    notes: [price?.mode === 'automatic' ? 'Current official API-equivalent price snapshot applied per entry model; not historical billing. Unknown service tier assumes Standard, global processing; tool fees and regional uplift are outside this scenario.' : 'User-defined USD scenario per one million tokens; not a provider-verified rate card or a subscription charge.',
      'Input includes cached reads and cache writes as disjoint subsets; reasoning is included in output. Subsets are never charged twice.', 'Automatic estimates bound missing cache partitions and interval context tiers; unknown model/provider/required usage stays unpriced. Bounds apply to the stated scenario, not every possible account bill.', 'The immutable price ID, full catalog and ledger revision identify this estimate. Changing current pricing never rewrites saved reports.'] };
}
