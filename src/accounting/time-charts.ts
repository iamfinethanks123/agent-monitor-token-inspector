import { InspectorStore, validateQuery } from '../storage/InspectorStore';
import type { LedgerEntry, TimeChartBucket, TimeChartGroup, TimeChartView } from '../shared/inspector';
import { manualUsdPrice, entryUsdEstimate } from './manual-usd';
import type { UsdEntryEstimate } from './automatic-usd';

export const TIME_MINUTES = [1, 5, 15, 30, 60, 180, 360, 720, 1440];
export function timeCharts(store: InspectorStore, input: unknown, windowValue: unknown, bucketValue: unknown, now = Date.now()): TimeChartView {
  if (!TIME_MINUTES.includes(Number(windowValue)) || !TIME_MINUTES.includes(Number(bucketValue)) || typeof windowValue !== 'number' || typeof bucketValue !== 'number' || bucketValue > windowValue) throw new Error('INVALID_CHART_TIME');
  const windowMinutes = windowValue; const bucketMinutes = bucketValue; const query = validateQuery(input); delete query.cursor; delete query.limit;
  const from = now - windowMinutes * 60000; const step = bucketMinutes * 60000; const filter = store.queryFilter(query, 'l');
  const price = manualUsdPrice(store); let usd = 0n; let usdUpper = 0n; let usdPriced = 0; let usdUnpriced = 0;
  const fields = ['total', 'input', 'output', 'cachedInput', 'reasoning'] as const;
  const buckets: TimeChartBucket[] = Array.from({ length: Math.ceil(windowMinutes / bucketMinutes) }, (_, i) => ({ startAt: new Date(from + i * step).toISOString(), endAt: new Date(Math.min(now, from + (i + 1) * step)).toISOString(), total: null, input: null, output: null, cachedInput: null, reasoning: null,
    knownUncachedInput: '0', cacheCoveredInput: '0', cacheCoveredCached: '0', reasoningCoveredOutput: '0', reasoningCoveredReasoning: '0', responseTotal: '0', responseEntries: 0, intervalEntries: 0, entries: 0, usdUnits: null, usdUpperUnits: null, usdUnpriced: 0, partialFields: [] }));
  const counts = buckets.map(() => Object.fromEntries(fields.map(field => [field, 0])) as Record<typeof fields[number], number>);
  const machine = new Map<string, TimeChartGroup>(); const model = new Map<string, TimeChartGroup>(); const project = new Map<string, TimeChartGroup>(); let timed = 0n; let untimed = 0n; let quarantined = 0; let missing = 0;
  const addGroup = (groups: Map<string, TimeChartGroup>, id: string, value: string | null, money: UsdEntryEstimate | null) => { const group = groups.get(id) ?? { id, total: '0', entries: 0, usdUnits: null, usdUpperUnits: null, usdUnpriced: 0 }; group.entries++; if (value !== null) group.total = (BigInt(group.total) + BigInt(value)).toString(); if (money && !('reason' in money)) { group.usdUnits = (BigInt(group.usdUnits ?? '0') + money.lower).toString(); group.usdUpperUnits = (BigInt(group.usdUpperUnits ?? '0') + money.upper).toString(); } else if (price) group.usdUnpriced++; groups.set(id, group); };
  for (const row of store.db.prepare(`SELECT l.entry,l.revision,l.machine_id,l.status FROM scope_state a CROSS JOIN (SELECT m.*,p.entry FROM ledger_memberships m JOIN ledger_payloads p ON p.id=m.payload_id) l ON a.scope_id=l.scope_id AND a.active_revision=l.revision
    WHERE ${filter.sql} AND (json_extract(l.entry,'$.endAt') IS NULL OR json_extract(l.entry,'$.endAt')>=? AND json_extract(l.entry,'$.endAt')<?)`).iterate(...filter.args, new Date(from).toISOString(), new Date(now).toISOString())) {
    const entry = JSON.parse(String(row.entry)) as LedgerEntry; entry.revision = Number(row.revision);
    if (row.status !== 'selected') { quarantined++; continue; }
    if (!entry.endAt) { if (entry.usage.total.value !== null) untimed += BigInt(entry.usage.total.value); continue; }
    const index = Math.floor((Date.parse(entry.endAt) - from) / step); const bucket = buckets[index]; if (!bucket) continue;
    const money = price ? entryUsdEstimate(entry, price) : null;
    if (money && !('reason' in money)) { bucket.usdUnits = (BigInt(bucket.usdUnits ?? '0') + money.lower).toString(); bucket.usdUpperUnits = (BigInt(bucket.usdUpperUnits ?? '0') + money.upper).toString(); usd += money.lower; usdUpper += money.upper; usdPriced++; } else if (price) { bucket.usdUnpriced++; usdUnpriced++; }
    bucket.entries++; if (entry.grain === 'response') { bucket.responseEntries++; bucket.responseTotal = (BigInt(bucket.responseTotal) + BigInt(entry.usage.total.value ?? '0')).toString(); } else if (entry.grain === 'interval') bucket.intervalEntries++;
    for (const field of fields) {
      const value = entry.usage[field === 'reasoning' ? 'reasoningOutput' : field].value;
      if (value !== null) { bucket[field] = (BigInt(bucket[field] ?? '0') + BigInt(value)).toString(); counts[index][field]++; }
    }
    const input = entry.usage.input.value; const cache = entry.usage.cachedInput.value; const output = entry.usage.output.value; const reasoning = entry.usage.reasoningOutput.value;
    if (input !== null && cache !== null) { bucket.cacheCoveredInput = (BigInt(bucket.cacheCoveredInput) + BigInt(input)).toString(); bucket.cacheCoveredCached = (BigInt(bucket.cacheCoveredCached) + BigInt(cache)).toString(); bucket.knownUncachedInput = (BigInt(bucket.knownUncachedInput) + BigInt(input) - BigInt(cache)).toString(); }
    if (output !== null && reasoning !== null) { bucket.reasoningCoveredOutput = (BigInt(bucket.reasoningCoveredOutput) + BigInt(output)).toString(); bucket.reasoningCoveredReasoning = (BigInt(bucket.reasoningCoveredReasoning) + BigInt(reasoning)).toString(); }
    const total = entry.usage.total.value; if (total !== null) timed += BigInt(total); else missing++;
    addGroup(machine, String(row.machine_id), total, money); addGroup(model, entry.model.observedModel ?? entry.model.requestedModel ?? '(unknown)', total, money); addGroup(project, entry.identity.projectId ?? '(unknown)', total, money);
  }
  for (let index = 0; index < buckets.length; index++) {
    const bucket = buckets[index]; bucket.partialFields = fields.filter(field => counts[index][field] < bucket.entries);
    if (bucket.usdUnpriced) bucket.partialFields.push('USD');
    if (!bucket.entries) { for (const field of fields) bucket[field] = '0'; if (price) { bucket.usdUnits = '0'; bucket.usdUpperUnits = '0'; } }
  }
  const sorted = (groups: Map<string, TimeChartGroup>) => [...groups.values()].sort((a, b) => BigInt(a.total) > BigInt(b.total) ? -1 : BigInt(a.total) < BigInt(b.total) ? 1 : a.id.localeCompare(b.id));
  return { revision: store.revision(), from: new Date(from).toISOString(), to: new Date(now).toISOString(), windowMinutes, bucketMinutes, buckets, machines: sorted(machine), models: sorted(model), projects: sorted(project), timedKnownTotal: timed.toString(), untimedKnownTotal: untimed.toString(), excludedQuarantined: quarantined, missingTimedTotals: missing, usdPrice: price, timedUsdUnits: usdPriced ? usd.toString() : null, timedUsdUpperUnits: usdPriced ? usdUpper.toString() : null, usdUnpricedEntries: usdUnpriced,
    notes: ['Timed interval usage is allocated at its recorded end, not measured at minute-level occurrence. Response counts include identified responses only.', 'Cached input and reasoning are included subsets. Ratios use only entries with both numerator and denominator reported.', 'Uncached input is a known subtotal from covered input; missing cache is not assumed zero.', 'Untimed prior usage stays outside timed charts. Empty bins mean no selected recorded entries, not proof of no account activity.', 'All figures use the same canonical ledger revision; group totals are known subtotals. Machine timestamps do not establish causal order.'] };
}
