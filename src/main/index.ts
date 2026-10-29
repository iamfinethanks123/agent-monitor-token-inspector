import { app, BrowserWindow, clipboard, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { constants, mkdirSync } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { TraceMonitor } from './trace-monitor/TraceMonitor';
import { HermesMonitor } from './trace-monitor/HermesMonitor';
import { MultiSourceMonitor } from './trace-monitor/MultiSourceMonitor';
import { InspectorService } from './InspectorService';
import { readAccountRateLimits, readAccountUsage } from './AccountUsage';
import { BenchmarkRunner } from './BenchmarkRunner';
import { inspectSourceSample } from '../collector/source-sample';
import { protectedFingerprintKey, workspaceFingerprintKey, fingerprintAccess } from './WorkspaceSecrets';
import { OFFLINE_MAX_BYTES, type OfflinePreview } from '../transport/offline';
import type { ProjectDeletionPlan, ProjectPrivacyPolicy } from '../shared/inspector';
import type { MonitorSnapshot } from '../shared/types';

let window: BrowserWindow | null = null;
let inspector: InspectorService | null = null;
let benchmarkRunner: BenchmarkRunner | null = null;
let fingerprintRetry: Promise<void> | undefined;
let accountUsageRead: ReturnType<typeof readAccountUsage> | undefined;
let accountRateLimitsRead: ReturnType<typeof readAccountRateLimits> | undefined;
app.setName('Agent Monitor Token Inspector');
const reportPreviews = new Map<string, { body: string; format: string; revision: number; projectIds: string[]; privacyVersion: string; createdAt: number }>();
let privacyFence = Promise.resolve();
let privacyEpoch = 0;
async function serializePrivacy<T>(task: () => Promise<T>): Promise<T> { const before = privacyFence; let release!: () => void; privacyFence = new Promise<void>(resolve => { release = resolve; }); await before; try { return await task(); } finally { release(); } }
function privacyChanged(): void { privacyEpoch++; reportPreviews.clear(); window?.webContents.send('monitor:privacy-changed'); void privateSnapshot(monitor.snapshot()).then(value => window?.webContents.send('monitor:changed', value)).catch(() => undefined); }
async function privateSnapshot(snapshot: MonitorSnapshot): Promise<MonitorSnapshot> {
  if (!inspector) throw new Error('INDEX_UNAVAILABLE');
  const epoch = privacyEpoch;
  const items = [...snapshot.agents.map(agent => ({ id: `agent:${agent.id}`, threadId: agent.threadId ?? '', sourcePath: agent.tracePath ?? '' })), ...snapshot.runs.map(run => { const root = snapshot.agents.find(agent => agent.runId === run.id && agent.type === 'main'); return { id: `run:${run.id}`, threadId: root?.threadId ?? run.id, sourcePath: root?.tracePath ?? '' }; })];
  const allowed = new Map<string, boolean>();
  for (let offset = 0; offset < items.length; offset += 2048) for (const item of await inspector.request('preview-permissions', items.slice(offset, offset + 2048)) as { id: string; allowed: boolean }[]) allowed.set(item.id, item.allowed);
  if (epoch !== privacyEpoch) throw new Error('PRIVACY_CHANGED');
  return { ...snapshot, errors: [...allowed.values()].some(value => !value) ? snapshot.errors.map(() => 'Source monitoring issue; details are restricted by project privacy.') : snapshot.errors, agents: snapshot.agents.map(agent => allowed.get(`agent:${agent.id}`) ? agent : { ...agent, activity: undefined, cwd: undefined, tracePath: undefined, role: undefined, nickname: undefined, agentPath: undefined }), runs: snapshot.runs.map(run => allowed.get(`run:${run.id}`) ? run : { ...run, title: undefined, cwd: undefined }) };
}
const offlinePreviews = new Map<string, { archive: unknown; createdAt: number }>();
const inspectorData = !app.isPackaged && process.env.AGENT_MONITOR_USER_DATA
  ? path.resolve(process.env.AGENT_MONITOR_USER_DATA)
  : path.join(app.getPath('appData'), 'Agent Monitor Token Inspector');
mkdirSync(inspectorData, { recursive: true, mode: 0o700 });
app.setPath('userData', inspectorData);
const idle = Number(process.env.AGENT_MONITOR_IDLE_MS);
const fileMonitor = new TraceMonitor({
  ...(process.env.AGENT_MONITOR_TRACE_ROOT ? {roots: [path.resolve(process.env.AGENT_MONITOR_TRACE_ROOT)]} : {}),
  ...(Number.isFinite(idle) && idle > 0 ? {idleMs: idle} : {}),
});
const monitor = new MultiSourceMonitor([
  ...(process.env.AGENT_MONITOR_TRACE_ROOT ? [] : [new HermesMonitor(Number.isFinite(idle) && idle > 0 ? {idleMs:idle} : {})]),
  fileMonitor,
]);
const developmentUrl = process.env.VITE_DEV_SERVER_URL;
// Packaged apps ship the icon as an extra resource; development reads it from build/ (icon.icns and icon.ico sit beside it).
const iconPath = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '../build/icon.png');
function assertSender(event: Electron.IpcMainInvokeEvent) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted IPC sender');
}
function createWindow() {
  window = new BrowserWindow({ show: false, width: 1500, height: 950, minWidth: 960, minHeight: 640, backgroundColor: '#0c1016', title: 'Agent Monitor · Token Inspector', icon: iconPath,
    // macOS: draw the window controls over the app's own header instead of a separate light title bar.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 20, y: 21 } } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.once('ready-to-show', () => { window?.show(); window?.maximize(); });
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on('closed', () => { window = null; });
  if (developmentUrl) {
    const parsed = new URL(developmentUrl);
    // scripts/dev.mjs may bind any free port; only a loopback Vite server in an unpackaged app is trusted.
    if (app.isPackaged || parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || !parsed.port) throw new Error('Unexpected development server URL');
    void window.loadURL(developmentUrl);
  } else void window.loadFile(path.join(__dirname, '../dist/index.html'));
}
if (process.argv.includes('--inspector-key-helper')) {
  void app.whenReady().then(() => {
    process.stdout.write(JSON.stringify({ phase: 'keychain' }) + '\n');
    const key = workspaceFingerprintKey(inspectorData);
    process.stdout.write(JSON.stringify({ key }) + '\n'); app.exit(0);
  }).catch(() => app.exit(1));
} else if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  void app.whenReady().then(async () => {
    app.setAccessibilitySupportEnabled(true);
    inspector = new InspectorService(path.join(inspectorData, 'inspector', 'index.sqlite'), process.env.AGENT_MONITOR_TRACE_ROOT ? [path.resolve(process.env.AGENT_MONITOR_TRACE_ROOT)] : undefined,
      process.env.AGENT_MONITOR_TRACE_ROOT ? undefined : path.join(app.getPath('appData'), 'com.gavinho.codexusage.multidevice', 'multi-device', 'usage.db'), await protectedFingerprintKey(), !app.isPackaged && process.env.AGENT_MONITOR_RECEIVER_PORT !== undefined ? Number(process.env.AGENT_MONITOR_RECEIVER_PORT) : 9897);
    for (const method of ['summary', 'ledger', 'ledger-explanation', 'total-explanation', 'total-explanation-page', 'events', 'timeline', 'content-search', 'timeline-state', 'timeline-investigations', 'scope-options', 'data-quality', 'model-transitions', 'sources', 'status', 'evidence', 'refresh', 'analytics', 'time-charts', 'legacy', 'diagnostics', 'agent-comparison', 'agent-purpose', 'comparison-annotate', 'tools', 'tool-activity', 'annotate', 'experiments', 'run-task', 'benchmark-executions', 'contract', 'trial', 'budgets', 'budget', 'budget-remove', 'incidents', 'alerts-suppress', 'alerts-unsuppress', 'devices', 'revoke', 'prices', 'price-save', 'manual-usd', 'manual-usd-set', 'manual-usd-clear', 'privacy', 'root-set', 'retention-set', 'reindex', 'reparse-cancel', 'reparse-state', 'quotas', 'manifests', 'context-attribution', 'manifest-consent']) {
      ipcMain.handle(`inspector:${method}`, (event, payload: unknown) => {
        assertSender(event);
        if (!inspector) throw new Error('INDEX_UNAVAILABLE');
        if (method === 'retention-set') return serializePrivacy(async () => { const plan = await inspector!.request('retention-plan', payload) as {policy:unknown;collectorTargets:number}; if(plan.collectorTargets&&window){const choice=await dialog.showMessageBox(window,{type:'warning',buttons:['Cancel','Apply retention settings'],defaultId:0,cancelId:0,message:'套用整體保留設定到 Collector？ / Apply collector retention?',detail:`${plan.collectorTargets} 個已配對設備會喺下次成功連線後收到呢個設定。Client 採用中央同本機較嚴格嘅限制，可能移除已超期本機索引及待傳送副本；原始logs同舊匯出檔案保留。設備頁會顯示實際確認，離線或舊版Client唔當成已套用。
Enrolled collectors enforce the stricter central/local receipt-time limits after reconnecting; expired indexes and queued copies may be removed. Original logs remain. Application needs a collector receipt.`});if(choice.response!==1)return;}const result=await inspector!.request(method,plan.policy);privacyChanged();return result; });
        return inspector.request(method, payload);
      });
    }
    ipcMain.handle('inspector:source-availability', (event, ids: unknown) => { assertSender(event); if (!inspector) throw new Error('INDEX_UNAVAILABLE'); return inspector.request('source-availability', ids); });
    ipcMain.handle('inspector:account-usage', event => {
      assertSender(event);
      if (!accountUsageRead) accountUsageRead = readAccountUsage().finally(() => { accountUsageRead = undefined; });
      return accountUsageRead;
    });
    ipcMain.handle('inspector:account-rate-limits', event => {
      assertSender(event);
      if (!accountRateLimitsRead) accountRateLimitsRead = readAccountRateLimits().finally(() => { accountRateLimitsRead = undefined; });
      return accountRateLimitsRead;
    });
    ipcMain.handle('inspector:fingerprint-access', event => { assertSender(event); return fingerprintAccess(); });
    ipcMain.handle('inspector:device-activity', event => { assertSender(event); if (!inspector) throw new Error('INDEX_UNAVAILABLE'); return inspector.request('device-activity'); });
    ipcMain.handle('inspector:fingerprint-retry', event => {
      assertSender(event); if (!inspector) throw new Error('INDEX_UNAVAILABLE');
      if (fingerprintRetry) return { accepted: false };
      fingerprintRetry=protectedFingerprintKey(true,state=>window?.webContents.send('inspector:fingerprint-access',state)).then(async key=>{if(key)await inspector!.request('fingerprint-key',key);}).catch(()=>{}).finally(()=>{fingerprintRetry=undefined;});
      return { accepted: true };
    });
    ipcMain.handle('inspector:sample-pick', async event => {
      assertSender(event); if (!window) throw new Error('WINDOW_UNAVAILABLE');
      const choice = await dialog.showOpenDialog(window, { title: 'Inspect a Codex trace sample locally', filters: [{ name: 'Codex trace records', extensions: ['jsonl'] }], properties: ['openFile'] });
      if (choice.canceled || !choice.filePaths[0]) return { cancelled: true };
      return { cancelled: false, report: await inspectSourceSample(choice.filePaths[0]) };
    });
    ipcMain.handle('inspector:manifest-pick', async event => {
      assertSender(event); if (!inspector || !window) throw new Error('INDEX_UNAVAILABLE');
      const state = await inspector.request('manifests') as { enabled: boolean };
      if (!state.enabled) throw new Error('MANIFESTS_DISABLED');
      const choice = await dialog.showOpenDialog(window, { title: 'Import owned-client context metadata', filters: [{ name: 'Context metadata', extensions: ['json'] }], properties: ['openFile'] });
      if (choice.canceled || !choice.filePaths[0]) return { imported: 0, cancelled: true };
      const file = await open(choice.filePaths[0], constants.O_RDONLY | constants.O_NOFOLLOW);
      let body: string;
      try {
        const stat = await file.stat(); const limit = 2 * 1024 * 1024;
        if (!stat.isFile() || stat.size > limit) throw new Error('MANIFEST_TOO_LARGE');
        const buffer = Buffer.alloc(limit + 1); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead > limit) throw new Error('MANIFEST_TOO_LARGE'); body = buffer.subarray(0, bytesRead).toString('utf8');
      } finally { await file.close(); }
      let bundle; try { bundle = JSON.parse(body); } catch { throw new Error('INVALID_MANIFEST'); }
      return inspector.request('manifest-import', bundle);
    });
    ipcMain.handle('inspector:offline-pick', async event => {
      assertSender(event); if (!inspector || !window) throw new Error('INDEX_UNAVAILABLE');
      const choice = await dialog.showOpenDialog(window, { title: 'Preview signed Collector statistics', filters: [{ name: 'Collector statistics', extensions: ['json'] }], properties: ['openFile'] });
      if (choice.canceled || !choice.filePaths[0]) return { cancelled: true };
      if (!choice.filePaths[0].toLowerCase().endsWith('.codexstats.json') || path.resolve(choice.filePaths[0]).split(path.sep).some(part => part.toLowerCase() === '.codex')) throw new Error('OFFLINE_STATISTICS_FILE_REQUIRED');
      const file = await open(choice.filePaths[0], constants.O_RDONLY | constants.O_NOFOLLOW); let body: string;
      try { const stat = await file.stat(); if (!stat.isFile() || stat.size > OFFLINE_MAX_BYTES) throw new Error('OFFLINE_FILE_TOO_LARGE'); const buffer = Buffer.alloc(OFFLINE_MAX_BYTES + 1); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0); if (bytesRead > OFFLINE_MAX_BYTES) throw new Error('OFFLINE_FILE_TOO_LARGE'); body = buffer.subarray(0, bytesRead).toString('utf8'); } finally { await file.close(); }
      let archive; try { archive = JSON.parse(body); } catch { throw new Error('INVALID_OFFLINE_FILE'); }
      const preview = await inspector.request('offline-preview', archive) as OfflinePreview;
      if (offlinePreviews.size >= 3) offlinePreviews.delete(offlinePreviews.keys().next().value!);
      const previewId = randomUUID(); offlinePreviews.set(previewId, { archive, createdAt: Date.now() });
      return { cancelled: false, previewId, filename: path.basename(choice.filePaths[0]), preview };
    });
    ipcMain.handle('inspector:offline-import-preview', async (event, previewId: unknown) => {
      assertSender(event); if (!inspector || typeof previewId !== 'string') throw new Error('INVALID_OFFLINE_PREVIEW');
      const saved = offlinePreviews.get(previewId); if (!saved || Date.now() - saved.createdAt > 300000) { offlinePreviews.delete(previewId); throw new Error('OFFLINE_PREVIEW_EXPIRED'); }
      // Revalidate active enrollment, signature, gaps and current sequence immediately before ingestion.
      const result = await inspector.request('offline-import', saved.archive); offlinePreviews.delete(previewId); return result;
    });
    ipcMain.handle('inspector:root-pick', async event => {
      assertSender(event); if (!inspector || !window) throw new Error('INDEX_UNAVAILABLE');
      const choice = await dialog.showOpenDialog(window, { title: 'Choose an authorized Codex trace directory', properties: ['openDirectory'] });
      if (choice.canceled || !choice.filePaths[0]) return { added: false };
      await inspector.request('root-add', choice.filePaths[0]); return { added: true };
    });
    ipcMain.handle('inspector:source-delete', async (event, id: unknown) => {
      assertSender(event); if (!inspector || !window) throw new Error('INDEX_UNAVAILABLE');
      if (typeof id !== 'string' || !/^source:[a-f0-9]{64}$/.test(id)) throw new Error('INVALID_SOURCE_ID');
      const choice = await dialog.showMessageBox(window, { type: 'warning', buttons: ['Cancel', 'Delete monitor records'], defaultId: 0, cancelId: 0,
        message: 'Delete this source from the monitor?', detail: 'Removes monitor-owned history, usage and related trial snapshots; suppresses reimport. An enrolled remote collector receives the exclusion on its next connection; progress appears under Machines & sources. Original Codex logs, backups and user-exported copies are untouched.' });
      if (choice.response !== 1) return { deleted: false };
      return serializePrivacy(async () => { await inspector!.request('source-delete', id); privacyChanged(); return { deleted: true }; });
    });
    ipcMain.handle('inspector:project-set', async (event, input: unknown) => {
      assertSender(event); if (!inspector || !window) throw new Error('INDEX_UNAVAILABLE');
      const plan = await inspector.request('project-policy-plan', input) as { policy: ProjectPrivacyPolicy; expiredObservations: number; expiredContent: number; contentConsentRequired: boolean; collectorTargets: number };
      if (plan.contentConsentRequired || plan.expiredObservations || plan.expiredContent || plan.collectorTargets) { const choice = await dialog.showMessageBox(window, { type: 'warning', buttons: ['Cancel', 'Apply project settings'], defaultId: 0, cancelId: 0, message: plan.contentConsentRequired ? '保留此 Project 嘅本機文字片段？ / Retain local project text?' : '套用此 Project 保留設定？ / Apply project retention?', detail: `${plan.policy.projectId}\n${plan.contentConsentRequired ? `明確同意後，新讀取嘅本機訊息及工具文字會刪敏後保留最多 ${plan.policy.contentDays} 日，每段8 KiB、每Project8 MiB、整體64 MiB／20,000段，供本機搜尋。刪敏未必識別所有私密文字，請只為合適嘅Project啟用。遠端同步及統計報告唔包含文字。舊歷史只會喺你另行按重新解析時處理。\nExplicit consent retains bounded redacted local text for search. Redaction may miss private content; remote sync and statistics exports remain metadata only. Existing history is processed only by a separate explicit reparse.\n` : ''}${plan.collectorTargets} 個已配對 Collector 會喺成功連線後收到呢個 Project 限制；設備頁顯示實際確認。中央限制可能清除 Client 超期索引／待傳送副本，但唔代 Client 開啟文字保留。\n${plan.collectorTargets} enrolled collectors receive project restrictions on reconnect. Clients preserve stricter local limits; expired local indexes/queued copies may be removed. Check Machines for receipts; raw logs and local content consent are not granted by central settings.\n${plan.expiredObservations} metadata／usage records and ${plan.expiredContent} text excerpts will be removed by this retention change. Original logs, exported copies and collector-owned indexes are untouched.` }); if (choice.response !== 1) return; }
      await serializePrivacy(async () => { await inspector!.request('project-set', plan.policy); privacyChanged(); });
    });
    ipcMain.handle('inspector:project-delete', async (event, id: unknown) => {
      assertSender(event); if (!inspector || !window) throw new Error('INDEX_UNAVAILABLE');
      const plan = await inspector.request('project-delete-plan', id) as ProjectDeletionPlan;
      const choice = await dialog.showMessageBox(window, { type: 'warning', buttons: ['Cancel', 'Delete this project from monitor'], defaultId: 0, cancelId: 0, message: 'Delete this project from the monitor?', detail: `${plan.projectId}\n${plan.observations} observations, ${plan.usageObservations} usage measurements, ${plan.sources} sources; ${plan.mixedSources} contain other projects. Removes this project's monitor records and related shared trial/context/incident copies; preserves other projects' observations. Further imports with this project identity are excluded. Raw preview of mixed or unidentifiable sources is blocked. Original Codex logs, collector-owned local indexes, backups and exported files are untouched.` });
      if (choice.response !== 1) return { deleted: false };
      return serializePrivacy(async () => { await inspector!.request('project-delete', id); privacyChanged(); return { deleted: true }; });
    });
    ipcMain.handle('inspector:enroll-device', async (event, input: { name: unknown; deviceId?: unknown }) => {
      assertSender(event); if (!inspector || !window) throw new Error('INDEX_UNAVAILABLE');
      const name = input?.name;
      if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('INVALID_DEVICE_NAME');
      const choice = await dialog.showSaveDialog(window, { title: 'Export one-time Collector pairing', defaultPath: `${name.replace(/[^a-z0-9_-]/gi, '-')}.pairing.json`, filters: [{ name: 'Collector pairing', extensions: ['json'] }] });
      if (choice.canceled || !choice.filePath) return { saved: false };
      if (choice.filePath.includes(`${path.sep}.codex${path.sep}`) || choice.filePath.endsWith('.jsonl')) throw new Error('FORBIDDEN_SOURCE');
      const config = await inspector.request('enroll', { name, deviceId: input.deviceId }) as { deviceId: string };
      try { await writeFile(choice.filePath, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' }); }
      catch (error) { await inspector.request('revoke', config.deviceId); throw error; }
      return { saved: true, deviceId: config.deviceId, filename: path.basename(choice.filePath) };
    });
    benchmarkRunner = new BenchmarkRunner(process.execPath, async record => { if (!inspector) throw new Error('INDEX_UNAVAILABLE'); await inspector.request('benchmark-record', record); }, () => window?.webContents.send('inspector:changed'));
    ipcMain.handle('inspector:benchmark-prepare', async (event, payload: { contractId: string }) => {
      assertSender(event); if (!window || !inspector || !benchmarkRunner || !payload || Object.keys(payload).some(key => key !== 'contractId') || typeof payload.contractId !== 'string') throw new Error('INVALID_BENCHMARK_REQUEST');
      const contracts = await inspector.request('experiments', payload.contractId) as { contracts: { id: string; revision: number }[] }; const contract = contracts.contracts.find(contract => contract.id === payload.contractId); if (!contract) throw new Error('UNKNOWN_CONTRACT');
      const selected = await dialog.showOpenDialog(window, { title: 'Select a trusted local acceptance bundle', properties: ['openFile'], filters: [{ name: 'Benchmark JSON', extensions: ['json'] }] });
      if (selected.canceled || !selected.filePaths[0]) return { cancelled: true }; return { cancelled: false, preview: await benchmarkRunner.prepare(selected.filePaths[0], contract.id, contract.revision) };
    });
    ipcMain.handle('inspector:benchmark-run', async (event, payload: { planId: string }) => {
      assertSender(event); if (!window || !benchmarkRunner || !payload || Object.keys(payload).some(key => key !== 'planId') || typeof payload.planId !== 'string') throw new Error('INVALID_BENCHMARK_REQUEST');
      const approved = await dialog.showMessageBox(window, { type: 'question', buttons: ['Cancel', 'Run trusted local bundle'], defaultId: 0, cancelId: 0, message: 'Run the reviewed local acceptance bundle?', detail: 'Runs its frozen inputs in a temporary snapshot with no network access. Node permissions are guardrails for trusted code, not a malicious-code security boundary. Original inputs are not written; command completion does not establish task acceptance.' });
      if (approved.response !== 1) { benchmarkRunner.discard(payload.planId); return { cancelled: true }; } return { cancelled: false, execution: await benchmarkRunner.run(payload.planId) };
    });
    ipcMain.handle('inspector:benchmark-cancel', (event, payload: { executionId: string }) => { assertSender(event); if (!benchmarkRunner || !payload || Object.keys(payload).some(key => key !== 'executionId') || typeof payload.executionId !== 'string') throw new Error('INVALID_BENCHMARK_REQUEST'); benchmarkRunner.cancel(payload.executionId); });
    ipcMain.handle('inspector:report', async (event, payload: unknown) => {
      assertSender(event); if (!inspector) throw new Error('INDEX_UNAVAILABLE');
      const preview = await inspector.request('report', payload) as { body: string; format: string; revision: number; projectIds: string[]; privacyVersion: string };
      if (Buffer.byteLength(preview.body) > 8 * 1024 * 1024) throw new Error('REPORT_TOO_LARGE');
      if (reportPreviews.size >= 3) reportPreviews.delete(reportPreviews.keys().next().value!);
      const previewId = randomUUID(); reportPreviews.set(previewId, { ...preview, createdAt: Date.now() });
      return { ...preview, previewId };
    });
    ipcMain.handle('inspector:copy-report', async (event, previewId: unknown) => {
      assertSender(event); if (!inspector) throw new Error('INDEX_UNAVAILABLE');
      return serializePrivacy(async () => {
        const preview = typeof previewId === 'string' ? reportPreviews.get(previewId) : undefined;
        if (!preview || Date.now() - preview.createdAt > 300000) throw new Error('PREVIEW_EXPIRED');
        await inspector!.request('report-privacy-check', { projectIds: preview.projectIds, privacyVersion: preview.privacyVersion });
        clipboard.writeText(preview.body);
        const auditRecorded = await inspector!.request('report-exported', { revision: preview.revision, format: 'clipboard' }).then(() => true, () => false);
        reportPreviews.delete(previewId as string); return { copied: true, auditRecorded };
      });
    });
    ipcMain.handle('inspector:export', async (event, previewId: unknown) => {
      assertSender(event); if (!inspector || !window) throw new Error('INDEX_UNAVAILABLE');
      const preview = typeof previewId === 'string' ? reportPreviews.get(previewId) : undefined;
      if (!preview || Date.now() - preview.createdAt > 300000) throw new Error('PREVIEW_EXPIRED');
      const extension = preview.format === 'markdown' ? 'md' : preview.format;
      const choice = await dialog.showSaveDialog(window, { title: 'Export redacted Token Inspector report', defaultPath: `token-inspector-${new Date().toISOString().slice(0, 10)}.${extension}`, filters: [{ name: preview.format, extensions: [extension] }] });
      if (choice.canceled || !choice.filePath) return { saved: false };
      if (choice.filePath.endsWith('.jsonl') || choice.filePath.includes(`${path.sep}.codex${path.sep}`)) throw new Error('FORBIDDEN_SOURCE');
      return serializePrivacy(async () => {
      if (!reportPreviews.has(previewId as string)) throw new Error('REPORT_PRIVACY_CHANGED');
      await inspector!.request('report-privacy-check', { projectIds: preview.projectIds, privacyVersion: preview.privacyVersion });
      await writeFile(choice.filePath!, preview.body, { mode: 0o600, flag: 'wx' });
      const auditRecorded = await inspector!.request('report-exported', { revision: preview.revision, format: preview.format }).then(() => true, () => false);
      reportPreviews.delete(previewId as string);
      return { saved: true, filename: path.basename(choice.filePath!), auditRecorded };
      });
    });
    inspector.on('reparse-progress', state => { if (window && !window.webContents.isDestroyed()) window.webContents.send('inspector:reparse-progress', state); });
    inspector.on('changed', () => { if (window && !window.webContents.isDestroyed()) window.webContents.send('inspector:changed'); });
    inspector.on('devices-changed', () => { if (window && !window.webContents.isDestroyed()) window.webContents.send('inspector:devices-changed'); });
    ipcMain.handle('monitor:snapshot', event => { assertSender(event); return privateSnapshot(monitor.snapshot()); });
    ipcMain.handle('monitor:trace', async (event, agentId: unknown) => {
      assertSender(event);
      if (typeof agentId !== 'string' || agentId.length > 1024) throw new Error('Invalid agent identifier');
      const agent = monitor.snapshot().agents.find(agent => agent.id === agentId); if (!agent) return [];
      if (!await inspector!.request('trace-privacy', { threadId: agent.threadId ?? '', sourcePath: agent.tracePath ?? '' })) throw new Error('PROJECT_SOURCE_PREVIEW_BLOCKED');
      return monitor.getTrace(agentId);
    });
    ipcMain.handle('monitor:load-run', (event, runId: unknown) => {
      assertSender(event);
      if (typeof runId !== 'string' || !runId || runId.length > 1024) throw new Error('Invalid run identifier');
      return monitor.loadRun(runId);
    });
    monitor.on('snapshot', snapshot => { void privateSnapshot(snapshot).then(value => { if (window && !window.webContents.isDestroyed()) window.webContents.send('monitor:changed', value); }).catch(() => undefined); });
    // Unpackaged macOS runs show Electron's own Dock icon unless it is replaced; packaged apps use the bundle icon.
    if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(iconPath);
    createWindow();
    void monitor.start().catch(error => { console.error('Trace monitor failed:', error); });
    app.on('activate', () => { if (!window) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  let stopping = false;
  app.on('before-quit', event => {
    if (stopping) return;
    event.preventDefault(); stopping = true;
    const deadline = setTimeout(() => app.quit(), 10000); deadline.unref();
    void Promise.allSettled([monitor.stop(), (async () => { await benchmarkRunner?.stop(); await inspector?.stop(); })()]).finally(() => { clearTimeout(deadline); app.quit(); });
  });
}
