import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const root = await mkdtemp(path.join(os.tmpdir(), 'trial-timing-ui-')); const traces = path.join(root, 'traces'); const data = path.join(root, 'data'); let app;
const stamp = seconds => new Date(Date.UTC(2026, 9, 15, 0, 0, seconds)).toISOString();
const call = (id, seconds) => ({ type: 'response_item', timestamp: stamp(seconds), payload: { type: 'function_call', name: 'exec_command', call_id: id, arguments: '{}' } });
const output = (id, seconds) => ({ type: 'response_item', timestamp: stamp(seconds), payload: { type: 'function_call_output', call_id: id, output: 'Process exited with code 0' } });
try {
  await mkdir(traces);
  for (const variant of ['partial-snapshot', 'complete-snapshot']) {
    const records = [{ type: 'session_meta', payload: { id: variant, model_provider: 'openai' } }, call('a', 0), call('b', 2), output('a', 4), output('b', 6), ...(variant.startsWith('partial') ? [call('open', 7)] : []), { type: 'token_usage_record', timestamp: stamp(8), payload: { thread_id: variant, response_id: 'one', usage: { input_tokens: 10, output_tokens: 2 } } }];
    await writeFile(path.join(traces, variant + '.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n');
  }
  app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [process.cwd(), `--user-data-dir=${data}`], env: { ...process.env, AGENT_MONITOR_TRACE_ROOT: traces, AGENT_MONITOR_USER_DATA: data, ELECTRON_USER_DATA_DIR: data, AGENT_MONITOR_RECEIVER_PORT: '0', ELECTRON_IS_DEV: '0' } });
  const page = await app.firstWindow();
  await expect.poll(() => page.evaluate(async () => (await window.tokenInspector.summary()).usage.total.value), { timeout: 20000 }).toBe('24');
  await page.evaluate(async () => {
    const api = window.tokenInspector; const contract = await api.saveContract({ runId: 'partial-snapshot', objective: 'Isolated tool timing snapshots', acceptance: 'Not independently reviewed', environment: 'fixture' });
    for (const variant of ['partial-snapshot', 'complete-snapshot']) await api.importTrial({ id: variant, contractId: contract.id, contractRevision: 1, runId: variant, variant, outcome: 'unverified', acceptanceReviewed: false, evidenceRefs: [], environment: 'fixture', cacheCondition: 'unknown', excludedReason: null });
  });
  await page.getByRole('button', { name: /^任務結果與實驗$/ }).click();
  const snapshots = page.locator('section').filter({ has: page.getByRole('heading', { name: '全部試驗與資源快照', exact: true }) });
  const partial = snapshots.locator('tbody tr').filter({ hasText: 'partial-snapshot' }).getByTestId('recorded-tool-intervals');
  const complete = snapshots.locator('tbody tr').filter({ hasText: 'complete-snapshot' }).getByTestId('recorded-tool-intervals');
  await expect(partial).toContainText('6,000'); await expect(partial).toContainText('2 / 3'); await expect(partial).toContainText('1 / 0'); await expect(partial).toContainText('只顯示已知小計');
  await expect(complete).toContainText('6,000'); await expect(complete).toContainText('2 / 2'); await expect(complete).not.toContainText('只顯示已知小計');
  const view = await page.evaluate(() => window.tokenInspector.experiments());
  expect(view.variants.find(item => item.variant === 'partial-snapshot').distributions.toolIntervalUnionMs.missing).toBe(1);
  expect(view.variants.find(item => item.variant === 'complete-snapshot').distributions.toolIntervalUnionMs.median).toBe('6000');
  expect((await page.evaluate(() => window.tokenInspector.summary())).usage.total.value).toBe('24');
  console.log('PASS: actual worker/IPC/UI frozen timing rows distinguish6s union fromparallel8s sum, partial2/3 vscomplete2/2, missing timing distribution and24tokens; no model or benchmark execution');
} finally { if (app) await app.close(); await rm(root, { recursive: true, force: true }); }
