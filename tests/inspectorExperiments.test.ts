import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { saveContract, importTrial, experiments } from '../src/benchmarks/experiments';
import { decimalDistribution, distribution } from '../src/benchmarks/comparison';
import { report } from '../src/reporting/report';
import { projectPolicy, setProjectPolicy } from '../src/storage/project-privacy';
import type { BenchmarkProtocol, TaskContract, TrialRecord } from '../src/shared/inspector';

const protocol: BenchmarkProtocol = { suiteId: 'fixture-suite', datasetRevision: 'data-v1', repositoryRevision: 'commit-1', acceptanceSuite: 'tests-v1', changedVariables: ['tool_output'], ordering: 'paired', minimumTrials: 3 };
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'inspector-experiments-')); const store = new InspectorStore(':memory:');
  for (let i = 0; i < 8; i++) {
    const thread = `trial-${i}`; const input = i < 3 ? 100 + i * 10 : i < 6 ? 60 + (i - 3) * 10 : 1;
    await writeFile(path.join(root, `${thread}.jsonl`), [
      { type: 'session_meta', payload: { id: thread, model_provider: 'openai', cli_version: '0.162.0-alpha.2', cwd: '/PRIVATE_PROJECT_PATH' } },
      { type: 'turn_context', payload: { model: 'gpt-test', turn_id: `turn-${i}` } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'PRIVATE_SOURCE_PROMPT' }] } },
      { type: 'response_item', timestamp: '2026-10-13T00:00:00Z', payload: { type: 'function_call', call_id: `call-${i}`, name: 'exec_command', arguments: JSON.stringify({ cmd: 'npm test' }) } },
      { type: 'token_usage_record', timestamp: '2026-10-13T00:00:01Z', payload: { thread_id: thread, response_id: `response-${i}`, usage: { input_tokens: input, cached_input_tokens: 0, output_tokens: 2 } } },
      { type: 'response_item', timestamp: '2026-10-13T00:00:02Z', payload: { type: 'function_call_output', call_id: `call-${i}`, output: 'Process exited with code 0\nPRIVATE_TOOL_OUTPUT' } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
  }
  const collector = new IndexCollector(store, [root], 'synthetic-fingerprint-key'); await collector.scan();
  const contract = saveContract(store, { runId: 'trial-0', objective: 'PRIVATE_OBJECTIVE ![pixel](https://example.invalid) <script>bad()</script>', acceptance: 'PRIVATE_ACCEPTANCE', environment: 'environment-1', protocol });
  const trial = (index: number, variant: string, extra: Partial<Omit<TrialRecord, 'resources' | 'tokens' | 'createdAt' | 'revision'>> = {}) => {
    const event = store.events({ runId: `trial-${index}` }).items.find(event => event.kind === 'response_item/function_call_output')!;
    return importTrial(store, { id: `fixture-trial-${index}`, contractId: contract.id, contractRevision: 1, runId: `trial-${index}`, variant, outcome: 'verified_success', acceptanceReviewed: true,
      evidenceRefs: [event.evidenceRef], environment: 'environment-1', cacheCondition: 'controlled', excludedReason: null,
      configuration: { datasetRevision: 'data-v1', repositoryRevision: 'commit-1', model: 'gpt-test', configuration: 'fixed-config', pairId: `pair-${index % 3}`, order: index + 1, rerunOf: null, uncontrolledFactors: ['PRIVATE_FACTOR_NOTE'] }, ...extra });
  };
  return { store, root, collector, contract, trial, async close() { store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('task permitted scope is retained explicitly and excluded from reports unless notes are selected', async () => {
  const f = await fixture();
  try {
    const contract = saveContract(f.store, { runId: 'trial-0', objective: 'Scope fixture', acceptance: 'Checks pass', environment: 'fixture', permittedScope: 'PRIVATE_PERMITTED_SCOPE; API_KEY="PRIVATE_SCOPE_SECRET"' });
    assert.equal(contract.permittedScope, 'PRIVATE_PERMITTED_SCOPE; API_KEY="PRIVATE_SCOPE_SECRET"');
    assert.equal(JSON.stringify(report(f.store, {}, 'json', { contractId: contract.id })).includes('PRIVATE_PERMITTED_SCOPE'), false);
    const included = report(f.store, {}, 'json', { contractId: contract.id, includeTaskNotes: true });
    assert(included.body.includes('PRIVATE_PERMITTED_SCOPE')); assert.equal(included.body.includes('PRIVATE_SCOPE_SECRET'), false);
    assert.equal(report(f.store, {}, 'markdown', { contractId: contract.id }).body.includes('PRIVATE\\_PERMITTED\\_SCOPE'), false);
    assert(report(f.store, {}, 'markdown', { contractId: contract.id, includeTaskNotes: true }).body.includes('PRIVATE\\_PERMITTED\\_SCOPE'));
    assert.throws(() => saveContract(f.store, { runId: 'trial-0', objective: 'Scope fixture', acceptance: 'Checks pass', environment: 'fixture', permittedScope: 42 }), /INVALID_RECORD/);
    assert.throws(() => saveContract(f.store, { runId: 'trial-0', objective: 'Scope fixture', acceptance: 'Checks pass', environment: 'fixture', permittedScope: 'x'.repeat(4001) }), /INVALID_RECORD/);
  } finally { await f.close(); }
});

test('quality-first paired comparisons retain exact immutable resource snapshots and report the complete population', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 6; i++) f.trial(i, i < 3 ? 'baseline' : 'bounded-output');
    const result = experiments(f.store); assert.equal(result.recommendation, 'bounded-output');
    assert.equal(result.variants.find(row => row.variant === 'bounded-output')!.distributions.tokens.median, '72');
    const imported = result.trials[0];
    await appendFile(path.join(f.root, 'trial-0.jsonl'), JSON.stringify({ type: 'token_usage_record', payload: { thread_id: 'trial-0', response_id: 'later-response', usage: { input_tokens: 1000, output_tokens: 10 } } }) + '\n');
    await f.collector.scan(); assert.equal(experiments(f.store).trials[0].tokens, imported.tokens);
    const json = JSON.parse(report(f.store, {}, 'json', { contractId: f.contract.id }).body);
    assert.equal(json.kind, 'experiment'); assert.equal(json.summary, null); assert.equal(json.outcomes.length, 6); assert.equal(json.experiment.completePopulation, true);
    assert.equal(json.outcomes[0].tokens, imported.tokens); assert.equal(json.outcomes[0].revision, imported.revision);
    assert.equal(json.experiment.recommendations[0].variant, 'bounded-output');
    const encoded = JSON.stringify(json); for (const secret of ['PRIVATE_SOURCE_PROMPT', 'PRIVATE_TOOL_OUTPUT', 'PRIVATE_PROJECT_PATH', 'PRIVATE_OBJECTIVE', 'PRIVATE_ACCEPTANCE', 'PRIVATE_FACTOR_NOTE']) assert.equal(encoded.includes(secret), false);
    const notes = report(f.store, {}, 'markdown', { contractId: f.contract.id, includeTaskNotes: true }).body;
    assert.equal(notes.includes(String.raw`PRIVATE\_OBJECTIVE`), true); assert.equal(notes.includes('<script>'), false); assert.equal(notes.includes('![pixel]('), false); assert.equal(notes.includes('PRIVATE_TOOL_OUTPUT'), false);
  } finally { await f.close(); }
});

