import assert from 'node:assert/strict';
import test from 'node:test';
import { pairedComparison } from '../src/shared/paired-comparison';
import type { TaskContract, TrialRecord } from '../src/shared/inspector';

const contract: TaskContract = { id: 'contract', runId: 'root', revision: 1, objective: 'Fixture', acceptance: 'Checks pass', environment: 'fixed', createdAt: '2026-10-16T00:00:00Z', protocol: { suiteId: 'suite', datasetRevision: 'data', repositoryRevision: 'repo', acceptanceSuite: 'checks', changedVariables: ['tool_output'], ordering: 'paired', minimumTrials: 3 } };
const selection = { referenceVariant: 'reference', candidateVariant: 'candidate' };
function trial(id: string, variant: string, pairId: string | null, tokens: string): TrialRecord {
  return { id, contractId: contract.id, contractRevision: 1, runId: id, variant, outcome: 'verified_success', acceptanceReviewed: true, evidenceRefs: [], environment: 'fixed', cacheCondition: 'controlled', createdAt: contract.createdAt, tokens, revision: 1, excludedReason: null,
    configuration: { datasetRevision: 'data', repositoryRevision: 'repo', model: 'fixture', configuration: 'fixed', pairId, order: 1, rerunOf: null, uncontrolledFactors: [] },
    resources: { knownTokens: tokens, uncachedInput: tokens, observedWindowMs: '10', observedFrom: null, observedTo: null, requestedModels: ['fixture'], projectIds: [], toolCalls: 1, failedToolCalls: 0, retryCandidates: 0, compactionRecords: 0, prices: [{ currency: 'USD', amount: '0.000000000002' }], unpricedEntries: 0, priceSnapshotIds: ['price-fixed'], sourceIds: [], selectedEntries: 1, quarantinedEntries: 0, issues: [], toolIntervals: { knownUnionMs: '10', indexedCalls: 1, timedCalls: 1, missingCalls: 0, invalidCalls: 0, clockScope: 'single_machine', recordedComplete: true } } };
}

test('paired differences preserve integers above 2^53, negative half medians and 13-digit monetary medians', () => {
  const trials = [-2, -1, 0, 1].flatMap((delta, i) => {
    const before = trial(`ref-${i}`, 'reference', `pair-${i}`, '9007199254740993');
    const after = trial(`candidate-${i}`, 'candidate', `pair-${i}`, (9007199254740993n + BigInt(delta)).toString());
    after.resources!.prices[0].amount = i % 2 === 0 ? '0.000000000001' : '0.000000000002';
    return [before, after];
  });
  const result = pairedComparison(contract, trials, selection);
  assert.equal(result.available, true); assert.equal(result.acceptedPairs, 4); assert.equal(result.selectedTrials, 8);
  assert.deepEqual(result.pairs.map(pair => pair.metrics.find(metric => metric.key === 'tokens')!.delta), ['-2', '-1', '0', '1']);
  assert.equal(result.summaries.find(metric => metric.key === 'tokens')?.differences.median, '-0.5');
  assert.equal(result.summaries.find(metric => metric.key === 'api:USD')?.differences.median, '-0.0000000000005');
  assert.equal(result.version, 'paired-difference/1'); assert.deepEqual(result.pairs[0].referenceRevisions, [1]); assert.deepEqual(result.pairs[0].candidatePriceIds, ['price-fixed']);
  assert.equal(trials[0].tokens, '9007199254740993');
});

test('failed, duplicate, missing and unpaired trials remain visible without invented deltas or quality success', () => {
  const trials = [trial('r1', 'reference', 'pair-1', '10'), trial('r1-duplicate', 'reference', 'pair-1', '11'), trial('c1', 'candidate', 'pair-1', '1'),
    trial('r2', 'reference', 'pair-2', '10'), trial('c2', 'candidate', 'pair-2', '9'), trial('r3', 'reference', 'pair-3', '10'), trial('unpaired', 'candidate', null, '1')];
  trials[4].outcome = 'verified_failure'; trials[4].resources!.toolIntervals!.recordedComplete = false;
  trials[4].resources!.unpricedEntries = 1;
  const result = pairedComparison(contract, trials, selection);
  assert.equal(result.selectedTrials, 7); assert.equal(result.pairs.length, 4); assert.equal(result.acceptedPairs, 0);
  assert(result.pairs.find(pair => pair.pairId === 'pair-1')!.issues.includes('PAIR_DUPLICATED'));
  assert.equal(result.pairs.find(pair => pair.pairId === 'pair-1')!.metrics[0].delta, null);
  const failed = result.pairs.find(pair => pair.pairId === 'pair-2')!;
  assert.equal(failed.metrics[0].delta, '-1'); assert(failed.issues.includes('QUALITY_NOT_ACCEPTED'));
  assert.equal(failed.metrics.find(metric => metric.key === 'toolIntervalUnionMs')!.delta, null);
  assert.equal(failed.metrics.find(metric => metric.key === 'api:USD')!.delta, null);
  assert.equal(result.summaries[0].differences.count, 1); assert.equal(result.summaries[0].differences.missing, 3);
  assert(result.issues.includes('INSUFFICIENT_TRIALS'));
});

test('truncated or non-paired populations are unavailable; recorded confounders remain explicit', () => {
  const before = trial('r', 'reference', 'p', '10'); const after = trial('c', 'candidate', 'p', '8');
  after.environment = 'different'; after.cacheCondition = 'unknown'; after.resources!.priceSnapshotIds = ['other-price']; after.configuration!.uncontrolledFactors = ['provider variance'];
  const paired = pairedComparison(contract, [before, after], selection);
  assert(paired.pairs[0].issues.includes('FIXED_CONDITIONS_MISMATCH')); assert(paired.pairs[0].issues.includes('FROZEN_CONDITIONS_MISMATCH'));
  assert(paired.pairs[0].issues.includes('CACHE_CONDITION_UNKNOWN')); assert(paired.pairs[0].issues.includes('PRICE_SNAPSHOTS_DIFFER')); assert(paired.pairs[0].issues.includes('UNCONTROLLED_FACTORS_RECORDED'));
  after.resources!.prices = [{ currency: 'EUR', amount: '1' }];
  const currencies = pairedComparison(contract, [before, after], selection); assert.equal(currencies.pairs[0].metrics.find(metric => metric.key === 'api:USD')?.delta, null); assert.equal(currencies.pairs[0].metrics.find(metric => metric.key === 'api:EUR')?.delta, null);
  const truncated = pairedComparison(contract, [before, after], selection, true); assert.equal(truncated.available, false); assert.deepEqual(truncated.summaries, []);
  assert.equal(pairedComparison({ ...contract, protocol: { ...contract.protocol!, ordering: 'recorded' } }, [before, after], selection).available, false);
  assert.equal(pairedComparison(contract, [before, after], { referenceVariant: 'reference', candidateVariant: 'reference' }).available, false);
});
