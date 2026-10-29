import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, appendFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { setRetention } from '../src/storage/privacy';

const runFile = promisify(execFile);
test('standalone local CLI expires owned records, preserves originals and does not restore expired history on later scans', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-retention-')), file = path.join(root,'run.jsonl'), database = path.join(root,'local-index.sqlite');
  const usage = (id: string, input: number) => JSON.stringify({type:'token_usage_record',payload:{thread_id:'local-expiry',response_id:id,usage:{input_tokens:input,output_tokens:2}}})+'\n';
  const original = JSON.stringify({type:'session_meta',payload:{id:'local-expiry',model_provider:'openai'}})+'\n'+usage('old',10);
  const invoke = () => runFile(process.execPath,['--import','tsx','src/collector/client.ts','local',root,'--once'],{cwd:process.cwd(),env:{...process.env,AGENT_MONITOR_CLIENT_STATE:root,ELECTRON_RUN_AS_NODE:'1'},timeout:15000});
  try {
    await writeFile(file,original); const seed = new InspectorStore(database);
    try { await new IndexCollector(seed,[root]).scan(); setRetention(seed,{eventDays:1,usageDays:2,rawCopies:false,textSearch:false}); seed.db.prepare('UPDATE observations SET received_at=?').run(new Date(Date.now()-3*86400000).toISOString()); } finally { seed.close(); }
    const first = await invoke(); assert(first.stdout.includes('networking disabled')); assert.equal(await readFile(file,'utf8'),original);
    let store = new InspectorStore(database); try { assert.equal(store.observationCount(),0); assert.equal(store.summary().selectedEntries,0); assert(store.sources()[0].issues.includes('USAGE_RETENTION_GAP')); } finally { store.close(); }
    await invoke(); store = new InspectorStore(database); try { assert.equal(store.observationCount(),0); } finally { store.close(); }
    await appendFile(file,usage('new',3)); await invoke(); store = new InspectorStore(database); try { assert.equal(store.summary().usage.total.value,'5'); assert.equal(store.db.prepare('PRAGMA foreign_key_check').all().length,0); } finally { store.close(); }
    assert.equal(await readFile(file,'utf8'),original+usage('new',3));
  } finally { await rm(root,{recursive:true,force:true}); }
});
