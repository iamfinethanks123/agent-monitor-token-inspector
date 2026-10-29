import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { dataQuality } from '../src/diagnostics/data-quality';
import { report } from '../src/reporting/report';
import { setProjectPolicy } from '../src/storage/project-privacy';
const time='2026-10-14T00:00:00Z';
const header={type:'session_meta',timestamp:time,payload:{id:'quality-thread',cwd:'/PRIVATE_SOURCE_PATH',model_provider:'openai'}};
const response=(id:string,input=10,cache?:number)=>({type:'token_usage_record',timestamp:time,payload:{thread_id:'quality-thread',response_id:id,model:'gpt-6-sol',usage:{input_tokens:input,output_tokens:2,...(cache===undefined?{}:{cached_input_tokens:cache})},private:'PRIVATE_RAW_CONTENT'}});
async function fixture(content:string,run:(store:InspectorStore,collector:IndexCollector,root:string)=>Promise<void>){const root=await mkdtemp(path.join(os.tmpdir(),'quality-'));const store=new InspectorStore(path.join(root,'index.sqlite'));const collector=new IndexCollector(store,[root],'quality-test-key');try{await writeFile(path.join(root,'run.jsonl'),content);await collector.scan();await run(store,collector,root);}finally{store.close();await rm(root,{recursive:true,force:true});}}
const lines=(rows:unknown[])=>rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
test('malformed spans remain visible while later usage survives; unknown and semantic problems limit source capability',async()=>{
  const malformed='{PRIVATE_BROKEN_RECORD}\n';await fixture(lines([header,response('a')])+malformed+lines([{type:'future_private_event',timestamp:time,payload:{secret:'PRIVATE_UNKNOWN_PAYLOAD'}},response('b',10,20),response('c')]),async (store,_collector,root)=>{
    const view=dataQuality(store);assert.equal(view.counts.records,6);assert.equal(view.counts.gaps,1);assert.equal(view.counts.skippedBytes,String(Buffer.byteLength(malformed)));assert.equal(view.counts.unsupported,2);assert.equal(view.counts.semanticIssues,1);assert.equal(view.counts.unknownKinds,1);assert.equal(view.ledger.selected,2);assert.equal(view.ledger.quarantined,1);assert.equal(view.ledger.missing.cachedInput,2);assert.equal(store.summary().usage.total.value,'24');assert.equal(view.sources[0].state,'partial');assert(view.sources[0].capabilityLimited);assert.equal(view.sources[0].backlogBytes,'0');
    const filtered=dataQuality(store,{from:'2026-10-14T00:00:00Z'});assert.equal(filtered.counts.gaps,0);assert.equal(filtered.counts.records,5);assert.equal(filtered.sources[0].bytesProcessed,view.sources[0].bytesProcessed);
    for(const format of ['json','markdown']){const output=report(store,{},format,{table:'data-quality'});for(const marker of ['PRIVATE_SOURCE_PATH','PRIVATE_RAW_CONTENT','PRIVATE_BROKEN_RECORD','future_private_event','PRIVATE_UNKNOWN_PAYLOAD',root])assert(!output.body.includes(marker),marker);assert.equal(output.revision,view.revision);assert(!output.body.includes('"entries":'));}
    assert.throws(()=>report(store,{},'csv',{table:'data-quality'}),/INVALID_FORMAT/);
  });
});
test('extra supports are metadata counts, not duplicate charges; scope filters and empty data stay explicit',async()=>{
  await fixture(lines([header,response('same'),response('same')]),async store=>{const before=store.summary().usage.total.value;const view=dataQuality(store);assert.equal(view.ledger.selected,1);assert.equal(view.ledger.additionalResponseSupports,'1');assert.equal(store.summary().usage.total.value,before);const empty=dataQuality(store,{machineId:'absent'});assert.equal(empty.counts.records,0);assert.equal(empty.sourceCount,0);assert.equal(empty.counts.lastSuccessfulReceipt,null);assert.equal(empty.ledger.additionalResponseSupports,'0');});
});
test('diagnostic export uses the existing project export policy and privacy stamp',async()=>{
  await fixture(lines([header,response('a')]),async store=>{const project=store.ledger().items[0].identity.projectId!;assert(project);const output=report(store,{projectId:project},'json',{table:'data-quality'});assert(output.projectIds.includes(project));setProjectPolicy(store,{projectId:project,metadataDays:null,usageDays:null,contentDays:0,allowExports:false,allowSourcePreview:true,excluded:false});assert.throws(()=>report(store,{projectId:project},'json',{table:'data-quality'}),/PROJECT_EXPORT_RESTRICTED/);});
});
