import type { PairedComparison, PairedMetric, PairedSelection, ResourceDistribution, TaskContract, TrialRecord } from './inspector';

export function fixedConditions(trial: TrialRecord, contract: TaskContract): string {
  const changes = contract.protocol?.changedVariables ?? [];
  return JSON.stringify([trial.environment, trial.configuration?.datasetRevision, trial.configuration?.repositoryRevision,
    changes.includes('model') ? null : trial.configuration?.model, changes.includes('configuration') ? null : trial.configuration?.configuration, trial.cacheCondition]);
}
const units = (value: string, scale: number) => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0'); };
const amount = (value: bigint, scale: number) => {
  const negative = value < 0n; const absolute = negative ? -value : value; const divisor = 10n ** BigInt(scale);
  const fraction = scale ? (absolute % divisor).toString().padStart(scale, '0').replace(/0+$/, '') : '';
  return `${negative ? '-' : ''}${absolute / divisor}${fraction ? `.${fraction}` : ''}`;
};
function differences(values: (string | null)[], scale: number): ResourceDistribution {
  const sorted = values.filter((value): value is string => value !== null).map(value => value.startsWith('-') ? -units(value.slice(1), scale) : units(value, scale)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const middle = Math.floor(sorted.length / 2);
  return { count: sorted.length, missing: values.length - sorted.length, minimum: sorted.length ? amount(sorted[0], scale) : null, maximum: sorted.length ? amount(sorted.at(-1)!, scale) : null,
    median: sorted.length ? amount(sorted.length % 2 ? sorted[middle] * 10n : (sorted[middle - 1] + sorted[middle]) * 5n, scale + 1) : null };
}

/** Candidate minus reference, using immutable trial snapshots; no causal or winner claim. */
export function pairedComparison(contract: TaskContract, trials: TrialRecord[], selection: PairedSelection, truncated = false): PairedComparison {
  const population = trials.filter(trial => trial.contractId === contract.id && [selection.referenceVariant, selection.candidateVariant].includes(trial.variant));
  const issues = [...(truncated ? ['POPULATION_TRUNCATED'] : []), ...(contract.protocol?.ordering !== 'paired' ? ['PAIRED_PROTOCOL_REQUIRED'] : []),
    ...(selection.referenceVariant === selection.candidateVariant || ![selection.referenceVariant, selection.candidateVariant].every(variant => population.some(trial => trial.variant === variant)) ? ['VARIANT_SELECTION_INVALID'] : [])];
  const result: PairedComparison = { version: 'paired-difference/1', contractId: contract.id, selection, available: !issues.length, issues, pairs: [], selectedTrials: population.length, acceptedPairs: 0, summaries: [] };
  if (!result.available) return result;
  if (contract.protocol!.changedVariables.length !== 1) issues.push('MULTIPLE_OR_UNDECLARED_CHANGES');
  const groups = new Map<string, { pairId: string | null; reference: TrialRecord[]; candidate: TrialRecord[] }>();
  for (const trial of population) {
    const pairId = trial.configuration?.pairId ?? null; const key = JSON.stringify(pairId ? ['pair', pairId] : ['unpaired', trial.id]);
    const group = groups.get(key) ?? { pairId, reference: [], candidate: [] }; group[trial.variant === selection.referenceVariant ? 'reference' : 'candidate'].push(trial); groups.set(key, group);
  }
  const currencies = [...new Set(population.flatMap(trial => trial.resources?.prices.map(price => price.currency) ?? []))].sort();
  const metrics = [
    { key: 'tokens', unit: 'tokens', value: (trial: TrialRecord) => trial.tokens },
    { key: 'uncachedInput', unit: 'tokens', value: (trial: TrialRecord) => trial.resources?.uncachedInput ?? null },
    { key: 'observedWindowMs', unit: 'ms', value: (trial: TrialRecord) => trial.resources?.observedWindowMs ?? null },
    { key: 'toolIntervalUnionMs', unit: 'ms', value: (trial: TrialRecord) => trial.resources?.toolIntervals?.recordedComplete ? trial.resources.toolIntervals.knownUnionMs : null },
    { key: 'failedToolCalls', unit: 'count', value: (trial: TrialRecord) => trial.resources?.failedToolCalls?.toString() ?? null },
    { key: 'retryCandidates', unit: 'count', value: (trial: TrialRecord) => trial.resources?.retryCandidates?.toString() ?? null },
    { key: 'compactionRecords', unit: 'count', value: (trial: TrialRecord) => trial.resources?.compactionRecords?.toString() ?? null },
    ...currencies.map(currency => ({ key: `api:${currency}`, unit: currency, value: (trial: TrialRecord) => trial.resources?.unpricedEntries === 0 ? trial.resources.prices.find(price => price.currency === currency)?.amount ?? null : null })),
  ];
  for (const [id, group] of groups) {
    const reference = group.reference.length === 1 ? group.reference[0] : undefined; const candidate = group.candidate.length === 1 ? group.candidate[0] : undefined;
    const problems: string[] = [];
    if (!group.pairId) problems.push('PAIR_ID_MISSING');
    if (!group.reference.length || !group.candidate.length) problems.push('PAIR_SIDE_MISSING');
    if (group.reference.length > 1 || group.candidate.length > 1) problems.push('PAIR_DUPLICATED');
    const accepted = !!reference && !!candidate && [reference, candidate].every(trial => trial.outcome === 'verified_success' && trial.acceptanceReviewed && !trial.excludedReason);
    if (!accepted) problems.push('QUALITY_NOT_ACCEPTED');
    const paired = [...group.reference, ...group.candidate];
    if (paired.some(trial => trial.contractRevision !== contract.revision)) problems.push('CONTRACT_REVISION_MISMATCH');
    if (paired.some(trial => !trial.configuration || trial.environment !== contract.environment || trial.configuration.datasetRevision !== contract.protocol!.datasetRevision || trial.configuration.repositoryRevision !== contract.protocol!.repositoryRevision)) problems.push('FROZEN_CONDITIONS_MISMATCH');
    if (reference && candidate && fixedConditions(reference, contract) !== fixedConditions(candidate, contract)) problems.push('FIXED_CONDITIONS_MISMATCH');
    if (paired.some(trial => trial.cacheCondition === 'unknown')) problems.push('CACHE_CONDITION_UNKNOWN');
    if (paired.some(trial => trial.configuration?.uncontrolledFactors.length)) problems.push('UNCONTROLLED_FACTORS_RECORDED');
    if (reference && candidate && JSON.stringify([...reference.resources?.priceSnapshotIds ?? []].sort()) !== JSON.stringify([...candidate.resources?.priceSnapshotIds ?? []].sort())) problems.push('PRICE_SNAPSHOTS_DIFFER');
    const values: PairedMetric[] = metrics.map(metric => {
      const before = reference ? metric.value(reference) : null; const after = candidate ? metric.value(candidate) : null; const scale = metric.key.startsWith('api:') ? 12 : 0;
      return { key: metric.key, unit: metric.unit, reference: before, candidate: after, delta: before === null || after === null ? null : amount(units(after, scale) - units(before, scale), scale) };
    });
    result.pairs.push({ id, pairId: group.pairId, referenceIds: group.reference.map(trial => trial.id), candidateIds: group.candidate.map(trial => trial.id), referenceRevisions: group.reference.map(trial => trial.revision), candidateRevisions: group.candidate.map(trial => trial.revision),
      referencePriceIds: [...new Set(group.reference.flatMap(trial => trial.resources?.priceSnapshotIds ?? []))].sort(), candidatePriceIds: [...new Set(group.candidate.flatMap(trial => trial.resources?.priceSnapshotIds ?? []))].sort(),
      referenceOutcome: reference?.outcome ?? null, candidateOutcome: candidate?.outcome ?? null, accepted, issues: problems, metrics: values });
  }
  result.pairs.sort((a, b) => (a.pairId ?? a.id).localeCompare(b.pairId ?? b.id, 'en', { numeric: true }));
  result.acceptedPairs = result.pairs.filter(pair => pair.accepted).length;
  if (result.pairs.filter(pair => pair.pairId && pair.referenceIds.length === 1 && pair.candidateIds.length === 1).length < contract.protocol!.minimumTrials) issues.push('INSUFFICIENT_TRIALS');
  result.summaries = metrics.map(metric => ({ key: metric.key, unit: metric.unit, differences: differences(result.pairs.map(pair => pair.metrics.find(value => value.key === metric.key)!.delta), metric.key.startsWith('api:') ? 12 : 0) }));
  return result;
}
