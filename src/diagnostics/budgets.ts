import { InspectorStore, validateQuery } from '../storage/InspectorStore';
import { digest, object } from '../accounting/codex-observations';
import { integer } from '../accounting/integers';
import { priceAnalytics } from '../accounting/prices';
import type { BudgetMetric, BudgetPolicy, BudgetState, InspectorQuery } from '../shared/inspector';

const metrics: BudgetMetric[] = ['tokens', 'uncached_input', 'elapsed_ms', 'api_estimate'];
function scaled(value: string): bigint { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 1000000000000n + BigInt(fraction.padEnd(12, '0')); }
function threshold(value: unknown, metric: BudgetMetric): string {
  if (metric !== 'api_estimate') { const result = integer(value); if (result === '0') throw new Error('INVALID_BUDGET'); return result; }
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,23})(\.\d{1,12})?$/.test(value) || scaled(value) === 0n) throw new Error('INVALID_BUDGET');
  return value;
}
function above(value: string | null, policy: BudgetPolicy): boolean { return value !== null && scaled(value) >= scaled(policy.tokenLimit); }

export function budgetValue(store: InspectorStore, policy: BudgetPolicy): { current: string | null; issues: string[] } {
  const metric = policy.metric ?? 'tokens'; const summary = store.summary(policy.query); const issues = [...(summary.quarantinedEntries ? ['QUARANTINED_USAGE_EXCLUDED'] : []), ...(summary.usage.total.assumptions.some(note => note.startsWith('Known subtotal only')) ? ['PARTIAL_TOKEN_COVERAGE'] : [])];
  if (metric === 'tokens') return { current: summary.usage.total.value, issues };
  if (metric === 'uncached_input') {
    const input = summary.usage.input.value; const cache = summary.usage.cachedInput.value;
    const partial = input === null || cache === null || summary.usage.input.assumptions.some(note => note.startsWith('Known subtotal only')) || summary.usage.cachedInput.assumptions.some(note => note.startsWith('Known subtotal only'));
    return { current: partial ? null : (BigInt(input!) - BigInt(cache!)).toString(), issues: partial ? [...issues, 'INPUT_OR_CACHE_UNKNOWN'] : issues };
  }
  if (metric === 'api_estimate') {
    const prices = priceAnalytics(store, policy.query, 'historical'); const currency = prices.currencies.find(item => item.currency === policy.currency);
    return { current: currency?.amount ?? null, issues: [...issues, ...(prices.unpricedEntries ? ['PARTIAL_PRICE_COVERAGE'] : []), ...(prices.currencies.some(item => item.currency !== policy.currency) ? ['OTHER_CURRENCIES_EXCLUDED'] : []), 'API_ESTIMATE_NOT_SUBSCRIPTION_CHARGE'] };
  }
  const filter = store.queryFilter(policy.query, 'l');
  const span = store.db.prepare(`SELECT MIN(COALESCE(json_extract(l.entry,'$.startAt'),json_extract(l.entry,'$.endAt'))) AS first,
    MAX(json_extract(l.entry,'$.endAt')) AS last,COUNT(DISTINCT l.machine_id) AS machines,
    SUM(CASE WHEN json_extract(l.entry,'$.endAt') IS NULL THEN 1 ELSE 0 END) AS untimed
    FROM scope_state a CROSS JOIN ledger l ON a.scope_id=l.scope_id AND a.active_revision=l.revision WHERE ${filter.sql} AND l.status='selected'`).get(...filter.args)!;
  const duration = span.first && span.last ? Date.parse(String(span.last)) - Date.parse(String(span.first)) : NaN;
  return { current: Number(span.machines) > 1 || !Number.isSafeInteger(duration) || duration < 0 ? null : String(duration), issues: [...issues, 'OBSERVED_TIMESTAMP_SPAN_NOT_RUNTIME', ...(Number(span.machines) > 1 ? ['CROSS_MACHINE_CLOCKS_UNCOMPARABLE'] : []), ...(Number(span.untimed) ? ['UNTIMED_USAGE_EXCLUDED_FROM_SPAN'] : [])] };
}

