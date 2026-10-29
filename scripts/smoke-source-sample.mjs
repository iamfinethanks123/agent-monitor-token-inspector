import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const root = await mkdtemp(path.join(os.tmpdir(), 'source-sample-native-')); const traces = path.join(root, 'traces'); const userData = path.join(root, 'user-data'); let app;
const lines = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const header = id => ({ type: 'session_meta', payload: { id, model_provider: 'openai', model: 'gpt-6-sol', cli_version: '0.162.0-alpha.17.2' } });
try {
  await mkdir(traces); await writeFile(path.join(traces, 'run.jsonl'), lines([header('enrolled-thread'), { type: 'token_usage_record', payload: { thread_id: 'enrolled-thread', response_id: 'real-fixture-response', usage: { input_tokens: 10, output_tokens: 2 } } }]));
  const sample = path.join(root, 'standalone.jsonl'); await writeFile(sample, lines([header('outside-sample-thread'), { timestamp: '2026-10-14T00:00:00Z', type: 'token_usage_record', payload: { thread_id: 'outside-sample-thread', response_id: 'outside-response', usage: { input_tokens: 999999, cached_input_tokens: 888888, output_tokens: 100, reasoning_output_tokens: 20 }, hidden_text: 'NATIVE_PRIVATE_SAMPLE_MARKER' } }]));
  app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [process.cwd(), `--user-data-dir=${userData}`], env: { ...process.env, AGENT_MONITOR_TRACE_ROOT: traces, AGENT_MONITOR_USER_DATA: userData, ELECTRON_USER_DATA_DIR: userData, AGENT_MONITOR_RECEIVER_PORT: '0', ELECTRON_IS_DEV: '0' } });
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await expect.poll(async () => (await page.evaluate(() => window.tokenInspector.summary())).usage.total.value, { timeout: 20000 }).toBe('12');
  const before = await page.evaluate(async () => ({ summary: await window.tokenInspector.summary(), sources: await window.tokenInspector.sources() }));
  await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, sample);
  await page.getByRole('button', { name: /設備與來源|Machines & sources/, exact: true }).click(); const panel = page.getByLabel('Local source sample inspection');
  await panel.getByRole('button', { name: /揀檔案並檢查樣本|Choose & inspect sample/ }).click();
  await expect(panel).toContainText(/可用：|Ready:/); await expect(panel).toContainText('0.162.0-alpha.17.2'); await expect(panel.locator('tbody tr')).toHaveCount(13);
  await expect(panel).not.toContainText('NATIVE_PRIVATE_SAMPLE_MARKER'); await expect(panel).not.toContainText('999999');
  const after = await page.evaluate(async () => ({ summary: await window.tokenInspector.summary(), sources: await window.tokenInspector.sources(), outside: await window.tokenInspector.ledger({ runId: 'outside-sample-thread' }) }));
  expect(after.summary.usage.total.value).toBe('12'); expect(after.summary.selectedEntries).toBe(before.summary.selectedEntries); expect(after.sources.length).toBe(before.sources.length); expect(after.outside.items.length).toBe(0);
  await panel.getByRole('button', { name: /清除樣本結果|Clear sample result/ }).click(); await expect(panel.locator('tbody tr')).toHaveCount(0);
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  await panel.getByRole('button', { name: /揀檔案並檢查樣本|Choose & inspect sample/ }).click(); await expect(panel.locator('tbody tr')).toHaveCount(0);
  const unsupported = path.join(root, 'unknown.jsonl'); await writeFile(unsupported, lines([{ type: 'unknown_usage', payload: { input_tokens: 999999 } }]));
  await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, unsupported);
  await panel.getByRole('button', { name: /揀檔案並檢查樣本|Choose & inspect sample/ }).click(); await expect(panel).toContainText(/呢個樣本未識別到支援記錄|No supported record recognized/);
  await page.screenshot({ path: '/tmp/agent-monitor-source-sample-smoke.png', fullPage: true }); if (errors.length) throw new Error(errors.join('; '));
  await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, sample);
  await writeFile(sample, lines([header('outside-sample-thread'), { type: 'token_usage_record', payload: { thread_id: 'outside-sample-thread', response_id: 'renamed-only', usage: { inputTokens: 999999, outputTokens: 100 }, hidden_text: 'NATIVE_PRIVATE_SAMPLE_MARKER' } }]));
  await panel.getByRole('button', { name: /揀檔案並檢查樣本|Choose & inspect sample/ }).click();
  await expect(panel).toContainText(/部分|有限|Partial/); await expect(panel).toContainText(/欄位格式未支援|unsupported field format/); await expect(panel).not.toContainText('999999');
  expect((await page.evaluate(() => window.tokenInspector.summary())).usage.total.value).toBe('12');
  console.log('PASS: native sample chooser/result, capability matrix, no body/value disclosure, unchanged ledger/sources, clear/cancel and unsupported format');
} finally { if (app) await app.close(); await rm(root, { recursive: true, force: true }); }
