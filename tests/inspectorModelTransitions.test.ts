import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { modelTransitions } from '../src/diagnostics/model-transitions';
import { setManualUsdPrice } from '../src/accounting/manual-usd';
const header={type:'session_meta',payload:{id:'models-thread',model_provider:'openai'}};
const context=(model?:string,tier?:string)=>({type:'turn_context',payload:{model,service_tier:tier}});
const response=(id:string,ordinal:number,model?:string,input=10)=>({type:'token_usage_record',ordinal,timestamp:new Date(Date.UTC(2026,9,14,0,0,ordinal)).toISOString(),payload:{thread_id:'models-thread',response_id:id,model,usage:{input_tokens:input,output_tokens:2},private_body:'PRIVATE_MODELS_MARKER'}});
const lines=(rows:unknown[])=>rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
async function fixture(rows:unknown[],run:(store:InspectorStore,collector:IndexCollector,root:string)=>Promise<void>){const root=await mkdtemp(path.join(os.tmpdir(),'model-transitions-'));const store=new InspectorStore(path.join(root,'index.sqlite'));const collector=new IndexCollector(store,[root]);try{await writeFile(path.join(root,'run.jsonl'),lines([header,...rows]));await collector.scan();await run(store,collector,root);}finally{store.close();await rm(root,{recursive:true,force:true});}}
test('observed, requested and evidence changes remain distinct; ordered native positions and endpoint costs never change totals',async()=>{
  await fixture([context('requested-a'),response('a',1,'observed-a'),context('requested-b'),response('b',2,'observed-a'),response('c',3,'observed-b'),response('d',4),context('requested-c'),response('e',5)],async store=>{
    setManualUsdPrice(store,{mode:'uniform',uniformRate:'2'});const before=store.summary().usage.total.value;const view=modelTransitions(store);
    assert.equal(view.eligibleEntries,5);assert.equal(view.changeCount,4);assert.deepEqual(view.transitions.map(row=>row.kind),['attribution_change','attribution_change','observed_model_change','configuration_change']);
    assert.equal(view.observedModelChanges,1);assert.equal(view.attributionChanges,2);assert(view.transitions.every(row=>row.orderBasis==='native_ordinal'));
    assert.equal(view.transitions[0].after.usdUnits,'24000000');assert(!JSON.stringify(view).includes('PRIVATE_MODELS_MARKER'));assert.equal(store.summary().usage.total.value,before);
  });
  await fixture([response('c',3,'model-c'),response('a',1,'model-a'),response('b',2,'model-b')],async store=>{
    const view=modelTransitions(store);assert.equal(view.changeCount,2);assert.deepEqual(view.transitions.map(row=>[row.before.model.observedModel,row.after.model.observedModel]),[['model-b','model-c'],['model-a','model-b']]);
  });
  await fixture([context('requested','standard'),response('a',1,'observed'),context('requested','fast'),response('b',2,'observed')],async store=>{
    const view=modelTransitions(store);assert.equal(view.changeCount,1);assert.equal(view.transitions[0].kind,'metadata_change');assert.deepEqual(view.transitions[0].changedFields,['serviceTier']);
  });
});
test('unknown/quarantined positions break comparisons, scoped model/tier filters cannot create a complete-population claim',async()=>{
  await fixture([response('a',1,'model-a'),response('unknown',2),response('b',3,'model-b'),response('bad',4,'model-c'),response('bad',4,'model-c',9),response('d',5,'model-d')],async store=>{
    const view=modelTransitions(store);assert.equal(view.changeCount,0);assert.equal(view.unknownModelEntries,1);assert.equal(view.blockedPositions,1);assert.equal(view.eligibleEntries,4);
    const filtered=modelTransitions(store,{attributedModel:'model-a',provider:'openai',serviceTier:null,from:'2026-10-14T00:00:00Z'});assert.equal(filtered.eligibleEntries,1);assert.equal(filtered.changeCount,0);
    assert.throws(()=>modelTransitions(store,{limit:1}),/INVALID_MODEL_TRANSITION_SCOPE/);
  });
});
test('same-position contradictions, independent source streams and generation boundaries remain explicit; full counts exceed display cap',async()=>{
  await fixture([response('a',1,'model-a'),response('b',1,'model-b'),response('c',2,'model-c')],async(store,collector,root)=>{
    const view=modelTransitions(store);assert.equal(view.ambiguousPositions,1);assert.equal(view.changeCount,0);
    await writeFile(path.join(root,'other.jsonl'),lines([header,response('other',1,'model-other')]));await collector.scan();assert.equal(modelTransitions(store).changeCount,0);
    await writeFile(path.join(root,'run.jsonl'),lines([header,response('new-gen-a',1,'model-z'),response('new-gen-b',2,'model-y')]));await collector.scan();
    const rotated=modelTransitions(store);assert.equal(rotated.changeCount,1);assert.equal(rotated.transitions[0].generation,1);assert.equal(rotated.transitions[0].before.model.observedModel,'model-z');
  });
  await fixture(Array.from({length:205},(_,n)=>response(`r-${n}`,n+1,`model-${n%2}`)),async store=>{
    const view=modelTransitions(store);assert.equal(view.changeCount,204);assert.equal(view.transitions.length,200);assert(view.limited);assert.equal(view.observedModelChanges,204);
    const newer=modelTransitions(store,{from:'2026-10-14T00:03:00Z'});assert.equal(newer.eligibleEntries,26);assert.equal(newer.changeCount,25);
  });
});
