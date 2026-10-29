import { object,timestamp } from '../accounting/codex-observations';
import { integer } from '../accounting/integers';
import type { InspectorStore } from '../storage/InspectorStore';
import type { CollectorHealthSummary,CollectorHealthSnapshot } from '../shared/collector-health';
const fields=['schemaVersion','measuredAt','adapterVersion','sourceCount','partialSources','discoveryErrors','records','unsupportedRecords','gapRecords','semanticIssueRecords','unparsedBytes','lastSuccessfulReceiptAt'];
export const healthKey=(deviceId:string)=>`collector-health:${deviceId}`;
export function validateCollectorHealth(input:unknown):CollectorHealthSummary {
  const value=object(input);if(!value||Object.keys(value).some(key=>!fields.includes(key))||fields.some(key=>!Object.hasOwn(value,key))||value.schemaVersion!=='collector-health/1'||value.adapterVersion!=='codex-passive/1')throw new Error('INVALID_COLLECTOR_HEALTH');
  for(const key of ['sourceCount','partialSources','discoveryErrors','records','unsupportedRecords','gapRecords','semanticIssueRecords'])if(!Number.isSafeInteger(value[key])||Number(value[key])<0||Number(value[key])>1000000000)throw new Error('INVALID_COLLECTOR_HEALTH');
  if(Number(value.partialSources)>Number(value.sourceCount)||Number(value.unsupportedRecords)>Number(value.records)||Number(value.gapRecords)>Number(value.unsupportedRecords)||Number(value.semanticIssueRecords)>Number(value.records))throw new Error('INVALID_COLLECTOR_HEALTH');
  const measuredAt=timestamp(value.measuredAt);const success=value.lastSuccessfulReceiptAt===null?null:timestamp(value.lastSuccessfulReceiptAt);if(!measuredAt||value.lastSuccessfulReceiptAt!==null&&!success||typeof value.unparsedBytes!=='string')throw new Error('INVALID_COLLECTOR_HEALTH');
  let bytes:string;try{bytes=integer(value.unparsedBytes);}catch{throw new Error('INVALID_COLLECTOR_HEALTH');}
  return {...value,measuredAt,lastSuccessfulReceiptAt:success,unparsedBytes:bytes} as unknown as CollectorHealthSummary;
}
export function receiveCollectorHealth(store:InspectorStore,deviceId:string,value:unknown):void {
  const summary=validateCollectorHealth(value);const snapshot:CollectorHealthSnapshot={receivedAt:new Date().toISOString(),summary,provenance:'client_reported'};store.setSetting(healthKey(deviceId),JSON.stringify(snapshot));
}
export function readCollectorHealth(store:InspectorStore,deviceId:string):CollectorHealthSnapshot|null {
  const body=store.getSetting(healthKey(deviceId));if(!body)return null;try{const value=JSON.parse(body) as CollectorHealthSnapshot;const receivedAt=timestamp(value.receivedAt);if(!receivedAt||value.provenance!=='client_reported')return null;return {receivedAt,provenance:'client_reported',summary:validateCollectorHealth(value.summary)};}catch{return null;}
}
