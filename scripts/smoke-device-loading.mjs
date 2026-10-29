import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const root = await mkdtemp(path.join(os.tmpdir(), 'device-loading-ui-')); const traces = path.join(root, 'traces'); const data = path.join(root, 'data'); let app;
try {
  await mkdir(traces); await writeFile(path.join(traces, 'run.jsonl'), JSON.stringify({ type: 'token_usage_record', payload: { thread_id: 'device-loading', response_id: 'one', usage: { input_tokens: 10, output_tokens: 2 } } }) + '\n');
  app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [process.cwd(), `--user-data-dir=${data}`], env: { ...process.env, AGENT_MONITOR_TRACE_ROOT: traces, AGENT_MONITOR_USER_DATA: data, ELECTRON_USER_DATA_DIR: data, AGENT_MONITOR_RECEIVER_PORT: '0', ELECTRON_IS_DEV: '0' } });
  const page = await app.firstWindow(); await expect.poll(() => page.evaluate(async () => (await window.tokenInspector.summary()).usage.total.value), { timeout: 20000 }).toBe('12');
  const activity = await page.evaluate(() => window.tokenInspector.deviceActivity());
  await app.evaluate(({ ipcMain }, value) => {
    const local = value.devices.find(device => device.state === 'local');
    globalThis.deviceLoadingFixture = { mode: 'pending', activity: { ...value, devices: [...value.devices, { ...local, id: 'fixture-remote', name: 'Fixture Windows', state: 'active', online: true, lastOnlineSeenAt: new Date().toISOString() }] }, local: value, activityWaiters: [], fullWaiters: [] };
    ipcMain.removeHandler('inspector:summary'); ipcMain.handle('inspector:summary', () => { throw new Error('FIXTURE_OTHER_METRIC_FAILURE'); });
    ipcMain.removeHandler('inspector:devices'); ipcMain.handle('inspector:devices', () => new Promise(resolve => globalThis.deviceLoadingFixture.fullWaiters.push(resolve)));
    ipcMain.removeHandler('inspector:device-activity'); ipcMain.handle('inspector:device-activity', () => {
      const f = globalThis.deviceLoadingFixture; if (f.mode === 'pending') return new Promise(resolve => f.activityWaiters.push(resolve));
      if (f.mode === 'error') throw new Error('FIXTURE_ACTIVITY_FAILURE'); return f.mode === 'empty' ? f.local : f.activity;
    });
  }, activity);
  await page.reload(); await page.getByRole('button', { name: /^數據品質$/ }).click(); await page.getByRole('button', { name: /設備健康/ }).click(); const health = page.getByRole('region', { name: 'Collector health reports' });
  await expect(health).toContainText('設備資料讀取中'); await expect(health).not.toContainText('未有配對遠端設備');
  await app.evaluate(() => { const f = globalThis.deviceLoadingFixture; f.mode = 'ready'; for (const resolve of f.activityWaiters.splice(0)) resolve(f.activity); });
  await expect(health).toContainText('Fixture Windows'); await expect(health).not.toContainText('設備資料讀取中'); await expect(health).not.toContainText('未有配對遠端設備');
  await page.getByRole('button', { name: /^設備與來源$/ }).click(); const deviceRow = page.locator('.inspector-table tbody tr').filter({ hasText: 'Fixture Windows' }).first();
  await expect(deviceRow).toBeVisible(); await expect(deviceRow.locator('td').nth(2)).toContainText('未知／未收到');
  await page.getByLabel('New device name').fill('Future collector'); await expect(page.getByRole('button', { name: '新增並匯出設定', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /^數據品質$/ }).click(); await page.getByRole('button', { name: /設備健康/ }).click();
  await app.evaluate(({ BrowserWindow }) => { globalThis.deviceLoadingFixture.mode = 'error'; BrowserWindow.getAllWindows()[0].webContents.send('inspector:devices-changed'); });
  await expect(health.getByRole('alert')).toContainText('設備狀態暫時未能更新'); await expect(health).toContainText('Fixture Windows'); await expect(health).not.toContainText('未有配對遠端設備');
  await app.evaluate(({ BrowserWindow }) => { globalThis.deviceLoadingFixture.mode = 'empty'; BrowserWindow.getAllWindows()[0].webContents.send('inspector:devices-changed'); });
  await expect(health).toContainText('未有配對遠端設備'); await expect(health.getByRole('alert')).toHaveCount(0);
  await app.evaluate(() => { const f = globalThis.deviceLoadingFixture; for (const resolve of f.fullWaiters.splice(0)) resolve({ ...f.local, devices: f.local.devices.map(device => ({ ...device, total: null })) }); });
  expect((await page.evaluate(() => window.tokenInspector.ledger())).items[0].usage.total.value).toBe('12');
  console.log('PASS: real renderer distinguishes loading/error/confirmed-empty, light activity initializes devices while full totals and other metrics are unavailable, unknown totals stayblank and12tokenledger is unchanged; isolated IPC gates only');
} finally { if (app) await app.close(); await rm(root, { recursive: true, force: true }); }
