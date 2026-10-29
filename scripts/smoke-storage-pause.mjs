import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const root = await mkdtemp(path.join(os.tmpdir(), 'storage-pause-native-'));
const traces = path.join(root, 'traces');
const userData = path.join(root, 'user-data');
let app;
try {
  await mkdir(traces);
  await writeFile(path.join(traces, 'run.jsonl'), JSON.stringify({ type: 'token_usage_record', payload: { thread_id: 'storage-native', response_id: 'one', usage: { input_tokens: 10, output_tokens: 2 } } }) + '\n');
  app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [process.cwd(), `--user-data-dir=${userData}`], env: { ...process.env, AGENT_MONITOR_TRACE_ROOT: traces, AGENT_MONITOR_USER_DATA: userData, ELECTRON_USER_DATA_DIR: userData, AGENT_MONITOR_RECEIVER_PORT: '0', ELECTRON_IS_DEV: '0' } });
  const page = await app.firstWindow();
  await expect(page.locator('.inspector-hero strong').first()).toHaveText('12 tokens', { timeout: 20000 });
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    globalThis.storageReason = 'STORAGE_FULL'; globalThis.storageRetries = 0;
    ipcMain.removeHandler('inspector:status'); ipcMain.removeHandler('inspector:refresh');
    ipcMain.handle('inspector:status', () => ({ phase: globalThis.storageReason ? 'degraded' : 'ready', lastScanAt: new Date().toISOString(), errors: globalThis.storageReason ? [globalThis.storageReason] : [], fingerprinting: 'unavailable', ...(globalThis.storageReason ? { scanBlocked: { reason: globalThis.storageReason, detectedAt: new Date().toISOString() } } : {}) }));
    ipcMain.handle('inspector:refresh', () => { globalThis.storageRetries++; for (const window of BrowserWindow.getAllWindows()) window.webContents.send('inspector:changed'); return null; });
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('inspector:changed');
  });
  const banner = page.getByLabel('Indexing paused');
  await expect(banner).toContainText(/儲存空間不足|storage is full/);
  await expect(banner).toContainText(/自動掃描已停止|automatic scans are stopped/);
  await expect(page.locator('.inspector-hero strong').first()).toHaveText('12 tokens');
  await page.getByRole('button', { name: /^(用量帳本|Usage ledger)$/, exact: true }).click();
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: /重試索引|Retry indexing/ }).click();
  expect(await app.evaluate(() => globalThis.storageRetries)).toBe(1);
  await expect(banner).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => { globalThis.storageReason = 'STORAGE_PERMISSION_REQUIRED'; for (const window of BrowserWindow.getAllWindows()) window.webContents.send('inspector:changed'); });
  await expect(banner).toContainText(/資料庫未能寫入|database is not writable/);
  await page.screenshot({ path: '/tmp/agent-monitor-storage-pause-native.png', fullPage: true });
  await app.evaluate(() => { globalThis.storageReason = undefined; });
  await banner.getByRole('button', { name: /重試索引|Retry indexing/ }).click();
  await expect(banner).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.storageRetries)).toBe(2);
  expect((await page.evaluate(() => window.tokenInspector.summary())).usage.total.value).toBe('12');
  console.log('PASS: storage-full / write-permission action banners persist across views, explicit retry reaches IPC, recovery clears banner and canonical usage remains12');
} finally { if (app) await app.close(); await rm(root, { recursive: true, force: true }); }
