import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const root = await mkdtemp(path.join(os.tmpdir(), 'context-attribution-native-')); const sources = path.join(root, 'traces'); const userData = path.join(root, 'user-data');
const executable = path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'); let app;
try {
  await mkdir(sources); await mkdir(path.join(userData, 'inspector'), { recursive: true }); const at = new Date().toISOString();
  const rows = [{ type: 'session_meta', payload: { id: 'context-native', model_provider: 'openai', model: 'gpt-6-sol' } },
    { type: 'response_item', timestamp: at, payload: { type: 'function_call', call_id: 'file', name: 'exec_command', arguments: JSON.stringify({ cmd: 'cat source.ts' }) } },
    { type: 'response_item', timestamp: at, payload: { type: 'function_call_output', call_id: 'file', output: 'x'.repeat(2048), truncated: true } },
    { type: 'token_usage_record', timestamp: at, payload: { thread_id: 'context-native', response_id: 'response-a', usage: { input_tokens: 5, output_tokens: 1 } } },
    { type: 'token_usage_record', timestamp: at, payload: { thread_id: 'context-native', response_id: 'response-b', usage: { input_tokens: 8, output_tokens: 1 } } }];
  await writeFile(path.join(sources, 'run.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const seedCode = `import {InspectorStore} from './src/storage/InspectorStore.ts'; import {IndexCollector} from './src/collector/IndexCollector.ts'; import {observeOwnedRequest} from './src/collector/owned-client.ts'; import {setManifestConsent,manifests,importManifests} from './src/storage/context-manifests.ts';
    const store=new InspectorStore(process.argv[1]); try { await new IndexCollector(store,[process.argv[2]]).scan(); setManifestConsent(store,true); const consent=manifests(store).consent; const records=[];
    for(const [requestId,responseId,tokens] of [['request-a','response-a','7'],['request-b','response-b','6']]) await observeOwnedRequest({schema:'owned-context/2',contextEpoch:'epoch-native',consent,clientId:'owned-native',requestId,threadId:'context-native',turnId:null,items:[{id:'file',origin:'tool',text:'data',estimate:{tokens,tokenizer:'fixture',version:'1'},facets:{origin:'project_file',transport:'tool_result',state:requestId==='request-a'?'new':'retained',media:'text',contentId:'file-lineage',originalBytes:'4',included:true,serializationIncluded:false}}],persist:async r=>records.push(r),send:async()=>({responseId})}); importManifests(store,{schema:'owned-context-bundle/1',records}); } finally { store.close(); }`;
  const seeded = spawnSync(executable, ['--import', 'tsx', '--input-type=module', '-e', seedCode, path.join(userData, 'inspector', 'index.sqlite'), sources], { cwd: process.cwd(), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(seeded.stderr);
  app = await electron.launch({ executablePath: executable, args: [process.cwd(), `--user-data-dir=${userData}`], env: { ...process.env, AGENT_MONITOR_TRACE_ROOT: sources, CODEX_HOME: path.join(root, 'codex-home'), HOME: path.join(root, 'home'), ELECTRON_USER_DATA_DIR: userData, AGENT_MONITOR_USER_DATA: userData, AGENT_MONITOR_RECEIVER_PORT: '0', ELECTRON_IS_DEV: '0' } });
  const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: /Context 與工具|Context & tools/, exact: true }).click();
  await page.getByRole('navigation',{name:'Context investigation modes'}).getByRole('button',{name:/Context 來源|Context origins/}).click();
  const panel = page.getByLabel('Context attribution'); await expect(panel.getByRole('heading', { name: /Context 來源與內容出現次數|Context origins and content occurrences/ })).toBeVisible();
  await expect(panel).toContainText('512', { timeout: 20000 }); await expect(panel).toContainText('2,048');
  await panel.getByLabel('Source origin estimates').getByRole('button', { name: /Project 檔案|Project file/ }).click();
  await expect(panel.getByRole('table')).toContainText('tool_result'); await expect(panel.getByRole('table')).toContainText('truncated');
  await page.getByRole('navigation',{name:'Context investigation modes'}).getByRole('button',{name:/Client 清單|Client manifests/}).click();
  const request = page.locator('details.inspector-finding').filter({ has: page.locator('summary', { hasText: 'request-a' }) });
  await request.locator('summary').click(); await expect(request).toContainText(/重建估算高過|Reconstruction exceeds/); await expect(request).toContainText('-2'); await expect(request).toContainText('project_file');
  await page.getByRole('navigation',{name:'Context investigation modes'}).getByRole('button',{name:/Context 來源|Context origins/}).click();
  await panel.locator('details > summary').click(); await expect(panel).toContainText('file-lineage'); await expect(panel).toContainText(/2 個已配對回應|2 matched responses/);
  await page.screenshot({ path: '/tmp/agent-monitor-context-smoke.png', fullPage: true });
  if (errors.length) throw new Error(errors.join('; '));
  console.log('PASS: isolated native context facets, source-origin drilldown, truncated payload, negative discrepancy and declared matched lineage');
} finally { if (app) await app.close(); await rm(root, { recursive: true, force: true }); }