export function setBudget(store: InspectorStore, value: unknown): void {
  const input = object(value); if (!input || Object.keys(input).some(key => !['query', 'tokenLimit', 'metric', 'currency'].includes(key))) throw new Error('INVALID_RECORD');
  const metric = (input.metric ?? 'tokens') as BudgetMetric; if (!metrics.includes(metric)) throw new Error('INVALID_BUDGET');
  const query = validateQuery(input.query); delete query.cursor; delete query.limit; delete query.includeQuarantined;
  const currency = metric === 'api_estimate' ? input.currency : undefined;
  if (metric === 'api_estimate' && (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) || metric !== 'api_estimate' && input.currency !== undefined) throw new Error('INVALID_CURRENCY');
  const tokenLimit = threshold(input.tokenLimit, metric); const id = `budget:${digest(JSON.stringify([query, metric, currency ?? null]))}`;
  if (!store.db.prepare('SELECT 1 FROM budgets WHERE id=? AND workspace_id=?').get(id, store.workspaceId) && Number(store.db.prepare('SELECT COUNT(*) n FROM budgets WHERE workspace_id=?').get(store.workspaceId)!.n) >= 200) throw new Error('BUDGET_LIMIT');
  const record: BudgetPolicy = { id, query, metric, ...(currency ? { currency: String(currency) } : {}), tokenLimit, baseline: null, createdAt: new Date().toISOString(), crossedAt: null };
  record.baseline = budgetValue(store, record).current; record.lastValue = record.baseline; record.historical = above(record.baseline, record);
  store.db.prepare('INSERT INTO budgets VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record').run(id, store.workspaceId, JSON.stringify(record));
  store.audit('budget.set', id);
}

export function removeBudget(store: InspectorStore, id: unknown): void {
  if (typeof id !== 'string' || !/^budget:[a-f0-9]{64}$/.test(id)) throw new Error('INVALID_BUDGET');
  store.db.prepare('DELETE FROM budgets WHERE workspace_id=? AND id=?').run(store.workspaceId, id); store.audit('budget.remove', id);
}

export function clearBudgetHistory(store: InspectorStore, sourceIds: Set<string>): void {
  for (const row of store.db.prepare('SELECT record FROM budgets WHERE workspace_id=?').all(store.workspaceId)) {
    const policy = JSON.parse(String(row.record)) as BudgetPolicy;
    if (!store.sources(policy.query).some(source => sourceIds.has(source.id))) continue;
    policy.baseline = null; policy.lastValue = null; policy.crossedAt = null; policy.historical = false;
    store.db.prepare('UPDATE budgets SET record=? WHERE id=? AND workspace_id=?').run(JSON.stringify(policy), policy.id, store.workspaceId);
  }
}

export function budgets(store: InspectorStore): BudgetState {
  return { policies: store.db.prepare('SELECT record FROM budgets WHERE workspace_id=? ORDER BY id LIMIT 200').all(store.workspaceId).map(row => {
    const record = JSON.parse(String(row.record)) as BudgetPolicy; const value = budgetValue(store, record);
    return { ...record, ...value, crossed: !!record.crossedAt, historical: record.historical ?? above(record.baseline, record) };
  }) };
}

/** Only recent append evidence can create a live crossing. Imports reset the baseline. */
export function evaluateBudgets(store: InspectorStore, liveSources: Set<string>, changedSources: Set<string>, now: number): void {
  for (const row of store.db.prepare('SELECT record FROM budgets WHERE workspace_id=? LIMIT 200').all(store.workspaceId)) {
    const policy = JSON.parse(String(row.record)) as BudgetPolicy; const sources = store.sources(policy.query);
    const changed = sources.filter(source => {
      if (!changedSources.has(source.id)) return false; const context = store.getSource(source.id)?.context;
      return (!policy.query.projectId || context?.projectId === policy.query.projectId) && (!policy.query.requestedModel || context?.requestedModel === policy.query.requestedModel);
    }); if (!changed.length) continue;
    const current = budgetValue(store, policy).current; const previous = policy.lastValue ?? policy.baseline;
    const eligible = changed.every(source => liveSources.has(source.id));
    if (!policy.crossedAt && eligible && previous !== null && !above(previous, policy) && above(current, policy)) {
      policy.crossedAt = new Date(now).toISOString(); policy.historical = false; store.audit('budget.crossed', policy.id);
    } else if (!eligible || previous === null) policy.historical = above(current, policy);
    policy.lastValue = current;
    store.db.prepare('UPDATE budgets SET record=? WHERE workspace_id=? AND id=?').run(JSON.stringify(policy), store.workspaceId, policy.id);
  }
}
