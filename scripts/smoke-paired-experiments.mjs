import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const root = await mkdtemp(path.join(os.tmpdir(), 'paired-experiments-')); const traces = path.join(root, 'traces'); const data = path.join(root, 'data');
const executable = path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'); let app;
try {
  await mkdir(traces); await mkdir(path.join(data, 'inspector'), { recursive: true });
  const seed = spawnSync(executable, ['--import', 'tsx', '--input-type=module', '-e', `
    import {writeFile} from 'node:fs/promises';import path from 'node:path';import {InspectorStore} from './src/storage/InspectorStore.ts';import {IndexCollector} from './src/collector/IndexCollector.ts';import {saveContract,importTrial} from './src/benchmarks/experiments.ts';import {savePrice} from './src/accounting/prices.ts';
    const store=new InspectorStore(process.argv[1]);const traces=process.argv[2];
    try{for(let i=0;i<6;i++){const id='paired-'+i;const at=Date.now()-60000;const records=[{type:'session_meta',payload:{id,model_provider:'openai',cwd:'/synthetic/paired'}},{type:'turn_context',payload:{model:'gpt-paired-fixture'}},{type:'response_item',timestamp:new Date(at).toISOString(),payload:{type:'function_call',call_id:id,name:'exec_command',arguments:'{"cmd":"fixture-check"}'}},{type:'token_usage_record',timestamp:new Date(at+1000).toISOString(),payload:{thread_id:id,response_id:id,usage:{input_tokens:i<3?100+i*10:60+(i-3)*10,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:2}}},{type:'response_item',timestamp:new Date(at+2000).toISOString(),payload:{type:'function_call_output',call_id:id,output:'Process exited with code 0'}}];await writeFile(path.join(traces,id+'.jsonl'),records.map(row=>JSON.stringify(row)).join('\\n')+'\\n');}
    await new IndexCollector(store,[traces],'synthetic-pair-key').scan();
    savePrice(store,{provider:'openai',model:'gpt-paired-fixture',serviceTier:null,currency:'USD',effectiveAt:'2026-10-01T00:00:00Z',sourceUrl:'https://example.invalid/synthetic-price',asOf:'2026-10-01T00:00:00Z',reviewed:true,attribution:'requested_reviewed',cacheWritePolicy:'included',tiers:[{minimumInput:'0',inputRate:'1',cachedInputRate:'0.1',outputRate:'2'}]});
    const contract=saveContract(store,{runId:'paired-0',objective:'Synthetic paired comparison',acceptance:'Fixture checks pass',environment:'fixed',protocol:{suiteId:'fixture',datasetRevision:'data',repositoryRevision:'repo',acceptanceSuite:'checks',changedVariables:['tool_output'],ordering:'paired',minimumTrials:3}});
    for(let i=0;i<6;i++)importTrial(store,{id:'pair-trial-'+i,contractId:contract.id,contractRevision:1,runId:'paired-'+i,variant:i<3?'baseline':'bounded-output',outcome:'verified_success',acceptanceReviewed:true,evidenceRefs:[store.events({runId:'paired-'+i}).items.find(row=>row.kind==='response_item/function_call_output').evidenceRef],environment:'fixed',cacheCondition:'controlled',excludedReason:null,configuration:{datasetRevision:'data',repositoryRevision:'repo',model:'gpt-paired-fixture',configuration:'fixed',pairId:'pair-'+i%3,order:i+1,rerunOf:null,uncontrolledFactors:[]}});
    console.log(JSON.stringify({contractId:contract.id,total:store.summary().usage.total.value}));}finally{store.close();}
  `, path.join(data, 'inspector/index.sqlite'), traces], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
  if (seed.status !== 0) throw Error(seed.stderr); const seeded = JSON.parse(seed.stdout.trim()); expect(seeded.total).toBe('552');
  app = await electron.launch({ executablePath: executable, args: [process.cwd(), `--user-data-dir=${data}`], env: { ...process.env, AGENT_MONITOR_TRACE_ROOT: traces, AGENT_MONITOR_USER_DATA: data, ELECTRON_USER_DATA_DIR: data, AGENT_MONITOR_RECEIVER_PORT: '0', ELECTRON_IS_DEV: '0' } });
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: /^(任務結果與實驗|Outcomes & experiments)$/ }).click();
  const panel = page.getByRole('region', { name: 'Paired trial differences', exact: true }); await expect(panel).toBeVisible({ timeout: 20000 });
  await expect(panel.getByLabel('Paired reference variant')).toHaveValue(''); await expect(panel.getByLabel('Paired candidate variant')).toHaveValue('');
  await panel.getByLabel('Paired reference variant').selectOption('baseline'); await panel.getByLabel('Paired candidate variant').selectOption('bounded-output');
  await expect(panel).toContainText('6 筆已選變體試驗 · 3 個配對群組 · 3 對兩邊均已覆核成功');
  await expect(panel.locator('tbody tr')).toHaveCount(3); await expect(panel.locator('tbody tr').first().locator('td').nth(3)).toHaveText('-40');
  await panel.getByLabel('Paired comparison metric').selectOption('api:USD'); await expect(panel.locator('tbody tr').first().locator('td').nth(3)).toHaveText('-0.00004');
  await page.setViewportSize({ width: 1440, height: 960 }); await mkdir('tmp', { recursive: true }); await panel.screenshot({ path: 'tmp/paired-comparison-wide.png' });
  await page.setViewportSize({ width: 1000, height: 850 }); await panel.screenshot({ path: 'tmp/paired-comparison-narrow.png' });
  const report = panel.getByRole('region', { name: 'Paired comparison report', exact: true }); await report.getByRole('combobox').selectOption('json');
  await report.getByRole('button', { name: '建立預覽', exact: true }).click(); const preview = report.getByLabel('Report preview page'); await expect(preview).toBeVisible();
  let body = '';
  for (let i = 0; i < 10; i++) { const text = await preview.textContent(); body += text; const next = report.getByRole('button', { name: '下一頁', exact: true }); if (await next.isDisabled()) break; await next.click(); await expect(preview).not.toHaveText(text); }
  await expect(report.getByRole('button', { name: '下一頁', exact: true })).toBeDisabled();
  const parsed = JSON.parse(body); expect(parsed.outcomes).toHaveLength(6); expect(parsed.experiment.pairedComparison.selection.referenceVariant).toBe('baseline'); expect(parsed.experiment.pairedComparison.pairs[0].metrics.find(metric => metric.key === 'tokens').delta).toBe('-40');
  const destination = path.join(root, 'paired-report.json'); await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
  await report.getByRole('button', { name: '保存呢份預覽', exact: true }).click(); await expect.poll(() => readFile(destination, 'utf8').catch(() => '')).toBe(body);
  const real = await page.evaluate(() => window.tokenInspector.experiments());
  await app.evaluate(({ ipcMain }) => { globalThis.pairGate = { calls: 0, waiters: [] }; ipcMain.removeHandler('inspector:experiments'); ipcMain.handle('inspector:experiments', () => { globalThis.pairGate.calls++; return new Promise(resolve => globalThis.pairGate.waiters.push(resolve)); }); });
  await page.getByLabel('Experiment contract filter').selectOption(seeded.contractId); await expect.poll(() => app.evaluate(() => globalThis.pairGate.calls)).toBe(1);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('monitor:privacy-changed')); await expect(panel).toHaveCount(0);
  await app.evaluate((_electron, sample) => { sample.trials[0].variant = 'PRE_PRIVACY_PAIRED'; globalThis.pairGate.waiters.shift()(sample); }, real);
  await expect.poll(() => app.evaluate(() => globalThis.pairGate.calls)).toBe(2); await expect(page.getByText('PRE_PRIVACY_PAIRED', { exact: true })).toHaveCount(0);
  await app.evaluate((_electron, sample) => globalThis.pairGate.waiters.shift()(sample), real); await expect(panel).toBeVisible();
  await expect(panel.getByLabel('Paired reference variant')).toHaveValue(''); await expect(panel.getByLabel('Paired candidate variant')).toHaveValue('');
  await app.evaluate((_electron, sample) => globalThis.pairGate.waiters.splice(0).forEach(resolve => resolve(sample)), real);
  expect((await page.evaluate(() => window.tokenInspector.summary())).usage.total.value).toBe('552'); expect(errors).toEqual([]);
  console.log('PASS: real six-trial/three-pair selection, exact token/USD differences, wide/narrow rendering, full paged JSON preview saved byte-exactly, privacy clearing/late-reply rejection and552-token ledger preservation');
} finally { if (app) await app.close(); await rm(root, { recursive: true, force: true }); }
