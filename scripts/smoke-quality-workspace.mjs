import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const root = await mkdtemp(path.join(os.tmpdir(), 'quality-workspace-ui-')); const traces = path.join(root, 'traces'); const data = path.join(root, 'data'); let app;
try {
  await mkdir(traces); await writeFile(path.join(traces, 'run.jsonl'), [{ type: 'session_meta', payload: { id: 'quality-workspace', model_provider: 'openai' } }, { type: 'token_usage_record', timestamp: new Date().toISOString(), payload: { thread_id: 'quality-workspace', response_id: 'one', usage: { input_tokens: 10, output_tokens: 2 } } }, { type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'token_count', rate_limits: { limit_id: 'codex', primary: { used_percent: 12.345, window_minutes: 270 } } } }].map(value => JSON.stringify(value)).join('\n') + '\n');
  app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [process.cwd(), `--user-data-dir=${data}`], env: { ...process.env, AGENT_MONITOR_TRACE_ROOT: traces, AGENT_MONITOR_USER_DATA: data, ELECTRON_USER_DATA_DIR: data, AGENT_MONITOR_RECEIVER_PORT: '0', ELECTRON_IS_DEV: '0' } });
  const page = await app.firstWindow(); await expect.poll(() => page.evaluate(async () => (await window.tokenInspector.summary()).usage.total.value), { timeout: 20000 }).toBe('12');
  const samples = await page.evaluate(async () => ({ quality: await window.tokenInspector.dataQuality(), quotas: await window.tokenInspector.quotas() }));
  await app.evaluate(({ ipcMain }, values) => {
    globalThis.qualityWorkspaceReads = { quality: 0, quotas: 0, lastScope: null };
    ipcMain.removeHandler('inspector:data-quality'); ipcMain.handle('inspector:data-quality', (_event, query) => { globalThis.qualityWorkspaceReads.quality++; globalThis.qualityWorkspaceReads.lastScope = query; return values.quality; });
    ipcMain.removeHandler('inspector:quotas'); ipcMain.handle('inspector:quotas', () => { globalThis.qualityWorkspaceReads.quotas++; return values.quotas; });
  }, samples);
  await page.getByRole('button', { name: /^數據品質$/ }).click(); const modes = page.getByRole('navigation', { name: 'Data quality sections' });
  await expect(modes.getByRole('button')).toHaveCount(4); await expect(modes.getByRole('button', { name: /資料覆蓋/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Original source availability' })).toBeVisible(); await expect(page.getByRole('region', { name: 'Recorded quota windows' })).toHaveCount(0);
  expect((await app.evaluate(() => globalThis.qualityWorkspaceReads)).quotas).toBe(0);
  await modes.getByRole('button', { name: /設備健康/ }).click(); await expect(page.getByRole('region', { name: 'Collector health reports' })).toBeVisible(); await expect(page.getByRole('region', { name: 'Retained data quality' })).toHaveCount(0);
  await modes.getByRole('button', { name: /額度記錄/ }).click(); await expect(page.getByRole('region', { name: 'Recorded quota windows' })).toContainText('12.345%');
  await modes.getByRole('button', { name: /Monitor 資源/ }).click(); await expect(page.getByRole('heading', { name: 'Monitor 自身資源' })).toBeVisible(); await expect(page.getByRole('region', { name: 'Recorded quota windows' })).toHaveCount(0);
  const reads = await app.evaluate(() => ({ ...globalThis.qualityWorkspaceReads }));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('inspector:changed'));
  await page.waitForTimeout(150); expect((await app.evaluate(() => globalThis.qualityWorkspaceReads)).quotas).toBe(reads.quotas); expect((await app.evaluate(() => globalThis.qualityWorkspaceReads)).quality).toBe(reads.quality);
  await modes.getByRole('button', { name: /資料覆蓋/ }).focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('region', { name: 'Retained data quality' })).toBeVisible();
  await page.getByLabel('Time range', { exact: true }).selectOption('7'); await expect.poll(() => app.evaluate(() => globalThis.qualityWorkspaceReads.lastScope?.days)).toBe(7);
  expect((await page.evaluate(() => window.tokenInspector.summary())).usage.total.value).toBe('12');
  await mkdir('tmp', { recursive: true }); await page.setViewportSize({ width: 1440, height: 960 }); await page.screenshot({ path: 'tmp/quality-workspace-wide.png' });
  await page.setViewportSize({ width: 1000, height: 850 }); await page.screenshot({ path: 'tmp/quality-workspace-narrow.png' });
  console.log('PASS: fourqualitysections preservepanels/scope/12tokens, inactivequeriesstayunmounted, keyboardselectionworks andwide/narrowviews captured; isolateddataonly');
} finally { if (app) await app.close(); await rm(root, { recursive: true, force: true }); }