test('a cheap failed or setup-failed variant stays in resources and cannot become the recommendation', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 6; i++) f.trial(i, i < 3 ? 'baseline' : 'cheap');
    f.trial(6, 'cheap', { outcome: 'verified_failure' });
    importTrial(f.store, { id: 'setup-failed', contractId: f.contract.id, contractRevision: 1, runId: null, variant: 'cheap', outcome: 'setup_failed', acceptanceReviewed: false, evidenceRefs: [], environment: 'environment-1', cacheCondition: 'unknown', excludedReason: null });
    const result = experiments(f.store); const cheap = result.variants.find(row => row.variant === 'cheap')!;
    assert.equal(result.trials.length, 8); assert.equal(result.recommendation, null); assert.equal(cheap.failedOrCancelled, 2); assert.equal(cheap.totalTokens, null);
    assert.equal(cheap.knownTokens, '219'); assert.equal(cheap.distributions.tokens.missing, 1);
    const csv = report(f.store, {}, 'csv', { contractId: f.contract.id, table: 'trials' }).body;
    assert.equal(csv.trim().split('\r\n').length, 9); assert.ok(csv.includes('setup_failed')); assert.ok(csv.includes('verified_failure'));
  } finally { await f.close(); }
});

test('selected paired comparisons export exact differences without changing full trial populations or privacy guards', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 6; i++) f.trial(i, i < 3 ? '=SUM(1)' : 'bounded-output');
    const options = { contractId: f.contract.id, table: 'paired-trials' as const, pairedComparison: { referenceVariant: '=SUM(1)', candidateVariant: 'bounded-output' } };
    const json = JSON.parse(report(f.store, {}, 'json', options).body);
    assert.equal(json.outcomes.length, 6); assert.equal(json.experiment.pairedComparison.pairs.length, 3);
    assert.deepEqual(json.experiment.pairedComparison.pairs.map((pair: { metrics: { key: string; delta: string | null }[] }) => pair.metrics.find(metric => metric.key === 'tokens')!.delta), ['-40', '-40', '-40']);
    assert.equal(json.experiment.pairedComparison.acceptedPairs, 3);
    assert.equal(json.experiment.recommendations[0].variant, 'bounded-output');
    const markdown = report(f.store, {}, 'markdown', options).body;
    assert(markdown.includes('## Paired trial differences')); assert(markdown.includes('difference -40'));
    assert.equal(JSON.stringify(json).includes('PRIVATE_FACTOR_NOTE'), false);
    const csv = report(f.store, {}, 'csv', options).body; assert(csv.includes("'=SUM(1)")); assert(csv.includes('candidate_minus_reference')); assert(csv.includes(',-40\r\n'));
    assert.throws(() => report(f.store, {}, 'json', { ...options, pairedComparison: { referenceVariant: 'missing', candidateVariant: 'bounded-output' } }), /PAIRED_COMPARISON_UNAVAILABLE/);
    assert.throws(() => report(f.store, {}, 'json', { ...options, table: 'trials' }), /INVALID_REPORT_OPTIONS/);
    assert.throws(() => report(f.store, {}, 'json', { ...options, contractId: undefined }), /INVALID_REPORT_OPTIONS/);
    assert.throws(() => report(f.store, {}, 'json', { contractId: f.contract.id, table: 'paired-trials' }), /INVALID_REPORT_OPTIONS/);
    const projectId = experiments(f.store).trials[0].resources!.projectIds[0];
    setProjectPolicy(f.store, { ...projectPolicy(f.store, projectId), allowExports: false });
    for (const format of ['json', 'markdown', 'csv']) assert.throws(() => report(f.store, {}, format, options), /PROJECT_EXPORT_RESTRICTED/);
  } finally { await f.close(); }
});

