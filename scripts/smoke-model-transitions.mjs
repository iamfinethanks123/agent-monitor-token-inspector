import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const root=await mkdtemp(path.join(os.tmpdir(),'model-transitions-native-'));const traces=path.join(root,'traces');const userData=path.join(root,'user-data');const executable=path.resolve('node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');let app;
try{
  await mkdir(traces);await mkdir(path.join(userData,'inspector'),{recursive:true});
  const context=model=>({type:'turn_context',payload:{model}});const response=(id,ordinal,model)=>({type:'token_usage_record',ordinal,timestamp:new Date(Date.UTC(2026,9,14,0,0,ordinal)).toISOString(),payload:{thread_id:'models-native',response_id:id,model,usage:{input_tokens:10,output_tokens:2},private:'PRIVATE_MODEL_NATIVE'}});
  const rows=[{type:'session_meta',payload:{id:'models-native',model_provider:'openai'}},context('gpt-6-sol'),response('a',1,'gpt-6-sol'),context('gpt-6-astra'),response('b',2,'gpt-6-sol'),response('c',3,'gpt-6-astra'),response('d',4)];
  await writeFile(path.join(traces,'run.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
  const seeded=spawnSync(executable,['--import','tsx','--input-type=module','-e',"import {InspectorStore} from './src/storage/InspectorStore.ts';import {IndexCollector} from './src/collector/IndexCollector.ts';import {setManualUsdPrice} from './src/accounting/manual-usd.ts';const s=new InspectorStore(process.argv[1]);try{await new IndexCollector(s,[process.argv[2]]).scan();setManualUsdPrice(s,{mode:'uniform',uniformRate:'2'});}finally{s.close();}",path.join(userData,'inspector','index.sqlite'),traces],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8'});if(seeded.status!==0)throw new Error(seeded.stderr);
  app=await electron.launch({executablePath:executable,args:[process.cwd(),`--user-data-dir=${userData}`],env:{...process.env,AGENT_MONITOR_TRACE_ROOT:traces,AGENT_MONITOR_USER_DATA:userData,ELECTRON_USER_DATA_DIR:userData,AGENT_MONITOR_RECEIVER_PORT:'0',ELECTRON_IS_DEV:'0'}});
  const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.getByText(/逐回應嘅模型／路線轉換|Model \/ route attribution transitions/,{exact:true}).click();const panel=page.getByLabel('Model attribution transitions');
  await expect(panel.locator('tbody tr')).toHaveCount(3,{timeout:20000});await expect(panel).toContainText(/Requested 設定改變|Requested configuration change/);await expect(panel).toContainText(/已觀察模型改變|Observed model change/);await expect(panel).toContainText(/歸屬／證據改變|Attribution\/evidence change/);await expect(panel).not.toContainText('PRIVATE_MODEL_NATIVE');
  await panel.locator('tbody tr').first().scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/agent-monitor-model-transitions-smoke.png',fullPage:true});
  await panel.getByRole('button',{name:/解釋呢筆用量|Explain entry/,exact:true}).first().click();const dialog=page.getByRole('dialog',{name:/解釋呢筆用量|Explain this usage entry/,exact:true});await expect(dialog).toContainText(/來源證據|Supporting observations/);await dialog.getByRole('button',{name:/關閉帳本解釋|Close ledger explanation/}).click();
  await panel.getByRole('button',{name:'Timeline',exact:true}).first().click();await expect(page.locator('.timeline-summary')).toContainText(/1 符合範圍|1 matching/);expect((await page.evaluate(()=>window.tokenInspector.summary())).usage.total.value).toBe('48');if(errors.length)throw new Error(errors.join('; '));
  console.log('PASS: native lazy model transitions, requested/observed/evidence distinctions, endpoint explanation, single-source Timeline and unchanged usage');
}finally{if(app)await app.close();await rm(root,{recursive:true,force:true});}
