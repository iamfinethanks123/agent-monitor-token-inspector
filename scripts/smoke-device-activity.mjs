import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const root = await mkdtemp(path.join(os.tmpdir(), 'device-activity-native-'));
const traces = path.join(root, 'traces'); const userData = path.join(root, 'user-data'); const pairFile = path.join(root, 'fixture.pairing.json');
let app;
try {
  await mkdir(traces);
  await writeFile(path.join(traces, 'run.jsonl'), JSON.stringify({ type: 'token_usage_record', payload: { thread_id: 'activity-native', response_id: 'one', usage: { input_tokens: 10, output_tokens: 2 } } }) + '\n');
  app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [process.cwd(), `--user-data-dir=${userData}`], env: { ...process.env, AGENT_MONITOR_TRACE_ROOT: traces, AGENT_MONITOR_USER_DATA: userData, ELECTRON_USER_DATA_DIR: userData, AGENT_MONITOR_RECEIVER_PORT: '0', ELECTRON_IS_DEV: '0' } });
  const page = await app.firstWindow();
  await expect(page.locator('.inspector-hero strong').first()).toHaveText('12 tokens', { timeout: 20000 });
  await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, pairFile);
  await page.evaluate(() => window.tokenInspector.enrollDevice('Activity fixture'));
  const config = JSON.parse(await readFile(pairFile, 'utf8'));
  const post = async (route, body, token) => {
    const response = await fetch(`${config.endpoint}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-device-id': config.deviceId, authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    expect(response.status).toBe(200); return response.json();
  };
  const paired = await post('/v2/pair', { workspaceId: config.workspaceId, deviceId: config.deviceId, pairingCode: config.pairingCode });
  await page.getByRole('button', { name: /^(設備與來源|Machines & sources)$/, exact: true }).click();
  const deviceRow = page.locator('.inspector-table').first().locator('tbody tr').filter({ hasText: 'Activity fixture' });
  await expect(deviceRow).toContainText('active');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  const summary = await page.evaluate(() => window.tokenInspector.summary());
  await app.evaluate(({ ipcMain }, value) => { globalThis.activitySummaryReads = 0; ipcMain.removeHandler('inspector:summary'); ipcMain.handle('inspector:summary', () => { globalThis.activitySummaryReads++; return value; }); }, summary);
  const health = { schemaVersion: 'collector-health/1', measuredAt: new Date().toISOString(), adapterVersion: 'codex-passive/1', sourceCount: 1, partialSources: 0, discoveryErrors: 0, records: 17, unsupportedRecords: 0, gapRecords: 0, semanticIssueRecords: 0, unparsedBytes: '0', lastSuccessfulReceiptAt: null };
  await post('/v2/heartbeat', { workspaceId: config.workspaceId }, paired.deviceToken);
  await post('/v2/collector-health', { workspaceId: config.workspaceId, health }, paired.deviceToken);
  const healthRow = page.getByLabel('Collector health reports').locator('tbody tr').filter({ hasText: 'Activity fixture' });
  await expect(healthRow).toContainText('1 / 17');
  await expect(deviceRow).toContainText(/最近三分鐘有認證連線|Authenticated contact within three minutes/);
  expect(await app.evaluate(() => globalThis.activitySummaryReads)).toBe(0);
  expect((await page.evaluate(() => window.tokenInspector.summary())).usage.total.value).toBe('12');
  await app.evaluate(({ ipcMain }) => { globalThis.activitySummaryReads = 0; });
  await page.getByRole('button', { name: /^(用量總覽|Overview)$/, exact: true }).click();
  await expect(page.locator('.inspector-hero strong').first()).toHaveText('12 tokens');
  const before = await page.evaluate(async () => (await window.tokenInspector.timeCharts({}, 1, 1)).buckets.length);
  expect(before).toBe(1);
  await post('/v2/heartbeat', { workspaceId: config.workspaceId }, paired.deviceToken);
  await expect.poll(() => page.evaluate(id => window.tokenInspector.deviceActivity().then(view => view.devices.find(item => item.id === id)?.online), config.deviceId)).toBe(true);
  expect(await app.evaluate(() => globalThis.activitySummaryReads)).toBe(0);
  await page.screenshot({ path: '/tmp/agent-monitor-device-activity-native.png', fullPage: true });
  console.log('PASS: authenticated heartbeat/health update the real device UI through lightweight IPC without summary reload; canonical12 tokens and minute charts remain available');
} finally { if (app) await app.close(); await rm(root, { recursive: true, force: true }); }
