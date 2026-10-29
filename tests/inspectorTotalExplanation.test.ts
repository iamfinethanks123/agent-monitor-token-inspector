import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { explainTotal, explainTotalPage } from '../src/storage/total-explanation';
import { setManualUsdPrice } from '../src/accounting/manual-usd';
import { bumpPrivacyVersion } from '../src/storage/project-privacy';

const header = { type:'session_meta',payload:{id:'total-thread',model_provider:'openai',model:'gpt-6-sol'} };
const lines = (rows: unknown[]) => rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
const response = (id: string, input=10) => ({type:'token_usage_record',timestamp:'2026-10-14T01:00:00Z',payload:{thread_id:'total-thread',response_id:id,usage:{input_tokens:input,output_tokens:2},private_body:'PRIVATE_TOTAL_MARKER'}});
const counter = (input:number,output=0,timestamp='2026-10-14T02:00:00Z') => ({type:'event_msg',timestamp,payload:{type:'token_count',info:{total_token_usage:{input_tokens:input,output_tokens:output}}}});
async function fixture(rows:unknown[], run:(s:InspectorStore,c:IndexCollector,file:string)=>Promise<void>) {
  const root=await mkdtemp(path.join(os.tmpdir(),'total-explanation-'));const file=path.join(root,'run.jsonl');const store=new InspectorStore(path.join(root,'index.sqlite'));const collector=new IndexCollector(store,[root]);
  try{await writeFile(file,lines([header,...rows]));await collector.scan();await run(store,collector,file);}finally{store.close();await rm(root,{recursive:true,force:true});}
}
test('complete membership/source paging reconciles replay and controls, and freezes prices/rows across appends',async()=>{
  await fixture([...Array.from({length:53},(_,n)=>response(`r-${n}`)),response('r-0'),response('r-0'),counter(530,106),counter(530,106)],async(store,collector,file)=>{
    const price=setManualUsdPrice(store,{mode:'uniform',uniformRate:'2'});const revision=store.revision();const view=explainTotal(store,{query:{},revision,usdPriceId:price.id,expectedTotal:'636'});
    assert.equal(view.membershipCount,53);assert.equal(view.sourceMeasurementCount,57);assert.equal(view.additionalResponseSupports,2);assert.equal(view.summary.usage.total.value,'636');
    assert.equal(view.roles.find(x=>x.role==='control_only')?.measurements,2);assert.equal(view.roles.find(x=>x.role==='response_support')?.measurements,55);
    const first=explainTotalPage(store,{snapshotId:view.snapshotId,section:'members',page:0});assert.equal(first.members.length,50);assert(first.hasNext);
    const beforeSource=explainTotalPage(store,{snapshotId:view.snapshotId,section:'sources',page:1});assert.equal(beforeSource.sources.length,7);
    await appendFile(file,lines([response('new-response')]));await collector.scan();setManualUsdPrice(store,{mode:'uniform',uniformRate:'9'});
    const second=explainTotalPage(store,{snapshotId:view.snapshotId,section:'members',page:1});assert.equal(second.members.length,3);assert(!second.hasNext);assert.equal(store.summary().usage.total.value,'648');
    const lower=[...first.members,...second.members].reduce((sum,row)=>sum+BigInt(row.usdUnits!),0n);assert.equal(lower,BigInt(view.usd.amount!.replace('.','')));
    assert.equal(explainTotalPage(store,{snapshotId:view.snapshotId,section:'sources',page:1}).sources.length,7);
    assert(!JSON.stringify([view,first,second,beforeSource]).includes('PRIVATE_TOTAL_MARKER'));
    assert.throws(()=>explainTotal(store,{query:{},revision}),/REVISION_CHANGED/);
    assert.throws(()=>explainTotal(store,{query:{},revision:store.revision(),usdPriceId:price.id}),/PRICE_CHANGED/);
    assert.throws(()=>explainTotal(store,{query:{},revision:store.revision(),expectedTotal:'1'}),/VALUE_CHANGED/);
    assert.throws(()=>explainTotal(store,{query:{limit:1},revision:store.revision()}),/INVALID_TOTAL_SCOPE/);
  });
});
test('scoped interval support includes its earlier endpoint, while quarantined ranges/responses never add cost',async()=>{
  await fixture([counter(100,0,'2026-10-13T23:50:00Z'),counter(120,0,'2026-10-14T00:10:00Z'),counter(5)],async store=>{
    const query={runId:'total-thread',provider:'openai',serviceTier:null,requestedModel:'gpt-6-sol',from:'2026-10-14T00:00:00Z'};
    const view=explainTotal(store,{query,revision:store.revision(),expectedTotal:'20'});assert.equal(view.summary.intervals,1);assert.equal(view.summary.quarantinedEntries,1);
    const included=explainTotalPage(store,{snapshotId:view.snapshotId,section:'members',status:'selected',page:0});assert.equal(included.members.length,1);assert.equal(included.members[0].entry.usage.total.value,'20');
    const excluded=explainTotalPage(store,{snapshotId:view.snapshotId,section:'members',status:'quarantined',page:0});assert.equal(excluded.members.length,1);assert.equal(excluded.members[0].usdUnits,null);
    const sources=explainTotalPage(store,{snapshotId:view.snapshotId,section:'sources',page:0});assert.equal(sources.sources.length,3);
    assert(sources.sources.some(row=>row.timestamp==='2026-10-13T23:50:00.000Z'&&row.role==='counter_support'));assert(sources.sources.some(row=>row.role==='quarantined_counter'));
    assert.equal(sources.sources.reduce((sum,row)=>sum+BigInt(row.values.total!),0n),225n);assert.equal(view.summary.usage.total.value,'20');
  });
  await fixture([response('a'),response('a',9),response('b',3)],async store=>{
    const view=explainTotal(store,{query:{},revision:store.revision()});assert.equal(view.summary.usage.total.value,'5');assert.equal(view.summary.quarantinedEntries,1);
    assert.equal(view.roles.find(row=>row.role==='quarantined_response')?.measurements,2);
  });
});
test('privacy/reanalysis invalidates snapshots; foreign stores cannot access them and missing usage stays unknown',async()=>{
  await fixture([response('a'),{type:'token_usage_record',payload:{thread_id:'total-thread',response_id:'unknown',usage:{input_tokens:5}}}],async(store,collector)=>{
    const view=explainTotal(store,{query:{},revision:store.revision()});const page=explainTotalPage(store,{snapshotId:view.snapshotId,section:'members',page:0});
    assert(page.members.some(row=>row.entry.identity.responseId==='unknown'&&row.entry.usage.total.value===null&&row.usdUnits===null));
    const foreign=new InspectorStore(':memory:');try{assert.throws(()=>explainTotalPage(foreign,{snapshotId:view.snapshotId,section:'members',page:0}),/UNAVAILABLE/);}finally{foreign.close();}
    await collector.reparse();assert.throws(()=>explainTotalPage(store,{snapshotId:view.snapshotId,section:'members',page:0}),/INVALIDATED/);
    const latest=explainTotal(store,{query:{},revision:store.revision()});bumpPrivacyVersion(store);assert.throws(()=>explainTotalPage(store,{snapshotId:latest.snapshotId,section:'sources',page:0}),/INVALIDATED/);
    assert.throws(()=>explainTotalPage(store,{snapshotId:latest.snapshotId,section:'sources',page:0,status:'selected'}),/INVALID_TOTAL_PAGE/);
  });
});
