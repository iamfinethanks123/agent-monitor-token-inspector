import { InspectorStore, validateQuery } from '../storage/InspectorStore';
import type { DataQualityView, QualityCounts } from '../shared/data-quality';
import type { NormalizedObservation } from '../accounting/codex-observations';
import { TOKEN_FIELDS } from '../shared/inspector';

/** Counts retained normalized envelopes separately from canonical usage memberships. */
export function dataQuality(store: InspectorStore, input: unknown = {}): DataQualityView {
  const query = validateQuery(input); delete query.cursor; delete query.limit;
  const filter = store.metadataFilter(query, 'o.timestamp', 'COALESCE(a.normalized,o.normalized)', 'context.');
  const empty = (): QualityCounts => ({ records:0,supported:0,unsupported:0,gaps:0,semanticIssues:0,skippedBytes:'0',lastSuccessfulReceipt:null,unknownKinds:0 });
  const total=empty();const unknownKinds=new Set<string>();
  const sourceGroups=new Map<string,{counts:QualityCounts;schemas:Set<string>;unknown:Set<string>}>();
  const schemaGroups=new Map<string,{fingerprint:string;records:number;unsupported:number}>();
  const rows=store.db.prepare(`SELECT o.source_id,CAST(o.byte_end-o.byte_start AS TEXT) AS span,o.received_at,COALESCE(a.normalized,o.normalized) AS n FROM observations o JOIN sources s ON s.id=o.source_id LEFT JOIN source_analysis r ON r.source_id=s.id LEFT JOIN observation_analyses a ON a.observation_id=o.id AND a.revision=r.revision WHERE ${filter.sql}`);
  for(const row of rows.iterate(...filter.args)) {
    const observation=JSON.parse(String(row.n)) as NormalizedObservation;const sourceId=String(row.source_id);
    let group=sourceGroups.get(sourceId);if(!group){group={counts:empty(),schemas:new Set(),unknown:new Set()};sourceGroups.set(sourceId,group);}
    const gap=observation.kind.startsWith('gap/');const issues=observation.issues.length>0||observation.measurements.some(item=>item.issues.length>0);
    for(const counts of [total,group.counts]) {counts.records++;if(observation.supported)counts.supported++;else counts.unsupported++;
      if(gap){counts.gaps++;counts.skippedBytes=(BigInt(counts.skippedBytes)+BigInt(String(row.span))).toString();}else if(issues)counts.semanticIssues++;
      if(observation.supported&&!issues&&(!counts.lastSuccessfulReceipt||String(row.received_at)>counts.lastSuccessfulReceipt))counts.lastSuccessfulReceipt=String(row.received_at);
    }
    if(!observation.supported&&!gap){unknownKinds.add(observation.kind);group.unknown.add(observation.kind);}
    group.schemas.add(observation.schemaFingerprint);
    let schema=schemaGroups.get(observation.schemaFingerprint);if(!schema){schema={fingerprint:/^[a-f0-9]{64}$/.test(observation.schemaFingerprint)?observation.schemaFingerprint:observation.schemaFingerprint==='unparsed'?'unparsed':'unknown',records:0,unsupported:0};schemaGroups.set(observation.schemaFingerprint,schema);}schema.records++;if(!observation.supported)schema.unsupported++;
  }
  total.unknownKinds=unknownKinds.size;const sourceCount=sourceGroups.size;const sources=[];
  for(const [id,group] of [...sourceGroups].sort(([a],[b])=>a.localeCompare(b)).slice(0,200)) {
    const cursor=store.getSource(id);if(!cursor)continue;const item={...group.counts,unknownKinds:group.unknown.size};const fileBytes=cursor.capabilities.includes('statistics-only-v2')?null:String(cursor.fileBytes);
    sources.push({...item,id:cursor.id,machineId:cursor.machineId,threadId:cursor.context.threadId,generation:cursor.generation,bytesProcessed:String(cursor.offset),fileBytes,
      backlogBytes:fileBytes===null||cursor.offset>cursor.fileBytes?null:(BigInt(cursor.fileBytes)-BigInt(cursor.offset)).toString(),sizeChanged:fileBytes!==null&&cursor.offset>cursor.fileBytes,
      state:cursor.waitingForRecord||cursor.issues.length||item.unsupported||item.semanticIssues?'partial':fileBytes!==null&&cursor.offset<cursor.fileBytes?'catching_up':'current',
      capabilityLimited:item.unsupported>0||item.semanticIssues>0||!cursor.capabilities.length,capabilities:cursor.capabilities.filter(value=>['identified_response','cumulative_interval','codex-passive/1','statistics-only-v2','compaction-lifecycle'].includes(value)),schemaCount:group.schemas.size});
  }
  const schemaCount=schemaGroups.size;const schemas=[...schemaGroups.values()].sort((a,b)=>b.records-a.records||a.fingerprint.localeCompare(b.fingerprint)).slice(0,32);
  const ledgerFilter = store.queryFilter(query, 'l');
  const missing = Object.fromEntries(TOKEN_FIELDS.map(field=>[field,0])) as DataQualityView['ledger']['missing'];
  const ledger = { selected: 0, quarantined: 0, additionalResponseSupports: '0', missing };
  const fields = TOKEN_FIELDS.map(field=>`SUM(CASE WHEN l.status='selected' AND json_extract(l.entry,'$.usage.${field}.value') IS NULL THEN 1 ELSE 0 END) AS ${field}`).join(',');
  const row = store.db.prepare(`SELECT SUM(CASE WHEN l.status='selected' THEN 1 ELSE 0 END) AS selected,SUM(CASE WHEN l.status='quarantined' THEN 1 ELSE 0 END) AS quarantined,CAST(COALESCE(SUM(CASE WHEN l.status='selected' AND json_extract(l.entry,'$.grain')='response' THEN MAX(COALESCE(json_extract(l.entry,'$.evidenceCount'),1)-1,0) ELSE 0 END),0) AS TEXT) AS supports,${fields} FROM scope_state a CROSS JOIN ledger l ON a.scope_id=l.scope_id AND a.active_revision=l.revision WHERE ${ledgerFilter.sql}`).get(...ledgerFilter.args)!;
  ledger.selected=Number(row.selected??0);ledger.quarantined=Number(row.quarantined??0);ledger.additionalResponseSupports=String(row.supports);for(const field of TOKEN_FIELDS)missing[field]=Number(row[field]??0);
  return { revision: store.revision(), measuredAt: new Date().toISOString(), scope: query, counts: total, sources, sourceCount, sourceDetailsLimited: sourceCount>sources.length, schemas, schemaCount, schemaDetailsLimited: schemaCount>schemas.length, ledger,
    notes: ['Record counts cover retained normalized envelopes matching metadata filters; ledger counts independently cover current canonical memberships. These populations must not be added.',
      'Gap byte spans describe unparsed retained source ranges, not unsupported decoded envelopes or provider tokens. Unknown-time records are excluded by date filters.',
      'Offsets, file sizes and backlog cover the whole matching source, regardless of record date/model/project filters. Remote statistics-only sources have unknown file size and backlog.',
      'Last successful receipt is the latest issue-free supported retained envelope commit time, not execution time or proof that the whole file parsed successfully.',
      'Additional response supports can be replays or complementary evidence; they do not establish identical content, duplicate billing or wasted tokens.',
      'Schema fingerprints describe envelope structure, not content equality. Current parsing capability does not establish the complete request population.',
      'Details retain at most 200 sources and 32 schema fingerprints; aggregate counts cover all matching retained records. No raw contents, paths, source labels or arbitrary error text are exported.'] };
}
