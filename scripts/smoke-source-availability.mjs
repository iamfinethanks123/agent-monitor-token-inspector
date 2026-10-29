import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const directory = await mkdtemp(path.join(os.tmpdir(), 'source-availability-ui-')); const traces = path.join(directory, 'traces'); const data = path.join(directory, 'data'); const file = path.join(traces, 'run.jsonl'); let app;
try {
  await mkdir(traces); await writeFile(file, JSON.stringify({ type: 'token_usage_record', payload: { thread_id: 'source-availability-ui', response_id: 'one', usage: { input_tokens: 10, output_tokens: 2 } } }) + '\n');
  app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [process.cwd(), `--user-data-dir=${data}`], env: { ...process.env, AGENT_MONITOR_TRACE_ROOT: traces, AGENT_MONITOR_USER_DATA: data, ELECTRON_USER_DATA_DIR: data, AGENT_MONITOR_RECEIVER_PORT: '0', ELECTRON_IS_DEV: '0' } });
  const page = await app.firstWindow(); await page.getByRole('button', { name: /^數據品質$/ }).click();
  const panel = page.getByRole('region', { name: 'Original source availability' }); const check = panel.getByRole('button', { name: '檢查原始檔案', exact: true });
  await expect(page.locator('.inspector-content > section').first()).toHaveAttribute('aria-label', 'Original source availability');
  await expect(check).toBeEnabled({ timeout: 20000 });
  const before = await page.evaluate(async () => { const s = await window.tokenInspector.summary(); return { total: s.usage.total.value, revision: s.revision }; });
  expect(before.total).toBe('12'); await check.click(); await panel.getByText('逐個來源查看結果', { exact: true }).click();
  await expect(panel.locator('tbody tr')).toHaveCount(1); await expect(panel.locator('tbody tr')).toContainText('原始檔存在');
  await rm(file); await check.click(); await expect(panel.locator('tbody tr')).toContainText('原始路徑已不存在');
  await page.evaluate(async () => { const privacy = await window.tokenInspector.privacy(); await window.tokenInspector.setRoot(privacy.roots[0].id, false); });
  await check.click(); await expect(panel.locator('tbody tr')).toContainText('不在目前啟用嘅來源目錄');
  expect(await page.evaluate(async () => { const s = await window.tokenInspector.summary(); return { total: s.usage.total.value, revision: s.revision }; })).toEqual(before);
  console.log('PASS: actual worker/IPC/UI reports original-present then missing then disabled root, preserves12tokenledger/revision and never starts reparse; isolated temporary sources only');
} finally { if (app) await app.close(); await rm(directory, { recursive: true, force: true }); }
