import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { ADAPTER_VERSION, EMPTY_CONTEXT, normalizeCodex, object, str } from '../accounting/codex-observations';
import { parseLossless } from '../accounting/integers';
import type { SampleCapability, SourceSampleReport } from '../shared/inspector';

export const SAMPLE_MAX_BYTES = 4 * 1024 * 1024;
export const SAMPLE_MAX_RECORDS = 512;
const SAMPLE_MAX_RECORD_BYTES = 2 * 1024 * 1024;
const ids: SampleCapability[] = ['usage_snapshots','response_identity','input','output','cached_input','cache_write_input','reasoning_output','tool_pairing','parent_links','compaction','model_identity','source_timestamps','context_manifests'];
export async function inspectSourceSample(filename: string): Promise<SourceSampleReport> {
  const report: SourceSampleReport = { state: 'unavailable', inspectedAt: new Date().toISOString(), adapterVersion: ADAPTER_VERSION, inspectionHost: { os: process.platform, architecture: process.arch }, runtimeVersions: [], runtimeUnknown: true,
    fileBytes: null, sampledBytes: 0, records: 0, parsedRecords: 0, unsupportedRecords: 0, invalidRecords: 0, oversizedRecords: 0, pendingTailBytes: 0, limited: false, changedDuringRead: false,
    capabilities: ids.map(id => ({ id, presentRecords: 0, usableRecords: 0, state: id === 'context_manifests' ? 'unsupported' : 'not_observed' })), toolPairing: { calls: 0, results: 0, matched: 0 }, schemaFingerprints: [], schemaCount: 0, reasons: [] };
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (path.extname(filename).toLowerCase() !== '.jsonl') { report.reasons.push('JSONL_REQUIRED'); return report; }
    const before = await lstat(filename, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) { report.reasons.push('REGULAR_FILE_REQUIRED'); return report; }
    file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await file.stat({ bigint: true });
    if (!opened.isFile() || before.ino !== opened.ino || before.dev !== opened.dev) { report.reasons.push('SOURCE_CHANGED_BEFORE_READ'); return report; }
    report.fileBytes = opened.size.toString();
    const buffer = Buffer.alloc(SAMPLE_MAX_BYTES);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0); report.sampledBytes = bytesRead;
    const after = await file.stat({ bigint: true }); const current = await lstat(filename, { bigint: true }).catch(() => null);
    report.changedDuringRead = !current || current.isSymbolicLink() || current.ino !== opened.ino || current.dev !== opened.dev || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || current.size !== after.size || current.mtimeNs !== after.mtimeNs;
    report.limited = BigInt(bytesRead) < opened.size;
    const schemas = new Map<string, number>(); const versions = new Set<string>(); const calls = new Map<string, number>(); const results = new Map<string, number>();
    let context = { ...EMPTY_CONTEXT }; let recognized = 0; let usableResponses = 0; let offset = 0;
    const capability = (id: SampleCapability, present: boolean, usable = present) => { const item = report.capabilities.find(item => item.id === id)!; if (present) item.presentRecords++; if (usable) item.usableRecords++; };
    while (offset < bytesRead && report.records < SAMPLE_MAX_RECORDS) {
      const end = buffer.indexOf(10, offset); if (end < 0 || end >= bytesRead) break;
      const bytes = buffer.subarray(offset, end); offset = end + 1; report.records++;
      if (bytes.length > SAMPLE_MAX_RECORD_BYTES) { report.oversizedRecords++; continue; }
      if (!bytes.length || bytes.length === 1 && bytes[0] === 13) continue;
      try {
        const record = parseLossless(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); const outer = object(record); const payload = object(outer?.payload);
        const n = normalizeCodex(record, context, { workspaceId: 'local-sample', machineId: 'inspection-host', sourceId: 'local-sample', evidenceRef: 'local-sample' }); context = n.context;
        report.parsedRecords++; if (n.supported) recognized++; else report.unsupportedRecords++;
        for (const reason of ['UNSUPPORTED_USAGE_FIELDS','UNSUPPORTED_TOOL_OUTPUT_PARTS','UNSUPPORTED_TOOL_OUTPUT_FORMAT']) if (n.issues.includes(reason) && !report.reasons.includes(reason)) report.reasons.push(reason);
        if (n.issues.length || n.measurements.some(item => item.issues.length)) report.invalidRecords++;
        schemas.set(n.schemaFingerprint, (schemas.get(n.schemaFingerprint) ?? 0) + 1);
        if (outer?.type === 'session_meta') { const version = str(payload?.cli_version); if (version && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) versions.add(version); }
        const m = n.measurements; const valid = m.filter(item => !item.issues.length);
        capability('usage_snapshots', m.length > 0, valid.length > 0);
        capability('response_identity', m.some(item => item.kind === 'response' && item.responseKey !== null), valid.some(item => item.kind === 'response' && item.responseKey !== null));
        for (const [id, field, native] of [['input','input','input_tokens'],['output','output','output_tokens'],['cached_input','cachedInput','cached_input_tokens'],['cache_write_input','cacheWriteInput','cache_write_input_tokens'],['reasoning_output','reasoningOutput','reasoning_output_tokens']] as const) capability(id, m.some(item => item.presence.includes(native)), valid.some(item => item.values[field] !== null));
        capability('model_identity', m.some(item => item.model.observedModel || item.model.requestedModel) || ['session_meta','turn_context'].includes(String(outer?.type)) && context.requestedModel !== null);
        capability('source_timestamps', n.sourceTimestamp !== null);
        capability('parent_links', outer?.type === 'session_meta' && context.parentThreadId !== null);
        capability('compaction', n.metadata.compaction !== undefined);
        if (valid.some(item => item.kind === 'response' && item.values.input !== null && item.values.output !== null)) usableResponses++;
        if (outer?.type === 'response_item' && n.metadata.callId && context.threadId) {
          const key = JSON.stringify([context.threadId, n.metadata.callId]);
          if (['function_call','custom_tool_call'].includes(String(payload?.type))) { calls.set(key, (calls.get(key) ?? 0) + 1); report.toolPairing.calls++; }
          if (['function_call_output','custom_tool_call_output'].includes(String(payload?.type))) { results.set(key, (results.get(key) ?? 0) + 1); report.toolPairing.results++; }
        }
      } catch { report.invalidRecords++; }
    }
    const unexamined = bytesRead - offset;
    if (report.records === SAMPLE_MAX_RECORDS && unexamined > 0) report.limited = true; else report.pendingTailBytes = unexamined;
    report.toolPairing.matched = [...calls].filter(([key, count]) => count === 1 && results.get(key) === 1).length;
    const pairing = report.capabilities.find(item => item.id === 'tool_pairing')!; pairing.presentRecords = report.toolPairing.calls + report.toolPairing.results; pairing.usableRecords = report.toolPairing.matched;
    for (const item of report.capabilities) if (item.id !== 'context_manifests') item.state = item.usableRecords > 0 ? 'observed' : item.presentRecords > 0 ? 'invalid' : 'not_observed';
    if (pairing.presentRecords && !pairing.usableRecords) pairing.state = 'partial';
    report.runtimeVersions = [...versions].sort(); report.runtimeUnknown = versions.size === 0;
    report.schemaCount = schemas.size; report.schemaFingerprints = [...schemas].sort(([a],[b]) => a.localeCompare(b)).slice(0, 32).map(([fingerprint, records]) => ({ fingerprint, records }));
    if (!report.records) report.reasons.push('NO_COMPLETE_RECORD_IN_SAMPLE');
    if (!report.capabilities.find(item => item.id === 'usage_snapshots')!.usableRecords) report.reasons.push('USAGE_NOT_OBSERVED_IN_SAMPLE');
    if (report.runtimeUnknown) report.reasons.push('RUNTIME_VERSION_UNKNOWN');
    if (report.limited) report.reasons.push('PREFIX_OR_RECORD_LIMIT');
    if (report.pendingTailBytes) report.reasons.push('UNCOMPLETED_OR_PREFIX_CUT_RECORD');
    if (report.changedDuringRead) report.reasons.push('SOURCE_CHANGED_DURING_READ');
    if (report.invalidRecords || report.oversizedRecords || report.unsupportedRecords) report.reasons.push('UNSUPPORTED_OR_INVALID_RECORDS');
    report.state = !recognized ? 'unsupported' : usableResponses > 0 && !report.limited && !report.pendingTailBytes && !report.changedDuringRead && !report.invalidRecords && !report.oversizedRecords && !report.unsupportedRecords ? 'ready' : 'partial';
    return report;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code; report.state = code === 'EACCES' || code === 'EPERM' ? 'permission_denied' : 'unavailable'; report.reasons = [report.state === 'permission_denied' ? 'READ_PERMISSION_DENIED' : 'SOURCE_UNAVAILABLE']; return report;
  } finally { await file?.close(); }
}
