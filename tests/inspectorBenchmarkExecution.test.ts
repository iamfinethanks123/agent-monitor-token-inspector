import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { BenchmarkRunner } from '../src/main/BenchmarkRunner';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { saveContract, importTrial, experiments } from '../src/benchmarks/experiments';
import { benchmarkExecutions, recordBenchmarkExecution, recoverInterruptedBenchmarks } from '../src/benchmarks/executions';
import { report } from '../src/reporting/report';
import { deleteSource } from '../src/storage/privacy';

const runtime = path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
async function fixture(script: string, timeoutSeconds = 5, outputs = ['result.json']) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'benchmark-execution-')); const store = new InspectorStore(path.join(root, 'index.sqlite'));
  await writeFile(path.join(root, 'session.jsonl'), JSON.stringify({ type: 'session_meta', payload: { id: 'owned-acceptance', model_provider: 'openai' } }) + '\n'); await new IndexCollector(store, [root]).scan();
  const contract = saveContract(store, { runId: 'owned-acceptance', objective: 'Fixture task', acceptance: 'User-reviewed assertions', environment: 'fixture' });
  await writeFile(path.join(root, 'check.cjs'), script); const filename = path.join(root, 'benchmark.json');
  await writeFile(filename, JSON.stringify({ schema: 'local-benchmark/1', suiteId: 'fixture-suite', entry: 'check.cjs', files: ['check.cjs'], args: [], outputs, timeoutSeconds }));
  const runner = new BenchmarkRunner(runtime, async value => recordBenchmarkExecution(store, value), () => {});
  const prepare = () => runner.prepare(filename, contract.id, contract.revision);
  return { root, store, runner, contract, filename, prepare, async close() { await runner.stop(); store.close(); await rm(root, { recursive: true, force: true }); } };
}

test('approved frozen input runs produce immutable numeric artifacts and preserve unreviewed population', { skip: process.platform !== 'darwin' }, async () => {
  const f = await fixture("const fs=require('node:fs');fs.writeFileSync(process.env.BENCHMARK_OUTPUT_DIR+'/result.json',JSON.stringify({schema:'local-test-metrics/1',tests:2,passed:2,failed:0,skipped:0}));console.log('PRIVATE_OUTPUT_MARKER');");
  try {
    const preview = await f.prepare(); const original = await readFile(path.join(f.root, 'check.cjs'));
    await writeFile(path.join(f.root, 'check.cjs'), "throw new Error('changed after preview')");
    const execution = await f.runner.run(preview.id); assert.equal(execution.status, 'completed'); assert.equal(execution.exitCode, 0); assert.equal(execution.acceptance, 'unreviewed'); assert.equal(execution.outputFiles[0].summary!.passed, 2); assert.equal(execution.issues.length, 0);
    assert.equal(execution.inputFiles[0].sha256, preview.files[0].sha256); assert.equal(execution.contentRetained, false); assert.equal(JSON.stringify(execution).includes('PRIVATE_OUTPUT_MARKER'), false);
    let population = experiments(f.store, f.contract.id); assert.equal(population.trials.length, 1); assert.equal(population.trials[0].acceptanceReviewed, false); assert.equal(population.trials[0].tokens, null); assert.equal(f.store.summary().usage.total.value, null);
    const trial = importTrial(f.store, { id: `local:${execution.id}`, contractId: f.contract.id, contractRevision: f.contract.revision, runId: null, variant: 'fixture-A', outcome: 'verified_success', acceptanceReviewed: true, evidenceRefs: [], environment: 'fixture', cacheCondition: 'unknown', excludedReason: null, executionId: execution.id, artifactRefs: ['output:1'] });
    assert.equal(trial.execution!.planDigest, execution.planDigest); assert.equal(trial.tokens, null); population = experiments(f.store, f.contract.id); assert.equal(population.trials.length, 1); assert.equal(population.trials[0].outcome, 'verified_success');
    assert.throws(() => recordBenchmarkExecution(f.store, { ...execution, exitCode: 99 }), /IMMUTABLE/);
    assert.throws(() => importTrial(f.store, { ...trial, id: 'another', createdAt: undefined }), /INVALID_RECORD/);
    const exported = JSON.parse(report(f.store, {}, 'json', { contractId: f.contract.id }).body); assert.equal(JSON.stringify(exported).includes(execution.inputFiles[0].sha256), false); assert.equal(exported.outcomes[0].execution.outputFiles[0].summary.passed, 2);
    assert.notDeepEqual(await readFile(path.join(f.root, 'check.cjs')), original);
    deleteSource(f.store, f.store.sources()[0].id); assert.equal(benchmarkExecutions(f.store).length, 0); assert.equal(experiments(f.store, f.contract.id).trials.length, 0);
    assert.throws(() => recordBenchmarkExecution(f.store, { ...execution, id: '22222222-2222-4222-8222-222222222222' }), /SCOPE_UNAVAILABLE/);
  } finally { await f.close(); }
});

