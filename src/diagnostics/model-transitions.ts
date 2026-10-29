import { InspectorStore, validateQuery } from '../storage/InspectorStore';
import { privacyVersion } from '../storage/project-privacy';
import { digest } from '../accounting/codex-observations';
import { manualUsdPrice, entryUsdEstimate } from '../accounting/manual-usd';
import type { LedgerEntry, ModelAttribution, TokenValues } from '../shared/inspector';
import type { ModelTransition, ModelTransitionEndpoint, ModelTransitionsView } from '../shared/model-transitions';

const fields = ['requestedModel','observedModel','providerRoute','serviceTier','quotaAlias'] as const;
interface Item { entry: LedgerEntry; ordinal: string | null; record: string; positionCount?: number; }
export function modelTransitions(store: InspectorStore, input: unknown = {}): ModelTransitionsView {
  const query = validateQuery(input); if (query.cursor || query.limit || query.includeQuarantined !== undefined) throw new Error('INVALID_MODEL_TRANSITION_SCOPE');
  const filter = store.queryFilter(query,'l'); const price = manualUsdPrice(store);
  const result: ModelTransitionsView = { query, revision: store.revision(), privacyVersion: privacyVersion(store), priceId: price?.id ?? null,
    eligibleEntries: 0, streams: 0, changeCount: 0, observedModelChanges: 0, attributionChanges: 0, unknownModelEntries: 0, blockedPositions: 0, ambiguousPositions: 0, transitions: [], limited: false,
    notes: ['Comparisons are between adjacent matching retained positions in one recording source/generation/thread/machine. No cross-source execution order or complete transition population is asserted.',
      'Observed model, requested model, provider route, recorded service tier and quota alias are distinct. Requested/fallback changes do not prove a provider model switch.',
      'Aggregates, quarantined entries, unknown effective models and ambiguous same-position attributions break comparisons. Filters can hide intermediate positions.',
      'Interval model metadata describes its recorded attribution; the interval can span multiple requests/models. Endpoint costs are independent API-equivalent estimates, not causal switching costs.',
      'Detailed rows show at most the first 200 candidates encountered by recording stream, then sort that subset by source time; this is not the globally newest 200.'] };
  const endpoint = (entry: LedgerEntry): ModelTransitionEndpoint => {
    const estimate = price ? entryUsdEstimate(entry,price) : { reason: 'CONVERSION_DISABLED' };
    return { ledgerId: entry.id, ledgerRevision: entry.revision, grain: entry.grain, timestamp: entry.endAt, model: entry.model,
      values: Object.fromEntries(Object.entries(entry.usage).map(([key,value])=>[key,value.value])) as TokenValues, evidenceRef: entry.evidenceRefs[0] ?? null,
      usdUnits: 'reason' in estimate ? null : estimate.lower.toString(), usdUpperUnits: 'reason' in estimate ? null : estimate.upper.toString(), unpricedReason: 'reason' in estimate ? estimate.reason : null };
  };
  const process = (items: Item[], machineId: string, threadId: string | null, sourceId: string, generation: number) => {
    if (!items.length) return; result.streams++; const native = items.every(item=>item.ordinal!==null); const position = (item:Item)=>native?item.ordinal!:item.record;
    items.sort((a,b)=>BigInt(position(a))<BigInt(position(b))?-1:BigInt(position(a))>BigInt(position(b))?1:a.entry.id.localeCompare(b.entry.id));
    let previous: Item | undefined;
    for(let index=0;index<items.length;) {
      const currentPosition=position(items[index]);const group:Item[]=[];while(index<items.length&&position(items[index])===currentPosition)group.push(items[index++]);
      const usable=group.filter(item=>item.entry.selectionStatus==='selected'&&item.entry.grain!=='aggregate');result.eligibleEntries+=usable.length;
      if (usable.length!==group.length) { result.blockedPositions++;previous=undefined;continue; }
      const models = new Set(usable.map(item=>JSON.stringify(fields.map(field=>item.entry.model[field]))));
      if (models.size>1) { result.ambiguousPositions++;previous=undefined;continue; }
      const current=usable[0]; if(!current)continue;
      current.positionCount=usable.length;
      const effective=(model:ModelAttribution)=>model.observedModel??model.requestedModel;
      if(!effective(current.entry.model)) {result.unknownModelEntries+=usable.length;previous=undefined;continue;}
      if(previous) {
        const changed=fields.filter(field=>previous!.entry.model[field]!==current.entry.model[field]);
        if(changed.length) {
          const before=previous.entry.model;const after=current.entry.model;
          const kind:ModelTransition['kind']=before.observedModel!==null&&after.observedModel!==null&&before.observedModel!==after.observedModel?'observed_model_change'
            : before.observedModel!==after.observedModel||effective(before)!==effective(after)?'attribution_change'
            : before.requestedModel!==after.requestedModel?'configuration_change':'metadata_change';
          result.changeCount++;if(kind==='observed_model_change')result.observedModelChanges++;if(kind==='attribution_change')result.attributionChanges++;
          if(result.transitions.length<200) {
            const notes:string[]=[];if(previous.entry.grain==='interval'||current.entry.grain==='interval')notes.push('INTERVAL_ATTRIBUTION_NOT_PER_REQUEST_MODEL');
            if((previous.positionCount??1)>1||(current.positionCount??1)>1)notes.push('MULTIPLE_ENTRIES_AT_POSITION_REPRESENTATIVE_ONLY');
            if(previous.entry.endAt&&current.entry.endAt&&previous.entry.endAt>current.entry.endAt)notes.push('SOURCE_ORDER_CONTRADICTS_TIMESTAMP_ORDER');
            result.transitions.push({id:`model-transition:${digest(JSON.stringify([previous.entry.id,current.entry.id,currentPosition]))}`,machineId,threadId,sourceId,generation,orderBasis:native?'native_ordinal':'source_record',beforePosition:position(previous),afterPosition:currentPosition,kind,changedFields:changed,before:endpoint(previous.entry),after:endpoint(current.entry),notes});
          } else result.limited=true;
        }
      }
      previous=current;
    }
  };
  let key='';let group:Item[]=[];let meta:{machine:string;thread:string|null;source:string;generation:number}|undefined;
  const rows=store.db.prepare(`SELECT l.entry,l.machine_id,l.thread_id,l.source_id,p.source_generation,l.sequence,CAST(p.native_ordinal AS TEXT) AS ordinal FROM scope_state a CROSS JOIN ledger l ON a.scope_id=l.scope_id AND a.active_revision=l.revision JOIN ledger_memberships p ON p.id=l.id AND p.revision=l.revision WHERE ${filter.sql} ORDER BY l.source_id,p.source_generation,l.machine_id,l.thread_id,l.sequence,l.id`);
  for(const row of rows.iterate(...filter.args)) {
    if(row.source_generation===null||row.machine_id===null) {result.blockedPositions++;continue;}
    const next=JSON.stringify([row.source_id,row.source_generation,row.machine_id,row.thread_id]);
    if(next!==key) {if(meta)process(group,meta.machine,meta.thread,meta.source,meta.generation);group=[];key=next;meta={machine:String(row.machine_id),thread:row.thread_id===null?null:String(row.thread_id),source:String(row.source_id),generation:Number(row.source_generation)};}
    group.push({entry:JSON.parse(String(row.entry)) as LedgerEntry,ordinal:row.ordinal===null?null:String(row.ordinal),record:String(row.sequence)});
  }
  if(meta)process(group,meta.machine,meta.thread,meta.source,meta.generation);
  result.transitions.sort((a,b)=>(b.after.timestamp??'').localeCompare(a.after.timestamp??'')||a.id.localeCompare(b.id));
  return result;
}