test('foreign evidence and duplicate scopes are rejected while noncomparable recorded conditions remain visible', async () => {
  const f = await fixture();
  try {
    const foreign = f.store.events({ runId: 'trial-7' }).items[0].evidenceRef;
    assert.throws(() => f.trial(0, 'baseline', { evidenceRefs: [foreign] }), /EVIDENCE_OUTSIDE_TRIAL/);
    f.trial(0, 'baseline'); assert.throws(() => f.trial(0, 'baseline', { id: 'duplicate-run' }), /RUN_ALREADY_IMPORTED/);
    for (let i = 1; i < 6; i++) f.trial(i, i < 3 ? 'baseline' : 'different-environment', i < 3 ? {} : { environment: 'environment-2' });
    const result = experiments(f.store); assert.equal(result.trials.length, 6); assert.equal(result.recommendation, null);
    assert.ok(result.recommendations[0].reasons.includes('INCOMPARABLE_FIXED_CONDITIONS'));
    assert.ok(result.variants.find(row => row.variant === 'different-environment')!.reasons.includes('FROZEN_CONDITIONS_MISMATCH'));
    const recorded = result.trials[0].configuration!;
    const mismatch = f.trial(7, 'wrong-model-label', { configuration: { ...recorded, model: 'gpt-other', order: 8 } });
    assert.ok(mismatch.resources!.issues.includes('DECLARED_MODEL_MISMATCH'));
    const limited = experiments(f.store, f.contract.id, 2); assert.equal(limited.truncated, true); assert.equal(limited.recommendation, null);
  } finally { await f.close(); }
});

test('analysis reports reconcile to their ledger revision and CSV text cannot become a formula', async () => {
  const f = await fixture();
  try {
    f.trial(0, '=HYPERLINK("https://example.invalid")');
    const result = report(f.store, { runId: 'trial-0' }, 'json'); const json = JSON.parse(result.body);
    assert.equal(json.generatedAtLedgerRevision, result.revision); assert.equal(json.summary.usage.total.value, '102'); assert.equal(json.entries.filter((entry: { selectionStatus: string }) => entry.selectionStatus === 'selected').length, 1);
    assert.equal(json.outcomes.length, 1); assert.equal(json.evidence.every((item: { availability: string }) => item.availability === 'indexed_reference_raw_not_rechecked'), true);
    const csv = report(f.store, {}, 'csv', { contractId: f.contract.id, table: 'trials' }).body; assert.ok(csv.includes("'=HYPERLINK"));
    assert.equal(distribution(['9007199254740993', '9007199254740994']).median, '9007199254740993.5');
    assert.equal(decimalDistribution(['0.000000000001', '0.000000000002']).median, '0.0000000000015');
    assert.throws(() => report(f.store, {}, 'html'), /INVALID_FORMAT/);
    assert.throws(() => report(f.store, {}, 'json', { includeRawText: true }), /INVALID_REPORT_OPTIONS/);
  } finally { await f.close(); }
});

test('report membership covers more than one interactive ledger page and preserves run scope', async () => {
  const f = await fixture();
  try {
    await appendFile(path.join(f.root, 'trial-0.jsonl'), Array.from({ length: 250 }, (_, index) => JSON.stringify({ type: 'token_usage_record', timestamp: '2026-10-13T00:00:03Z',
      payload: { thread_id: 'trial-0', response_id: `report-response-${index}`, usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } } })).join('\n') + '\n');
    await f.collector.scan();
    const json = JSON.parse(report(f.store, { runId: 'trial-0' }, 'json').body);
    assert.equal(json.entries.length, 251);
    assert.equal(new Set(json.entries.map((entry: { id: string }) => entry.id)).size, 251);
    assert.ok(json.entries.every((entry: { identity: { threadId: string } }) => entry.identity.threadId === 'trial-0'));
    assert.equal(json.summary.usage.total.value, '602');
  } finally { await f.close(); }
});