test('local guardrails deny ordinary external reads, input writes, child execution and network access', { skip: process.platform !== 'darwin' }, async () => {
  const f = await fixture("const fs=require('node:fs'),cp=require('node:child_process'),net=require('node:net');let checks=0;for(const fn of [()=>fs.readFileSync('/etc/passwd'),()=>fs.writeFileSync('check.cjs','overwrite'),()=>cp.spawnSync('/usr/bin/true')]){try{fn();process.exit(8);}catch(e){if(e.code!=='ERR_ACCESS_DENIED')throw e;checks++;}}const s=net.connect({host:'127.0.0.1',port:1});s.once('error',()=>{checks++;fs.writeFileSync(process.env.BENCHMARK_OUTPUT_DIR+'/result.json',JSON.stringify({schema:'local-test-metrics/1',tests:checks,passed:checks,failed:0,skipped:0}));});");
  try { const execution = await f.runner.run((await f.prepare()).id); assert.equal(execution.status, 'completed'); assert.equal(execution.outputFiles[0].summary!.tests, 4); assert.equal(execution.network, 'os_denied'); }
  finally { await f.close(); }
});

test('timeout/failure records remain visible and unsafe bundle paths/symlinks are rejected', { skip: process.platform !== 'darwin' }, async () => {
  const f = await fixture('setInterval(()=>{},1000);', 1, []);
  try {
    const timeout = await f.runner.run((await f.prepare()).id); assert.equal(timeout.status, 'timed_out'); assert.equal(experiments(f.store, f.contract.id).trials.length, 1);
    await writeFile(path.join(f.root, 'check.cjs'), 'process.exit(2)');
    const failureBundle = JSON.parse(await readFile(f.filename, 'utf8')); await writeFile(f.filename, JSON.stringify({ ...failureBundle, timeoutSeconds: 10 }));
    const failed = await f.runner.run((await f.prepare()).id); assert.equal(failed.status, 'failed'); assert.equal(failed.exitCode, 2); assert.equal(benchmarkExecutions(f.store).length, 2); assert.equal(experiments(f.store, f.contract.id).trials.length, 2);
    const bundle = JSON.parse(await readFile(f.filename, 'utf8')); await writeFile(f.filename, JSON.stringify({ ...bundle, files: ['../outside.cjs'] })); await assert.rejects(f.prepare(), /PATH/);
    await symlink(path.join(f.root, 'check.cjs'), path.join(f.root, 'link.cjs')); await writeFile(f.filename, JSON.stringify({ ...bundle, entry: 'link.cjs', files: ['link.cjs'] })); await assert.rejects(f.prepare(), /SYMLINK/);
  } finally { await f.close(); }
});

test('cancellation and startup interruption cannot become successful accepted executions', { skip: process.platform !== 'darwin' }, async () => {
  const f = await fixture('setInterval(()=>{},1000);', 10, []);
  try {
    const task = f.runner.run((await f.prepare()).id); let running;
    for (let i = 0; i < 100; i++) { running = benchmarkExecutions(f.store).find(value => value.status === 'running'); if (running) break; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.ok(running); f.runner.cancel(running.id); const cancelled = await task; assert.equal(cancelled.status, 'cancelled');
    const interrupted = { ...cancelled, id: '11111111-1111-4111-8111-111111111111', status: 'running', completedAt: null, elapsedMs: null, exitCode: null, issues: [] }; recordBenchmarkExecution(f.store, interrupted); recoverInterruptedBenchmarks(f.store);
    assert.equal(benchmarkExecutions(f.store).find(value => value.id === interrupted.id)!.status, 'interrupted'); assert.equal(experiments(f.store, f.contract.id).trials.length, 2);
  } finally { await f.close(); }
});
