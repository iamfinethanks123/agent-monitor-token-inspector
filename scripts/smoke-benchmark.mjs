import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const root = await mkdtemp(path.join(os.tmpdir(), 'benchmark-native-')); const sources = path.join(root, 'traces'); const userData = path.join(root, 'user-data'); const bundle = path.join(root, 'bundle');
const executable = path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'); let app;
try {
  await mkdir(sources); await mkdir(bundle); await writeFile(path.join(sources, 'session.jsonl'), JSON.stringify({ type: 'session_meta', payload: { id: 'benchmark-native', model_provider: 'openai' } }) + '\n');
  await writeFile(path.join(bundle, 'check.cjs'), "const fs=require('node:fs');fs.writeFileSync(process.env.BENCHMARK_OUTPUT_DIR+'/result.json',JSON.stringify({schema:'local-test-metrics/1',tests:2,passed:2,failed:0,skipped:0}));console.log('PRIVATE_FIXTURE_OUTPUT');");
  const filename = path.join(bundle, 'benchmark.json'); await writeFile(filename, JSON.stringify({ schema: 'local-benchmark/1', suiteId: 'native-suite', entry: 'check.cjs', files: ['check.cjs'], args: [], outputs: ['result.json'], timeoutSeconds: 5 }));
  app = await electron.launch({ executablePath: executable, args: [process.cwd(), `--user-data-dir=${userData}`], env: { ...process.env, AGENT_MONITOR_TRACE_ROOT: sources, CODEX_HOME: path.join(root, 'codex-home'), HOME: path.join(root, 'home'), ELECTRON_USER_DATA_DIR: userData, AGENT_MONITOR_USER_DATA: userData, AGENT_MONITOR_RECEIVER_PORT: '0', ELECTRON_IS_DEV: '0' } });
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await expect.poll(async () => page.evaluate(async () => (await window.tokenInspector.sources()).some(source => source.threadId === 'benchmark-native')), { timeout: 20000 }).toBe(true);
  const contract = await page.evaluate(() => window.tokenInspector.saveContract({ runId: 'benchmark-native', objective: 'Synthetic local acceptance', acceptance: 'Review the fixture assertions', environment: 'fixture' }));
  await page.getByRole('button', { name: /任務結果與實驗|Outcomes & experiments/, exact: true }).click(); const panel = page.getByLabel('Controlled local benchmark');
  await panel.getByLabel('Benchmark contract').selectOption(contract.id);
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }, filename);
  await panel.getByRole('button', { name: /選擇驗收包及建立預覽|Select bundle and prepare preview/ }).click(); await expect(panel).toContainText('check.cjs');
  await panel.getByRole('button', { name: /確認並執行本機驗收|Confirm and run local acceptance/ }).click();
  await expect(panel).toContainText('completed', { timeout: 20000 }); await expect(panel).toContainText('2/2 passed');
  const data = await page.evaluate(id => window.tokenInspector.experiments(id), contract.id); expect(data.trials).toHaveLength(1); expect(data.trials[0].acceptanceReviewed).toBe(false);
  await panel.getByRole('button', { name: /覆核及記錄試驗|Review and record trial/ }).click(); await panel.getByLabel('Benchmark task outcome').selectOption('verified_success'); await panel.getByLabel('Benchmark acceptance reviewed').check();
  await panel.getByRole('button', { name: /保存覆核試驗|Save reviewed trial/ }).click();
  await expect.poll(async () => page.evaluate(async id => (await window.tokenInspector.experiments(id)).trials[0]?.outcome, contract.id)).toBe('verified_success');
  const result = await page.evaluate(id => window.tokenInspector.experiments(id), contract.id); expect(result.trials).toHaveLength(1); expect(result.trials[0].tokens).toBeNull();
  await page.screenshot({ path: '/tmp/agent-monitor-benchmark-smoke.png', fullPage: true });
  if (errors.length) throw new Error(errors.join('; ')); console.log('PASS: isolated native benchmark preview, approved offline execution, frozen metrics, unreviewed population and explicit acceptance review');
} finally { if (app) await app.close(); await rm(root, { recursive: true, force: true }); }
