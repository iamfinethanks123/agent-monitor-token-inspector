import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { InspectorStore } from '../src/storage/InspectorStore';
import { IndexCollector } from '../src/collector/IndexCollector';
import { analyze } from '../src/diagnostics/analyze';
import { detectorConfusion, type DetectorCaseResult, type DetectorEvaluation } from '../src/shared/detector-evaluation';

const manifestPath = path.resolve('tests/fixtures/detector-corpus.json');
const manifestBody = await readFile(manifestPath,'utf8');
interface Case { id:string;detectorId:string;scenario:string;count:number;pattern:boolean|null;candidate:boolean|null;rationale:string;verify?:boolean;edit?:boolean;partial?:boolean;changing?:boolean;noKey?:boolean;success?:boolean;bytes?:number;annotation?:'intentional'|'resolved';duplicate?:boolean;starts?:boolean;wide?:boolean; }
const corpus = JSON.parse(manifestBody) as {schemaVersion:string;id:string;reviewedAt:string;reviewedBy:string;labelingPolicy:string;cases:Case[]};
if(corpus.schemaVersion!=='reviewed-detector-corpus/1'||!corpus.reviewedBy||!corpus.labelingPolicy||!corpus.cases.length||new Set(corpus.cases.map(c=>c.id)).size!==corpus.cases.length)throw new Error('INVALID_DETECTOR_CORPUS');
const at = (second:number) => new Date(Date.UTC(2026,9,15,0,0,second)).toISOString();
function fixture(c:Case): string {
  const records:unknown[]=[{type:'session_meta',payload:{id:c.id,model_provider:'openai'}},{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:c.verify?'Independent verification and retry protocol.':'Inspect the captured operation.'}]}}];
  const call=(id:string,cmd:string,second:number,output:string,partial=false)=>records.push({type:'response_item',timestamp:at(second),payload:{type:'function_call',call_id:id,name:'exec_command',arguments:JSON.stringify({cmd})}},{type:'response_item',timestamp:at(second+0.1),payload:{type:'function_call_output',call_id:id,output,truncated:partial}});
  const edit=(id:string,second:number)=>records.push({type:'response_item',timestamp:at(second),payload:{type:'custom_tool_call',call_id:id,name:'apply_patch',input:'*** Begin Patch\n*** Update File: fixture.ts\n@@\n-a\n+b\n*** End Patch'}},{type:'response_item',timestamp:at(second+0.1),payload:{type:'custom_tool_call_output',call_id:id,output:'Success. Updated fixture.ts'}});
  if(c.scenario==='read') { if(c.edit)edit('edit',0);for(let i=0;i<c.count;i++)call('read-'+i,'cat fixture.ts',i*2+1,'r'.repeat(10000)+(c.changing?String(i):''),c.partial); }
  else if(c.scenario==='retry') { for(let i=0;i<c.count;i++){if(c.edit&&i)edit('edit-'+i,i*3);call('try-'+i,'npm test',i*3+1,`Wall time: ${i}.123 seconds\nError: Expected value 4, received 5\nProcess exited with code 1`);}if(c.success)call('success','npm test',c.count*3+1,'All checks passed\nProcess exited with code 0'); }
  else if(c.scenario==='polling') { call('start','npm test',0,'Process running with session ID 42');for(let i=0;i<c.count;i++)records.push({type:'response_item',timestamp:at(i+1),payload:{type:'function_call',call_id:'poll-'+i,name:'write_stdin',arguments:JSON.stringify({session_id:42,chars:''})}},{type:'response_item',timestamp:at(i+1.1),payload:{type:'function_call_output',call_id:'poll-'+i,output:'Process running with session ID 42'}}); }
  else if(c.scenario==='large')call('large','npm test',0,'l'.repeat(c.bytes!));
  else if(c.scenario==='compaction')for(let i=0;i<c.count;i++)records.push({type:'event_msg',timestamp:at(c.wide?i*360:i),payload:{type:c.starts?'item_started':'item_completed',thread_id:c.id,item:{type:'ContextCompaction',id:c.duplicate?'one':'item-'+i}}});
  else if(c.scenario==='unsupported')records.push({type:'future_envelope',payload:{counter:1}});
  else if(!['gap','tail'].includes(c.scenario))throw new Error('UNKNOWN_CORPUS_SCENARIO');
  records.push({type:'token_usage_record',timestamp:at(1000),payload:{thread_id:c.id,response_id:c.id+'-usage',usage:{input_tokens:10,output_tokens:2}}});
  return records.map(r=>JSON.stringify(r)).join('\n')+'\n'+(c.scenario==='gap'?'{bad json}\n':c.scenario==='tail'?'{"partial":':'');
}
const root = await mkdtemp(path.join(os.tmpdir(),'reviewed-detector-corpus-')), results:DetectorCaseResult[]=[];
try {
  for(const c of corpus.cases){if(!/^[a-z][a-z0-9-]{0,63}$/.test(c.id)||!Number.isInteger(c.count)||c.count>20||c.bytes!==undefined&&(!Number.isInteger(c.bytes)||c.bytes<1||c.bytes>1048576)||!c.rationale||![true,false,null].includes(c.pattern)||![true,false,null].includes(c.candidate)||c.count<1)throw new Error('INVALID_CORPUS_LABEL');
    const folder=path.join(root,c.id);await mkdir(folder);await writeFile(path.join(folder,'fixture.jsonl'),fixture(c));const store=new InspectorStore(':memory:');
    try{await new IndexCollector(store,[folder],c.noKey?undefined:'synthetic-corpus-workspace-key').scan();let findings=analyze(store).findings.filter(f=>f.detectorId===c.detectorId);if(c.annotation){for(const f of findings)store.annotate(f.id,c.annotation);findings=analyze(store).findings.filter(f=>f.detectorId===c.detectorId);}
      if(store.summary().usage.total.value!=='12')throw new Error('CORPUS_ACCOUNTING_CHANGED');
      results.push({id:c.id,detectorId:c.detectorId,expectedPattern:c.pattern,expectedCandidate:c.candidate,observedPattern:findings.length>0,observedCandidate:findings.some(f=>f.plan?.state==='candidate'),emittedFindings:findings.length,detectorVersions:[...new Set(findings.map(f=>f.detectorVersion))],suppressedFindings:findings.filter(f=>f.plan?.state==='review_only').length,rationale:c.rationale});
    }finally{store.close();}
  }
  const files=['src/diagnostics/analyze.ts','src/diagnostics/retry-progress.ts','src/diagnostics/thresholds.ts','src/diagnostics/compactions.ts','src/accounting/codex-observations.ts','src/accounting/tool-metadata.ts','src/shared/advice-plan.ts','scripts/evaluate-detectors.ts'];const hash=createHash('sha256');for(const file of files)hash.update(file).update(await readFile(file));
  const report:DetectorEvaluation={schemaVersion:'detector-evaluation/1',state:'measured',corpusId:corpus.id,sourceDigest:hash.digest('hex'),corpusDigest:createHash('sha256').update(manifestBody).digest('hex'),measuredAt:new Date().toISOString(),reviewedAt:corpus.reviewedAt,reviewedBy:corpus.reviewedBy,labelingPolicy:corpus.labelingPolicy,caseCount:results.length,unit:'case_target_detector',synthetic:true,pattern:detectorConfusion(results,'pattern'),candidate:detectorConfusion(results,'candidate'),detectors:[...new Set(results.map(r=>r.detectorId))].map(id=>{const cases=results.filter(r=>r.detectorId===id);return{id,cases:cases.length,versions:[...new Set(cases.flatMap(c=>c.detectorVersions))],pattern:detectorConfusion(cases,'pattern'),candidate:detectorConfusion(cases,'candidate')};}),cases:results};
  await writeFile('src/shared/detector-corpus-results.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({cases:report.caseCount,pattern:report.pattern,candidate:report.candidate,mismatches:results.filter(c=>c.expectedPattern!==null&&c.expectedPattern!==c.observedPattern||c.expectedCandidate!==null&&c.expectedCandidate!==c.observedCandidate).map(c=>c.id)}));
}finally{await rm(root,{recursive:true,force:true});}
