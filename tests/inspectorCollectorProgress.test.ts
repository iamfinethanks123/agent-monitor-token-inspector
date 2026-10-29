import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,writeFile,appendFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
const lines=(rows:unknown[])=>rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
const header={type:'session_meta',payload:{id:'progress-thread',model_provider:'openai'}};
const response=(id:string)=>({type:'token_usage_record',payload:{thread_id:'progress-thread',response_id:id,usage:{input_tokens:10,output_tokens:2}}});
async function fixture(run:(store:InspectorStore,collector:IndexCollector,file:string,root:string)=>Promise<void>){const root=await mkdtemp(path.join(os.tmpdir(),'collector-progress-'));const file=path.join(root,'run.jsonl');const store=new InspectorStore(path.join(root,'index.sqlite'));const collector=new IndexCollector(store,[root]);try{await writeFile(file,lines([header,response('a')]));await collector.scan();await run(store,collector,file,root);}finally{store.close();await rm(root,{recursive:true,force:true});}}
test('unchanged source scans do not emit a data-change progress event or revise accounting',async()=>{
  await fixture(async(store,collector)=>{let progress=0;collector.onProgress=()=>progress++;const revision=store.revision();const count=store.observationCount();for(let index=0;index<5;index++)await collector.scan();assert.equal(progress,0);assert.equal(store.revision(),revision);assert.equal(store.observationCount(),count);assert.equal(store.summary().usage.total.value,'12');});
});
test('new committed data still emits progress and becomes visible, including the first complete usage after a partial tail',async()=>{
  await fixture(async(store,collector,file)=>{await appendFile(file,JSON.stringify(response('b')).slice(0,-1));await collector.scan();assert.equal(store.summary().usage.total.value,'12');assert(store.sources()[0].issues.includes('INCOMPLETE_RECORD_PENDING'));let progress=0;let visibleAtProgress:string|null=null;collector.onProgress=()=>{progress++;visibleAtProgress=store.summary().usage.total.value;};await appendFile(file,'}\n');await collector.scan();assert.equal(progress,1);assert.equal(visibleAtProgress,'24');assert.equal(store.summary().usage.total.value,'24');});
});
test('discovery of an empty source emits progress even though the token total is unchanged',async()=>{
  await fixture(async(store,collector,_file,root)=>{await writeFile(path.join(root,'empty.jsonl'),'');let progress=0;let visibleSources=0;collector.onProgress=()=>{progress++;visibleSources=store.sources().length;};await collector.scan();assert.equal(progress,1);assert.equal(visibleSources,2);assert.equal(store.observationCount(),2);assert.equal(store.summary().usage.total.value,'12');});
});
