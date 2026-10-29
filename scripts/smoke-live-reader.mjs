import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const root = await mkdtemp(path.join(os.tmpdir(), 'live-reader-native-'));
const traces = path.join(root, 'traces'); const userData = path.join(root, 'user-data'); let app;
try {
  await mkdir(traces); await writeFile(path.join(traces, 'run.jsonl'), JSON.stringify({ type: 'token_usage_record', payload: { thread_id: 'reader-fixture', response_id: 'one', usage: { input_tokens: 10, output_tokens: 2 } } }) + '\n');
  app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [process.cwd(), `--user-data-dir=${userData}`], env: { ...process.env, AGENT_MONITOR_TRACE_ROOT: traces, AGENT_MONITOR_USER_DATA: userData, ELECTRON_USER_DATA_DIR: userData, AGENT_MONITOR_RECEIVER_PORT: '0', ELECTRON_IS_DEV: '0' } });
  const page = await app.firstWindow(); await expect(page.locator('.inspector-hero strong').first()).toHaveText('12 tokens', { timeout: 20000 });
  const baseline = await page.evaluate(() => window.tokenInspector.diagnostics());
  await app.evaluate(({ ipcMain }, value) => {
    globalThis.readerActive = 0; globalThis.readerPeak = 0; globalThis.readerCompleted = 0;
    ipcMain.removeHandler('inspector:diagnostics');
    ipcMain.handle('inspector:diagnostics', async () => {
      globalThis.readerActive++; globalThis.readerPeak = Math.max(globalThis.readerPeak, globalThis.readerActive);
      try { await new Promise(resolve => setTimeout(resolve, 800)); globalThis.readerCompleted++; return value; }
      finally { globalThis.readerActive--; }
    });
    ipcMain.removeHandler('inspector:status');
    ipcMain.handle('inspector:status', () => ({ phase: 'ready', lastScanAt: new Date().toISOString(), errors: [], fingerprinting: 'unavailable' }));
  }, baseline);
  await page.getByRole('button', { name: /^(分析與建議|Findings)$/, exact: true }).click();
  await app.evaluate(({ BrowserWindow }) => { globalThis.readerChurn = setInterval(() => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('inspector:changed'); }, 50); });
  await page.waitForTimeout(2400);
  const during = await app.evaluate(() => ({ peak: globalThis.readerPeak, completed: globalThis.readerCompleted }));
  await app.evaluate(() => clearInterval(globalThis.readerChurn));
  expect(during.peak).toBe(1); expect(during.completed).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: /^(用量總覽|Overview)$/, exact: true }).click();
  await page.waitForTimeout(900);
  expect(await app.evaluate(() => globalThis.readerActive)).toBe(0);
  await expect(page.locator('.inspector-hero strong').first()).toHaveText('12 tokens');
  console.log('PASS: actual renderer coalesces 50ms change notices during an800ms diagnostics response to one active request and one pending reload; completed refreshes and navigation keep canonical usage12');
} finally { if (app) await app.close(); await rm(root, { recursive: true, force: true }); }
