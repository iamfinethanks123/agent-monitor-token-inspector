import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const root = await mkdtemp(path.join(os.tmpdir(), 'quota-loading-ui-')); const traces = path.join(root, 'traces'); const data = path.join(root, 'data'); let app;
try {
  await mkdir(traces); await writeFile(path.join(traces, 'run.jsonl'), [{ type: 'session_meta', payload: { id: 'quota-loading', model_provider: 'openai' } }, { type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'token_count', rate_limits: { limit_id: 'codex', primary: { used_percent: 12.345, window_minutes: 270 } } } }].map(value => JSON.stringify(value)).join('\n') + '\n');
  app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [process.cwd(), `--user-data-dir=${data}`], env: { ...process.env, AGENT_MONITOR_TRACE_ROOT: traces, AGENT_MONITOR_USER_DATA: data, ELECTRON_USER_DATA_DIR: data, AGENT_MONITOR_RECEIVER_PORT: '0', ELECTRON_IS_DEV: '0' } });
  const page = await app.firstWindow(); const sample = await page.evaluate(() => window.tokenInspector.quotas());
  await app.evaluate(({ ipcMain }, value) => {
    globalThis.quotaFixture = { sample: value, waiters: [], calls: 0 };
    ipcMain.removeHandler('inspector:quotas'); ipcMain.handle('inspector:quotas', () => { const fixture = globalThis.quotaFixture; fixture.calls++; return new Promise((resolve, reject) => fixture.waiters.push({ resolve, reject })); });
  }, sample);
  await page.getByRole('button', { name: /^數據品質$/ }).click(); await page.getByRole('button', { name: /額度記錄/ }).click(); const panel = page.getByRole('region', { name: 'Recorded quota windows' });
  await expect(panel).toContainText('額度快照讀取中'); await expect(panel).not.toContainText('未有可用嘅被動額度資料');
  await app.evaluate(({ BrowserWindow }) => { for (let i = 0; i < 30; i++) BrowserWindow.getAllWindows()[0].webContents.send('inspector:changed'); });
  await page.waitForTimeout(10500);
  expect(await app.evaluate(() => globalThis.quotaFixture.calls)).toBe(1);
  await app.evaluate(() => { const f = globalThis.quotaFixture; f.waiters.shift().resolve(f.sample); });
  await expect(panel).toContainText('12.345%'); await expect.poll(() => app.evaluate(() => globalThis.quotaFixture.calls)).toBe(2);
  await app.evaluate(() => globalThis.quotaFixture.waiters.shift().reject(new Error('FIXTURE_QUOTA_FAILURE')));
  await expect(panel.getByRole('alert')).toBeVisible(); await expect(panel).toContainText('12.345%');
  await page.getByLabel('Time range', { exact: true }).selectOption('7');
  await expect(panel).not.toContainText('12.345%'); await expect(panel).toContainText('額度快照讀取中');
  await expect.poll(() => app.evaluate(() => globalThis.quotaFixture.calls)).toBe(3);
  await app.evaluate(() => { const f = globalThis.quotaFixture; f.waiters.shift().resolve({ ...f.sample, snapshots: [], history: [], state: 'unavailable' }); });
  await expect(panel).toContainText('未有可用嘅被動額度資料');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('monitor:privacy-changed'));
  await expect.poll(() => app.evaluate(() => globalThis.quotaFixture.calls)).toBe(4);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.send('monitor:privacy-changed'); });
  await app.evaluate(() => { const f = globalThis.quotaFixture; const old = structuredClone(f.sample); old.snapshots[0].primary.usedPercent = '16.666'; f.waiters.shift().resolve(old); });
  await expect.poll(() => app.evaluate(() => globalThis.quotaFixture.calls)).toBe(5); await expect(panel).not.toContainText('16.666%');
  await app.evaluate(() => { const f = globalThis.quotaFixture; const current = structuredClone(f.sample); current.snapshots[0].primary.usedPercent = '5.432'; f.waiters.shift().resolve(current); });
  await expect(panel).toContainText('5.432%');
  console.log('PASS: quota reader coalesces30notifications, preserves valid data onfailure, separatesloading/empty, clearsnewscope anddiscards pre-privacy responses; isolated IPC gates only');
} finally { if (app) await app.close(); await rm(root, { recursive: true, force: true }); }
