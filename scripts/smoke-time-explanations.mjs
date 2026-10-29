import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const root = await mkdtemp(path.join(os.tmpdir(), 'time-explanations-'));
const traces = path.join(root, 'traces'); const data = path.join(root, 'data'); let app;
try {
  await mkdir(traces);
  for (const [id, model, cache] of [['unknown', null, null], ['known', 'gpt-6.1-sol', 0]]) {
    const records = [{ type: 'session_meta', payload: { id, model_provider: 'openai' } }, { type: 'token_usage_record', timestamp: new Date(Date.now() - 10000).toISOString(), payload: { thread_id: id, response_id: id, ...(model ? { model, service_tier: 'standard' } : {}), usage: { input_tokens: 10, output_tokens: 2, ...(cache === null ? {} : { cached_input_tokens: cache }) } } }];
    await writeFile(path.join(traces, `${id}.jsonl`), records.map(value => JSON.stringify(value)).join('\n') + '\n');
  }
  app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [process.cwd(), `--user-data-dir=${data}`], env: { ...process.env, AGENT_MONITOR_TRACE_ROOT: traces, AGENT_MONITOR_USER_DATA: data, ELECTRON_USER_DATA_DIR: data, AGENT_MONITOR_RECEIVER_PORT: '0', ELECTRON_IS_DEV: '0' } });
  const page = await app.firstWindow(); const panel = page.getByRole('region', { name: '時間分析圖表', exact: true });
  await expect(panel.getByRole('button', { name: '解釋範圍小計及缺少資料', exact: true })).toBeVisible({ timeout: 20000 });
  await panel.getByLabel('Chart time window', { exact: true }).selectOption('1');
  await expect(panel.locator('.time-dashboard-summary strong').first()).not.toHaveText('—');
  const chart = panel.locator('article').filter({ has: page.getByRole('heading', { name: '美金估算走勢', exact: true }) });
  await chart.getByRole('img').focus(); await page.keyboard.press('Home'); await page.keyboard.press('End');
  await chart.getByRole('button', { name: '解釋呢格數字', exact: true }).focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Metric provenance', exact: true });
  await expect(dialog).toContainText('2 筆記錄 · 1 筆未定價'); await expect(dialog).toContainText('未完整保留欄位');
  await expect(dialog).toContainText('分母為零時百分比未定義'); await expect(dialog).toContainText('價目版本');
  await page.keyboard.press('Escape'); await expect(chart.getByRole('button', { name: '解釋呢格數字', exact: true })).toBeFocused();
  const groups = panel.locator('article').filter({ has: page.getByRole('heading', { name: '模型用量分佈', exact: true }) });
  await groups.getByRole('button', { name: /^模型未知/ }).click();
  await expect(dialog).toContainText('兩者都缺少先列為模型未知'); await expect(dialog).toContainText('未定價成員唔當成 $0');
  const frozen = await dialog.textContent();
  await page.evaluate(() => window.tokenInspector.setManualUsd({ mode: 'uniform', uniformRate: '2' }));
  await expect.poll(() => page.evaluate(() => window.tokenInspector.manualUsd().then(value => value.price.mode))).toBe('uniform');
  expect(await dialog.textContent()).toBe(frozen); await page.keyboard.press('Escape');
  await groups.getByRole('button', { name: /^模型未知/ }).click();
  await expect(dialog).toContainText('每百萬 Token 均一價目: 2 USD'); await expect(dialog).toContainText('0 筆未定價');
  await page.keyboard.press('Escape');
  await panel.getByRole('button', { name: '解釋範圍小計及缺少資料', exact: true }).click();
  await expect(dialog).toContainText('2 筆已選成員'); await expect(dialog).toContainText('所選最近時間視窗'); await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 960 }); await mkdir('tmp', { recursive: true });
  await chart.screenshot({ path: 'tmp/time-explanations-chart.png' });
  await page.setViewportSize({ width: 1000, height: 850 }); await groups.screenshot({ path: 'tmp/time-explanations-group.png' });

  const currentCharts = await page.evaluate(() => window.tokenInspector.timeCharts({}, 1, 1));
  // Gate only the isolated app's existing IPC to inspect failures and late replies.
  await app.evaluate(({ ipcMain }) => {
    globalThis.chartFixture = { calls: 0, waiters: [] };
    ipcMain.removeHandler('inspector:time-charts');
    ipcMain.handle('inspector:time-charts', () => { globalThis.chartFixture.calls++; return new Promise((resolve, reject) => globalThis.chartFixture.waiters.push({ resolve, reject })); });
  });
  const sample = await page.evaluate(() => window.tokenInspector.summary()); expect(sample.usage.total.value).toBe('24');
  const firstRead = await panel.getByText(/^圖表讀取於/).textContent();
  await panel.getByRole('button', { name: '更新圖表', exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.chartFixture.calls)).toBe(1);
  await app.evaluate(() => globalThis.chartFixture.waiters.shift().reject(Error('CHART_REFRESH_FAILED')));
  await expect(panel.getByRole('alert')).toContainText('保留上次結果同原有讀取時間');
  expect(await panel.getByText(/^圖表讀取於/).textContent()).toBe(firstRead);
  await panel.getByRole('button', { name: '重試讀取圖表', exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.chartFixture.calls)).toBe(2);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('monitor:privacy-changed'));
  await expect(panel.locator('article')).toHaveCount(0); await expect(panel.getByText(/^圖表讀取於/)).toHaveCount(0);
  const chartResult = { ...currentCharts, models: [{ id: 'PRE_PRIVACY_RESULT', total: '24', entries: 2, usdUnits: null, usdUpperUnits: null, usdUnpriced: 2 }] };
  await app.evaluate((_electron, value) => globalThis.chartFixture.waiters.shift().resolve(value), chartResult);
  await expect.poll(() => app.evaluate(() => globalThis.chartFixture.calls)).toBe(3);
  await expect(panel).not.toContainText('PRE_PRIVACY_RESULT');
  await app.evaluate(() => globalThis.chartFixture.waiters.shift().reject(Error('FIRST_PRIVATE_READ_FAILED')));
  await expect(panel.getByRole('alert')).toContainText('圖表暫時未能更新');
  await expect(panel).not.toContainText('讀取圖表中'); await expect(panel.locator('article')).toHaveCount(0);
  await panel.getByRole('button', { name: '重試讀取圖表', exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.chartFixture.calls)).toBe(4);
  await app.evaluate((_electron, value) => globalThis.chartFixture.waiters.shift().resolve({ ...value, models: [] }), chartResult);
  await expect(panel.getByRole('button', { name: '更新圖表', exact: true })).toBeEnabled();
  await expect(panel.getByText(/^圖表讀取於/)).toBeVisible();
  expect((await page.evaluate(() => window.tokenInspector.summary())).usage.total.value).toBe('24');
  console.log('PASS: real24-token chart data, per-bucket/group/scope explanations, fixed price snapshot, keyboard/focus, dated failed refresh, retry, privacy clearing and late-reply rejection; ledger unchanged');
} finally { if (app) await app.close(); await rm(root, { recursive: true, force: true }); }
