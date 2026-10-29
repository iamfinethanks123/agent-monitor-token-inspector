import { digest, toolIdentity, object, timestamp, type NormalizedObservation } from '../accounting/codex-observations';
import { metric } from '../accounting/integers';
import { validateQuery, type InspectorStore } from '../storage/InspectorStore';
import { privacyVersion } from '../storage/project-privacy';
import { manifests } from '../storage/context-manifests';
import { CONTEXT_ORIGINS } from '../shared/context-manifests';
import type { ContextAttributionView, ContextOccurrence } from '../shared/context-attribution';

/** Source occurrences are emitted text, not inferred inclusion in later requests. */
export function contextAttribution(store: InspectorStore, input: unknown = {}): ContextAttributionView {
  const value = object(input); if (!value || Object.keys(value).some(key => !['query', 'origin'].includes(key)) || value.origin !== undefined && !CONTEXT_ORIGINS.includes(value.origin as ContextOccurrence['origin'])) throw new Error('INVALID_CONTEXT_QUERY');
  const query = validateQuery(value.query); const epoch = privacyVersion(store); const analysis = store.getSetting('timeline_analysis_epoch') ?? '0';
  const hash = digest(JSON.stringify({ ...query, cursor: undefined, limit: undefined, origin: value.origin }));
  let after = 0; let watermark = Number(store.db.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM timeline_events WHERE workspace_id=?').get(store.workspaceId)!.n);
  let cutoff = query.days ? new Date(Date.now() - query.days * 86400000).toISOString() : null;
  if (query.cursor) {
    let cursor; try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); } catch { throw new Error('INVALID_CURSOR'); }
    if (cursor.hash !== hash || cursor.privacy !== epoch || cursor.analysis !== analysis || !Number.isSafeInteger(cursor.after) || !Number.isSafeInteger(cursor.watermark) || cursor.after < 0 || cursor.watermark < cursor.after || cursor.cutoff !== null && timestamp(cursor.cutoff) !== cursor.cutoff) throw new Error('INVALID_CURSOR');
    after = cursor.after; watermark = cursor.watermark; cutoff = cursor.cutoff;
  }
  const filter = store.metadataFilter({ ...query, days: undefined, from: cutoff && (!query.from || cutoff > query.from) ? cutoff : query.from }, 'e.timestamp', 'COALESCE(a.normalized,o.normalized)', 'context.');
  const categories = new Map<ContextOccurrence['origin'], { count: number; bytes: bigint; tokens: bigint; byteRows: number; tokenRows: number }>(); const selected: { sequence: number; item: ContextOccurrence }[] = [];
  const seen = new Set<string>(); const limit = query.limit ?? 50; let count = 0;
  const toolById = store.db.prepare('SELECT name,input_metadata FROM tool_index WHERE id=?');
  const rows = store.db.prepare(`SELECT e.sequence,e.machine_id,e.thread_id,e.source_id,e.timestamp,o.id,o.evidence_ref,o.generation,COALESCE(a.normalized,o.normalized) AS normalized
    FROM timeline_events e CROSS JOIN observations o ON o.id=e.observation_id JOIN sources s ON s.id=e.source_id
    LEFT JOIN source_analysis r ON r.source_id=e.source_id LEFT JOIN observation_analyses a ON a.observation_id=o.id AND a.revision=r.revision
    WHERE e.workspace_id=? AND e.sequence<=? AND ${filter.sql} AND (e.kind='response_item/message' OR e.kind LIKE 'response_item/%output' OR e.kind LIKE 'response_item/%result') ORDER BY e.sequence`);
  for (const row of rows.iterate(store.workspaceId, watermark, ...filter.args)) {
    const n = JSON.parse(String(row.normalized)) as NormalizedObservation; const m = n.metadata;
    if (m.outputBytes === undefined && !m.nonTextParts) continue;
    const tool = m.callId ? toolById.get(toolIdentity(store.workspaceId, String(row.source_id), Number(row.generation), n.context.threadId, m.callId)) : null;
    const call = tool?.input_metadata ? JSON.parse(String(tool.input_metadata)) as NormalizedObservation['metadata'] : null;
    const identity = m.callId ? JSON.stringify([row.source_id, row.generation, row.thread_id, m.callId]) : String(row.id);
    if (seen.has(identity)) continue; seen.add(identity);
    let origin: ContextOccurrence['origin'] = 'unknown'; let transport: ContextOccurrence['transport'] = 'other'; let classification: ContextOccurrence['classification'] = 'adapter';
    if (n.kind === 'response_item/message') { origin = m.role === 'user' ? 'user_instruction' : m.role === 'assistant' ? 'agent_message' : m.role === 'system' || m.role === 'developer' ? 'visible_instruction' : 'unknown'; transport = m.role === 'user' ? 'user_message' : 'other'; }
    else { transport = 'tool_result'; origin = call?.origin === 'project_file' ? 'project_file' : call?.origin === 'command_output' ? 'command_output' : call?.origin === 'external_document' ? 'external_document' : 'unknown';
      if (call?.definition) { origin = call.definition.kind === 'skill_definition' ? 'skill_definition' : 'visible_instruction'; classification = 'parsed_path'; }
    }
    if (origin === 'unknown') classification = 'unknown';
    const category = categories.get(origin) ?? { count: 0, bytes: 0n, tokens: 0n, byteRows: 0, tokenRows: 0 }; category.count++; category.bytes += BigInt(m.outputBytes ?? '0'); category.tokens += BigInt(m.payloadTokenEstimate ?? '0'); if (m.outputBytes !== undefined) category.byteRows++; if (m.payloadTokenEstimate !== undefined) category.tokenRows++; categories.set(origin, category); count++;
    if (Number(row.sequence) <= after || value.origin && origin !== value.origin || selected.length >= limit + 1) continue;
    const ref = String(row.evidence_ref); const estimate = metric(m.payloadTokenEstimate ?? null, m.payloadTokenEstimate === undefined ? 'unknown' : 'estimated', 'tokenizer', [ref], ['Captured text only; approximate UTF-8 bytes / 4. Serialization, nontext billing and later request inclusion are not measured.']);
    selected.push({ sequence: Number(row.sequence), item: { id: String(row.id), sourceId: String(row.source_id), machineId: String(row.machine_id), threadId: row.thread_id === null ? null : String(row.thread_id), timestamp: row.timestamp === null ? null : String(row.timestamp), origin, transport,
      state: m.captureComplete === false ? 'truncated' : 'unknown', contextEpoch: n.context.contextEpoch, bytes: m.outputBytes ?? null,
      originalBytes: metric(null, 'unknown', 'unknown'), estimate, requestExposure: metric(null, 'unknown', 'unknown'), evidenceRefs: [ref], toolName: tool?.name == null ? null : String(tool.name), definition: call?.definition?.kind ?? null, classification, nonTextParts: m.nonTextParts ?? { image: 0, audio: 0, other: 0 } } });
  }
  const page = selected.slice(0, limit); const requests = manifests(store, { ...query, cursor: undefined, limit: 20 });
  const ledgerFilter = store.queryFilter(query, 'l'); let inputTotal = 0n; let inputKnown = 0; let inputMissing = 0; const inputRefs: string[] = [];
  for (const row of store.db.prepare(`SELECT l.id,json_extract(p.entry,'$.usage.input.value') AS input FROM scope_state r CROSS JOIN ledger_memberships l ON l.scope_id=r.scope_id AND l.revision=r.active_revision JOIN ledger_payloads p ON p.id=l.payload_id WHERE ${ledgerFilter.sql.replaceAll('l.entry', 'p.entry')} AND l.status='selected'`).iterate(...ledgerFilter.args)) {
    if (inputRefs.length < 20) inputRefs.push(String(row.id)); if (row.input === null) inputMissing++; else { inputKnown++; inputTotal += BigInt(String(row.input)); }
  }
  const providerInput = metric(inputKnown ? inputTotal.toString() : null, 'derived', 'monitor_calculation', inputRefs, inputMissing ? [`Known subtotal only; ${inputMissing} selected entries omit input.`] : []);
  const lineages = new Map<string, { clientId: string; contentId: string; entries: Set<string>; count: number; tokens: bigint; tokenizers: Set<string>; complete: boolean }>();
  for (const request of requests.items) if (request.linkage === 'matched' && request.ledgerEntryId) for (const item of request.manifest.items) {
    const detail = item.facets; if (!detail?.contentId || !detail.included) continue;
    const key = JSON.stringify([request.manifest.clientId, detail.contentId]); const lineage = lineages.get(key) ?? { clientId: request.manifest.clientId, contentId: detail.contentId, entries: new Set(), count: 0, tokens: 0n, tokenizers: new Set(), complete: true };
    lineage.entries.add(request.ledgerEntryId); lineage.count++; if (item.estimate) { lineage.tokens += BigInt(item.estimate.tokens); lineage.tokenizers.add(`${item.estimate.tokenizer}:${item.estimate.version}`); } else lineage.complete = false; lineages.set(key, lineage);
  }
  return { revision: store.revision(), privacyVersion: epoch, providerInput, passiveOccurrences: count,
    passive: [...categories].map(([origin, group]) => ({ origin, occurrences: group.count, bytes: group.byteRows ? group.bytes.toString() : null, unknownEstimates: group.count - group.tokenRows, estimate: metric(group.tokenRows ? group.tokens.toString() : null, group.tokenRows ? 'estimated' : 'unknown', 'tokenizer', [], ['Emitted source occurrences only, counted once per primary origin; not reconstructed model input.']) })),
    items: page.map(row => row.item), nextCursor: selected.length > limit ? Buffer.from(JSON.stringify({ hash, privacy: epoch, analysis, after: page.at(-1)!.sequence, watermark, cutoff })).toString('base64url') : null,
    requests, lineage: [...lineages.values()].filter(lineage => lineage.entries.size > 1).map(lineage => ({ clientId: lineage.clientId, contentId: lineage.contentId, requests: lineage.entries.size, occurrences: lineage.count, evidence: 'client_declared_lineage', estimate: metric(lineage.complete && lineage.tokenizers.size <= 1 ? lineage.tokens.toString() : null, 'estimated', 'tokenizer', [], ['Repeated client-declared inclusion across distinct matched responses on the current 20-request page; not avoidable usage or an exact cache allocation.']) })),
    notes: ['Provider/counter input, source payload occurrences and client request reconstructions are distinct measurements. Passive totals are never subtracted from provider input.', 'Original file/stdout length and later request inclusion remain unknown unless the owned client records them. Visible instruction/skill labels require a captured parsed path; installed/enabled status is not request inclusion.', 'Nontext parts are counted separately without character-to-token conversion. Hidden system/reasoning content, tool-schema overhead and per-file cache allocation are unavailable.', 'Occurrence paging is pinned to an ingestion watermark; privacy and reanalysis invalidate cursors. Request reconstructions and lineage cover the separately paged first 20 matching manifests.'] };
}
