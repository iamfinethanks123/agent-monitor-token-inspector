import type { ExperimentVariant, ExperimentView, ResourceDistribution, TaskContract, TrialRecord } from '../shared/inspector';
import { fixedConditions } from '../shared/paired-comparison';

export function distribution(values: (string | null | undefined)[]): ResourceDistribution {
  const sorted = values.filter((value): value is string => value != null).map(BigInt).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length ? sorted.length % 2 ? sorted[middle].toString() : (() => { const sum = sorted[middle - 1] + sorted[middle]; return `${sum / 2n}${sum % 2n ? '.5' : ''}`; })() : null;
  return { count: sorted.length, missing: values.length - sorted.length, minimum: sorted[0]?.toString() ?? null, median, maximum: sorted.at(-1)?.toString() ?? null };
}

export function decimalDistribution(values: (string | null | undefined)[]): ResourceDistribution {
  const sorted = values.filter((value): value is string => value != null).map(value => {
    const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 1000000000000n + BigInt(fraction.padEnd(12, '0'));
  }).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const amount = (doubleUnits: bigint) => { const scaled = doubleUnits * 5n; const whole = scaled / 10000000000000n; const fraction = (scaled % 10000000000000n).toString().padStart(13, '0').replace(/0+$/, ''); return `${whole}${fraction ? `.${fraction}` : ''}`; };
  const middle = Math.floor(sorted.length / 2);
  return { count: sorted.length, missing: values.length - sorted.length, minimum: sorted.length ? amount(sorted[0] * 2n) : null,
    median: sorted.length ? amount(sorted.length % 2 ? sorted[middle] * 2n : sorted[middle - 1] + sorted[middle]) : null, maximum: sorted.length ? amount(sorted.at(-1)! * 2n) : null };
}

