import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { detectorConfusion, type DetectorCaseResult } from '../src/shared/detector-evaluation';
import results from '../src/shared/detector-corpus-results.json';
import { InspectorStore } from '../src/storage/InspectorStore';
import { report } from '../src/reporting/report';

const row=(id:string,expected:boolean|null,actual:boolean):DetectorCaseResult=>({id,detectorId:'fixture',expectedPattern:expected,expectedCandidate:expected,observedPattern:actual,observedCandidate:actual,emittedFindings:actual?1:0,detectorVersions:['1'],suppressedFindings:0,rationale:'Hand-labeled metric fixture'});
test('precision/recall use TP/FP/FN denominators, exclude unknown labels and keep zero denominators undefined',()=>{
  const metrics=detectorConfusion([row('tp',true,true),row('fp',false,true),row('fn',true,false),row('tn',false,false),row('unknown',null,false)],'pattern');
  assert.deepEqual(metrics,{truePositive:1,falsePositive:1,falseNegative:1,trueNegative:1,unscored:1,precision:0.5,recall:0.5});
  assert.equal(detectorConfusion([row('negative',false,false)],'candidate').precision,null);assert.equal(detectorConfusion([row('negative',false,false)],'candidate').recall,null);
});
test('the build report preserves corpus labels and exports only synthetic evaluation, independently of private project data',()=>{
  const manifest=JSON.parse(readFileSync('tests/fixtures/detector-corpus.json','utf8'));
  assert.equal(results.caseCount,manifest.cases.length);assert.equal(results.synthetic,true);assert.equal(results.unit,'case_target_detector');assert.equal(results.pattern.unscored,1);assert.equal(results.candidate.unscored,1);
  for(const label of manifest.cases){const measured=results.cases.find(c=>c.id===label.id)!;assert(measured);assert.equal(measured.expectedPattern,label.pattern);assert.equal(measured.expectedCandidate,label.candidate);assert.equal(measured.rationale,label.rationale);}
  const store=new InspectorStore(':memory:');try{
    for(const format of ['json','markdown','csv']){const output=report(store,{projectId:'project:'+ 'a'.repeat(24)},format,{table:'detector-evaluation'});assert.equal(output.projectIds.length,0);assert(output.body.includes(results.corpusId));assert(!output.body.includes('project:'+ 'a'.repeat(24)));}
    const parsed=JSON.parse(report(store,{},'json',{table:'detector-evaluation'}).body);assert.equal(parsed.scope,'synthetic_build_corpus');assert.equal(parsed.caseCount,24);assert(parsed.limitations.join(' ').includes('not production accuracy'));
    assert.throws(()=>report(store,{},'json',{table:'detector-evaluation',includeTaskNotes:true}),/INVALID_REPORT_OPTIONS/);assert.equal(store.observationCount(),0);
  }finally{store.close();}
});
