import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const root = await mkdtemp(path.join(os.tmpdir(), 'task-scope-native-'));
const traces = path.join(root, 'traces'); const userData = path.join(root, 'user-data');
let app;
try {
  await mkdir(traces);
  await writeFile(path.join(traces, 'run.jsonl'), JSON.stringify({ type: 'session_meta', payload: { id: 'task-scope-native', model_provider: 'openai' } }) + '\n');
  app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [process.cwd(), `--user-data-dir=${userData}`], env: { ...process.env, AGENT_MONITOR_TRACE_ROOT: traces, AGENT_MONITOR_USER_DATA: userData, ELECTRON_USER_DATA_DIR: userData, AGENT_MONITOR_RECEIVER_PORT: '0', ELECTRON_IS_DEV: '0' } });
  const page = await app.firstWindow();
  await expect.poll(() => page.evaluate(() => window.tokenInspector.sources().then(items => items.some(item => item.threadId === 'task-scope-native')))).toBe(true);
  await page.getByRole('button', { name: /^(任務結果與實驗|Outcomes & experiments)$/, exact: true }).click();
  await expect(page.getByRole('heading', { name: /先定義驗收|Define quality before/ })).toBeVisible();
  await page.getByLabel(/參考 Run|Reference run/).selectOption('task-scope-native');
  await page.getByLabel(/固定環境|Fixed environment/).fill('native-fixture');
  await page.getByLabel(/任務目標|Objective/).fill('Scope fixture');
  await page.getByLabel(/驗收條件|Acceptance criteria/).fill('Review assertions');
  const permitted = 'NATIVE_PERMITTED_SCOPE <script>window.scopeInjected=true</script>; API_KEY="NATIVE_SCOPE_SECRET"';
  await page.getByLabel('Task permitted scope', { exact: true }).fill(permitted);
  await page.getByRole('button', { name: /^(保存任務驗收|Save task contract)$/, exact: true }).click();
  await expect(page.getByLabel('Saved task permitted scope')).toContainText('NATIVE_PERMITTED_SCOPE');
  const contract = await page.evaluate(() => window.tokenInspector.experiments().then(view => view.contracts[0]));
  expect(contract.permittedScope).toBe(permitted);
  expect(await page.evaluate(() => window.scopeInjected)).toBeUndefined();
  await page.getByLabel('Benchmark contract').selectOption(contract.id);
  await expect(page.getByLabel('Benchmark permitted scope')).toContainText('NATIVE_PERMITTED_SCOPE');
  const hidden = await page.evaluate(id => window.tokenInspector.report({}, 'json', { contractId: id }), contract.id);
  expect(hidden.body).not.toContain('NATIVE_PERMITTED_SCOPE');
  const included = await page.evaluate(id => window.tokenInspector.report({}, 'json', { contractId: id, includeTaskNotes: true }), contract.id);
  expect(included.body).toContain('NATIVE_PERMITTED_SCOPE'); expect(included.body).not.toContain('NATIVE_SCOPE_SECRET');
  await page.screenshot({ path: '/tmp/agent-monitor-task-scope-native.png', fullPage: true });
  console.log('PASS: task-scope form saves through real IPC, selected contract/benchmark show stored scope as text, no script execution, export notes remain opt-in and redacted');
} finally { if (app) await app.close(); await rm(root, { recursive: true, force: true }); }