export function compareTrials(contracts: TaskContract[], trials: TrialRecord[], truncated = false): Pick<ExperimentView, 'variants' | 'recommendation' | 'recommendations'> {
  const groups = new Map<string, TrialRecord[]>();
  for (const trial of trials) { const key = JSON.stringify([trial.contractId, trial.variant]); const group = groups.get(key) ?? []; group.push(trial); groups.set(key, group); }
  const variants: ExperimentVariant[] = [...groups.values()].map(group => {
    const contract = contracts.find(item => item.id === group[0].contractId); const reasons = new Set<string>();
    const accepted = group.filter(trial => trial.outcome === 'verified_success' && trial.acceptanceReviewed && !trial.excludedReason);
    if (!contract?.protocol) reasons.add('PROTOCOL_MISSING');
    if (contract?.protocol && group.length < contract.protocol.minimumTrials) reasons.add('INSUFFICIENT_TRIALS');
    if (contract?.protocol && group.some(trial => trial.environment !== contract.environment || trial.configuration?.datasetRevision !== contract.protocol!.datasetRevision || trial.configuration?.repositoryRevision !== contract.protocol!.repositoryRevision)) reasons.add('FROZEN_CONDITIONS_MISMATCH');
    if (accepted.length !== group.length) reasons.add('QUALITY_OR_EXCLUSION_FAILURE');
    if (group.some(trial => !trial.configuration || !trial.resources || trial.tokens === null || trial.resources.issues.some(issue => issue !== 'DIAGNOSTIC_LIMIT'))) reasons.add('TELEMETRY_OR_CONFIGURATION_GAPS');
    if (group.some(trial => trial.cacheCondition === 'unknown')) reasons.add('CACHE_CONDITION_UNKNOWN');
    if (contract?.protocol?.changedVariables.length !== 1) reasons.add('MULTIPLE_OR_UNDECLARED_CHANGES');
    if (contract && new Set(group.map(trial => fixedConditions(trial, contract))).size !== 1) reasons.add('CONDITIONS_VARY_WITHIN_VARIANT');
    if (new Set(group.map(trial => JSON.stringify([trial.configuration?.model, trial.configuration?.configuration]))).size !== 1) reasons.add('VARIANT_CONFIGURATION_CHANGED');
    if (truncated) reasons.add('POPULATION_TRUNCATED');
    const allKnown = group.every(trial => trial.tokens !== null);
    const known = group.reduce((sum, trial) => sum + BigInt(trial.resources?.knownTokens ?? trial.tokens ?? '0'), 0n).toString();
    return { contractId: group[0].contractId, variant: group[0].variant, trials: group.length, accepted: accepted.length,
      failedOrCancelled: group.filter(trial => ['verified_failure', 'cancelled', 'setup_failed'].includes(trial.outcome)).length,
      totalTokens: allKnown ? group.reduce((sum, trial) => sum + BigInt(trial.tokens!), 0n).toString() : null, knownTokens: known,
      medianAcceptedTokens: distribution(accepted.map(trial => trial.tokens)).median, eligible: !reasons.size, reasons: [...reasons],
      distributions: { tokens: distribution(group.map(trial => trial.tokens)), uncachedInput: distribution(group.map(trial => trial.resources?.uncachedInput)),
        toolIntervalUnionMs: distribution(group.map(trial => trial.resources?.toolIntervals?.recordedComplete ? trial.resources.toolIntervals.knownUnionMs : null)),
        observedWindowMs: distribution(group.map(trial => trial.resources?.observedWindowMs)), failedToolCalls: distribution(group.map(trial => trial.resources?.failedToolCalls?.toString())),
        retryCandidates: distribution(group.map(trial => trial.resources?.retryCandidates?.toString())), compactionRecords: distribution(group.map(trial => trial.resources?.compactionRecords?.toString())) },
      priceDistributions: [...new Set(group.flatMap(trial => trial.resources?.prices.map(price => price.currency) ?? []))].map(currency => ({ currency,
        amounts: decimalDistribution(group.map(trial => trial.resources?.unpricedEntries === 0 ? trial.resources.prices.find(price => price.currency === currency)?.amount : null)) })),
      unpricedTrials: group.filter(trial => !trial.resources?.prices.length || trial.resources.unpricedEntries > 0).length };
  });
  const recommendations = contracts.map(contract => {
    const population = trials.filter(trial => trial.contractId === contract.id); const rows = variants.filter(variant => variant.contractId === contract.id);
    const reasons = new Set<string>();
    if (rows.length < 2) reasons.add('NEED_MULTIPLE_VARIANTS');
    if (rows.some(row => !row.eligible)) reasons.add('INELIGIBLE_VARIANT_PRESENT');
    if (new Set(population.map(trial => fixedConditions(trial, contract))).size > 1) reasons.add('INCOMPARABLE_FIXED_CONDITIONS');
    if (contract.protocol?.ordering === 'paired') {
      const sets = rows.map(row => population.filter(trial => trial.variant === row.variant).map(trial => trial.configuration?.pairId));
      if (sets.some(set => set.some(id => !id) || new Set(set).size !== set.length) || new Set(sets.map(set => JSON.stringify([...set].sort()))).size > 1) reasons.add('PAIRS_INCOMPLETE');
    }
    const orders = population.map(trial => trial.configuration?.order);
    if (orders.some(order => order == null) || new Set(orders).size !== orders.length) reasons.add('ORDER_MISSING_OR_DUPLICATED');
    if (truncated) reasons.add('POPULATION_TRUNCATED');
    const sorted = [...rows].sort((a, b) => {
      const left = a.medianAcceptedTokens; const right = b.medianAcceptedTokens;
      if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
      const scaled = (value: string) => BigInt(value.split('.')[0]) * 2n + (value.endsWith('.5') ? 1n : 0n);
      return scaled(left) < scaled(right) ? -1 : scaled(left) > scaled(right) ? 1 : 0;
    });
    if (sorted.length > 1 && sorted[0].medianAcceptedTokens === sorted[1].medianAcceptedTokens) reasons.add('NO_MEASURED_DIFFERENCE');
    return { contractId: contract.id, variant: !reasons.size ? sorted[0]?.variant ?? null : null, reasons: [...reasons] };
  });
  return { variants, recommendations, recommendation: recommendations.length === 1 ? recommendations[0].variant : null };
}
