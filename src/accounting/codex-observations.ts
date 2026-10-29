import { createHash, createHmac } from 'node:crypto';
import type { ExecutionIdentity, ModelAttribution, TokenValues } from '../shared/inspector';
import { EMPTY_VALUES, integer, totalFromParts, validateValues } from './integers';
import { normalizeQuota } from './quotas';
import { literalCommand, stableFailure, processHandle } from './tool-metadata';
import type { QuotaMeasurement } from '../shared/inspector';

export const ADAPTER_VERSION = 'codex-passive/1';
export const POLICY_VERSION = 'canonical-ledger/2';
type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}
export function str(value: unknown): string | null { return typeof value === 'string' && value.length > 0 && value.length <= 1024 ? value : null; }
export function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function toolIdentity(workspaceId: string, sourceId: string, generation: number, threadId: string | null, callId: string): string {
  return `tool:codex:2:${digest(JSON.stringify([workspaceId, sourceId, generation, threadId, callId]))}`;
}
export function fingerprint(value: string, key?: string): string | null { return key ? createHmac('sha256', key).update(value).digest('hex') : null; }
export function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
export interface SourceContext {
  codex: boolean;
  threadId: string | null;
  sessionId: string | null;
  parentThreadId: string | null;
  forkedFromId: string | null;
  runtimeVersion: string | null;
  requestedModel: string | null;
  providerRoute: string | null;
  serviceTier: string | null;
  projectId: string | null;
  turnId: string | null;
  contextEpoch: string;
  verificationIntent: boolean;
  declaredPurpose: string | null;
}
export const EMPTY_CONTEXT: SourceContext = { codex: false, threadId: null, sessionId: null, parentThreadId: null, forkedFromId: null, runtimeVersion: null,
  requestedModel: null, providerRoute: null, serviceTier: null, projectId: null, turnId: null, contextEpoch: 'initial', verificationIntent: false, declaredPurpose: null };
export interface UsageMeasurement {
  kind: 'response' | 'thread_counter' | 'last_unidentified' | 'turn_counter';
  identity: ExecutionIdentity;
  model: ModelAttribution;
  values: TokenValues;
  nativeTotal: string | null;
  presence: string[];
  issues: string[];
  scopeId: string;
  responseKey: string | null;
}
export interface NormalizedObservation {
  kind: string;
  sourceTimestamp: string | null;
  semanticSequence: string | null;
  schemaFingerprint: string;
  supported: boolean;
  issues: string[];
  context: SourceContext;
  measurements: UsageMeasurement[];
  metadata: { callId?: string; toolName?: string; role?: string; status?: string; outputBytes?: string;
    argumentBytes?: string; argumentTokenEstimate?: string; argumentTokenizer?: string;
    outputFingerprint?: string | null; argumentsFingerprint?: string | null; targetFingerprint?: string | null;
    failureFingerprint?: string | null; commandFingerprint?: string | null;
    payloadTokenEstimate?: string; tokenizer?: string; captureComplete?: boolean; exitCode?: string;
    operation?: 'read' | 'execute' | 'edit' | 'poll' | 'other'; origin?: string; quota?: QuotaMeasurement;
    definition?: { kind: 'agent_instructions' | 'skill_definition'; provenance: 'parsed_path' };
    nonTextParts?: { image: number; audio: number; other: number };
    processRef?: string | null; processState?: 'running';
    compaction?: { adapter: 'codex-compaction/1'; itemId: string | null; phase: 'started' | 'completed' | 'marker'; form: string } };
}
const FIELD_MAP = { input: 'input_tokens', cachedInput: 'cached_input_tokens', cacheWriteInput: 'cache_write_input_tokens', output: 'output_tokens', reasoningOutput: 'reasoning_output_tokens', total: 'total_tokens' } as const;

function usage(value: unknown): { values: TokenValues; nativeTotal: string | null; presence: string[]; issues: string[] } | null {
  const source = object(value);
  if (!source) return null;
  const values = { ...EMPTY_VALUES };
  const presence: string[] = [];
  const issues: string[] = [];
  for (const [field, native] of Object.entries(FIELD_MAP)) {
    if (!Object.hasOwn(source, native)) continue;
    presence.push(native);
    try { values[field as keyof TokenValues] = integer(source[native]); }
    catch (error) { issues.push(`${native}:${(error as Error).message}`); }
  }
  if (presence.length === 0) return null;
  const nativeTotal = values.total;
  issues.push(...validateValues(values, nativeTotal));
  try { return { values: totalFromParts(values), nativeTotal, presence, issues }; }
  catch (error) { issues.push((error as Error).message); return { values: { ...values, total: null }, nativeTotal, presence, issues }; }
}

export function normalizeCodex(value: unknown, previous: SourceContext, options: { workspaceId: string; machineId: string; sourceId: string; evidenceRef: string; fingerprintKey?: string }): NormalizedObservation {
  const record = object(value) ?? {};
  const payload = object(record.payload) ?? {};
  const outer = str(record.type) ?? 'unknown';
  const inner = str(payload.type);
  const kind = inner ? `${outer}/${inner}` : outer;
  const context = { ...previous };
  const issues: string[] = [];
  const toolOutputShapes: unknown[] = [];
  if (outer === 'session_meta' && (str(payload.id) || str(payload.thread_id))) {
    context.codex = true;
    context.threadId = str(payload.id) ?? str(payload.thread_id);
    context.sessionId = str(payload.session_id);
    context.parentThreadId = str(payload.parent_thread_id);
    context.forkedFromId = str(payload.forked_from_id);
    context.runtimeVersion = str(payload.cli_version);
    context.providerRoute = str(payload.model_provider);
    context.requestedModel = str(payload.model);
    context.declaredPurpose = str(payload.agent_role);
    // A local grouping ID does not disclose a repository path to a receiver.
    const project = str(payload.cwd) ? fingerprint(String(payload.cwd), options.fingerprintKey) : null;
    context.projectId = project ? `project:${project.slice(0, 24)}` : null;
  } else if (outer === 'turn_context' && context.codex) {
    context.requestedModel = str(payload.model) ?? context.requestedModel;
    context.turnId = str(payload.turn_id);
    context.providerRoute = str(payload.model_provider) ?? context.providerRoute;
    context.serviceTier = str(payload.service_tier);
  }
  if (outer === 'response_item' && payload.role === 'user') {
    const text = Array.isArray(payload.content) ? payload.content.map(item => object(item)?.text ?? '').join('\n') : '';
    context.verificationIntent = /\b(?:verify|verification|independent review|recheck)\b|驗證|覆核|重新檢查/i.test(text);
  }
  const identity: ExecutionIdentity = {
    workspaceId: options.workspaceId, originMachineId: options.machineId, projectId: context.projectId,
    runId: str(payload.thread_id) ?? context.threadId ?? options.sourceId,
    agentId: str(payload.thread_id) ?? context.threadId,
    provider: context.providerRoute,
    threadId: str(payload.thread_id) ?? context.threadId,
    sessionId: str(payload.session_id) ?? context.sessionId,
    turnId: str(payload.turn_id) ?? context.turnId,
    rootTurnId: str(payload.root_turn_id), responseId: null,
  };
  const model: ModelAttribution = {
    requestedModel: context.requestedModel, observedModel: str(payload.model), providerRoute: context.providerRoute,
    serviceTier: str(payload.service_tier) ?? context.serviceTier, quotaAlias: null,
    provenance: str(payload.model) ? 'observed' : context.requestedModel ? 'derived' : 'unknown', evidenceRefs: [options.evidenceRef],
  };
  const scopeId = `scope:${digest(JSON.stringify([options.workspaceId, options.machineId, identity.provider, identity.threadId ?? options.sourceId]))}`;
  const measurements: UsageMeasurement[] = [];
  const unsupportedUsageShapes: [UsageMeasurement['kind'], string[]][] = [];
  const add = (measurementKind: UsageMeasurement['kind'], source: unknown, responseId: string | null = null) => {
    const parsed = usage(source);
    if (!parsed) {
      const fields = object(source);
      if (source !== undefined && source !== null && (!fields || Object.keys(fields).length > 0)) {
        if (!issues.includes('UNSUPPORTED_USAGE_FIELDS')) issues.push('UNSUPPORTED_USAGE_FIELDS');
        unsupportedUsageShapes.push([measurementKind, fields ? Object.keys(fields).sort() : ['invalid_container']]);
      }
      return;
    }
    const execution = { ...identity, responseId };
    measurements.push({ kind: measurementKind, identity: execution, model, ...parsed, scopeId,
      responseKey: responseId ? digest(JSON.stringify([options.workspaceId, options.machineId, execution.provider, execution.threadId, responseId])) : null });
  };
  if (outer === 'token_usage_record' && str(payload.thread_id) && str(payload.response_id)) {
    add('response', payload.usage, str(payload.response_id));
    add('thread_counter', payload.thread_token_usage);
    add('turn_counter', payload.turn_token_usage);
  } else if (context.codex && outer === 'event_msg' && inner === 'token_count') {
    const info = object(payload.info);
    if (info) { add('thread_counter', info.total_token_usage); add('last_unidentified', info.last_token_usage); }
  }
  let semanticSequence: string | null = null;
  if (record.ordinal !== undefined) {
    try { semanticSequence = integer(record.ordinal); } catch (error) { issues.push(`ordinal:${(error as Error).message}`); }
  }
  const metadata: NormalizedObservation['metadata'] = {};
  if (context.codex && (!str(payload.thread_id) || payload.thread_id === context.threadId)) {
    const item = object(payload.item);
    if (outer === 'event_msg' && (inner === 'item_started' || inner === 'item_completed') && item?.type === 'ContextCompaction' && str(item.id)) {
      metadata.compaction = { adapter: 'codex-compaction/1', itemId: str(item.id), phase: inner === 'item_started' ? 'started' : 'completed', form: kind };
    } else if (outer === 'compacted' || outer === 'event_msg' && inner === 'context_compacted') {
      metadata.compaction = { adapter: 'codex-compaction/1', itemId: null, phase: 'marker', form: kind };
    }
    if (metadata.compaction && metadata.compaction.phase !== 'started') context.contextEpoch = metadata.compaction.itemId
      ? `compaction:${digest(JSON.stringify([options.machineId, context.threadId, metadata.compaction.itemId]))}` : options.evidenceRef;
  }
  if (context.codex && outer === 'event_msg' && inner === 'token_count') {
    const quota = normalizeQuota(payload.rate_limits); if (quota) metadata.quota = quota;
  }
  if (outer === 'response_item') {
    const callId = str(payload.call_id); if (callId) metadata.callId = callId;
    const name = str(payload.name); if (name) metadata.toolName = name;
    const role = str(payload.role); if (role) metadata.role = role;
    const status = str(payload.status); if (status) metadata.status = status;
    const argumentText = typeof payload.arguments === 'string' ? payload.arguments : typeof payload.input === 'string' ? payload.input : '';
    if ((inner === 'function_call' || inner === 'custom_tool_call') && (typeof payload.arguments === 'string' || typeof payload.input === 'string')) {
      const bytes = Buffer.byteLength(argumentText, 'utf8');
      metadata.argumentBytes = String(bytes); metadata.argumentTokenEstimate = String(Math.ceil(bytes / 4)); metadata.argumentTokenizer = 'approx-utf8-bytes-div4/1';
    }
    if (argumentText) {
      metadata.argumentsFingerprint = fingerprint(argumentText.trim(), options.fingerprintKey);
      const decoded = literalCommand(argumentText);
      const handle = /write_stdin/i.test(name ?? '') || decoded === null ? processHandle(argumentText, 'input') : null; if (handle) metadata.processRef = fingerprint(JSON.stringify([context.threadId, handle]), options.fingerprintKey);
      const command = decoded ?? (/^(?:cat|sed|head|tail|rg)\s/.test(argumentText.trim()) ? argumentText : '');
      metadata.commandFingerprint = decoded ? fingerprint(decoded.trim(), options.fingerprintKey) : null;
      metadata.operation = /(?:write_stdin|sleep|wait|poll)/i.test(name ?? '') ? 'poll' : /(?:apply_patch|write_file|edit_file)/i.test(name ?? '') ? 'edit'
        : /^(?:cat|sed|head|tail|rg)\s/.test(command.trim()) || /read_file/i.test(name ?? '') ? 'read' : /(?:exec|shell|terminal)/i.test(name ?? '') ? 'execute' : 'other';
      if (decoded === null && /tools\.(?:write_stdin|clock__sleep)\s*\(/.test(argumentText)) metadata.operation = 'poll';
      const target = /^(?:cat|head|tail)\s+(?:-[^ ]+\s+)*([^\n;&|]+)/.exec(command.trim())?.[1]
        ?? /^sed\s+-n\s+['"]?[^'" ]+['"]?\s+([^\n;&|]+)/.exec(command.trim())?.[1];
      metadata.targetFingerprint = target ? fingerprint(target.trim(), options.fingerprintKey) : null;
      metadata.origin = metadata.operation === 'read' && target ? 'project_file' : /(?:web__run|web\.run|web_search|browser_search)/i.test(name ?? '') ? 'external_document'
        : decoded !== null || /(?:exec|shell|terminal|write_stdin)/i.test(name ?? '') ? 'command_output' : 'unknown';
      const definition = target?.trim().replace(/^['"]|['"]$/g, '').split(/[\\/]/).at(-1);
      if (definition === 'AGENTS.md') metadata.definition = { kind: 'agent_instructions', provenance: 'parsed_path' };
      if (definition === 'SKILL.md') metadata.definition = { kind: 'skill_definition', provenance: 'parsed_path' };
    }
    const structuredOutput = /(?:output|result|error)$/.test(inner ?? '') && Array.isArray(payload.output);
    const texts: string[] = []; const nonText = { image: 0, audio: 0, other: 0 }; let unsupportedParts = 0;
    if (structuredOutput) {
      for (const raw of payload.output as unknown[]) {
        const part = object(raw); const type = typeof part?.type === 'string' ? part.type : '';
        let known = true;
        if (['input_text', 'output_text', 'text'].includes(type) && typeof part?.text === 'string') texts.push(part.text);
        else if (['input_image', 'output_image', 'image', 'image_url'].includes(type)) nonText.image++;
        else if (['input_audio', 'output_audio', 'audio'].includes(type)) nonText.audio++;
        else { unsupportedParts++; nonText.other++; known = false; }
        toolOutputShapes.push([known ? type : 'unknown', part ? Object.keys(part).sort() : typeof raw]);
      }
      if (nonText.image || nonText.audio || nonText.other) metadata.nonTextParts = nonText;
      if (unsupportedParts) issues.push('UNSUPPORTED_TOOL_OUTPUT_PARTS');
      const hash = unsupportedParts ? null : fingerprint(JSON.stringify(payload.output), options.fingerprintKey);
      // Preserve legacy string identities; structured identities retain boundaries/media.
      metadata.outputFingerprint = hash === null ? null : `parts/1:${hash}`;
      if (payload.truncated === true) metadata.captureComplete = false; else if (!unsupportedParts) metadata.captureComplete = true;
    } else if (/(?:output|result|error)$/.test(inner ?? '') && payload.output !== undefined && payload.output !== null && typeof payload.output !== 'string') issues.push('UNSUPPORTED_TOOL_OUTPUT_FORMAT');
    const outputText = typeof payload.output === 'string' ? payload.output : structuredOutput && (texts.length || (payload.output as unknown[]).length === 0) ? texts.join('\n') : null;
    if (outputText !== null) {
      const bytes = structuredOutput ? texts.reduce((sum, text) => sum + Buffer.byteLength(text), 0) : Buffer.byteLength(outputText);
      metadata.outputBytes = String(bytes); if (!structuredOutput) metadata.outputFingerprint = fingerprint(outputText, options.fingerprintKey);
      metadata.payloadTokenEstimate = String(Math.ceil(bytes / 4)); metadata.tokenizer = 'approx-utf8-bytes-div4/1';
      if (payload.truncated === true || /\b(?:output truncated|truncated output)\b/i.test(outputText)) metadata.captureComplete = false;
      else if (!unsupportedParts) metadata.captureComplete = true;
      const handles = structuredOutput ? new Set(texts.map(text => processHandle(text, 'output')).filter((handle): handle is string => handle !== null)) : null;
      const handle = unsupportedParts ? null : handles ? handles.size === 1 ? [...handles][0] : null : processHandle(outputText, 'output'); if (handle) { metadata.processRef = fingerprint(JSON.stringify([context.threadId, handle]), options.fingerprintKey); metadata.processState = 'running'; }
      const exits = [...outputText.matchAll(/(?:Process exited with code|exit(?:_code| code)?[:=])\s*(-?\d+)/gi)].map(match => match[1]);
      const exit = unsupportedParts || structuredOutput && new Set(exits).size > 1 ? undefined : exits[0];
      if (exit) metadata.exitCode = exit;
      try { const wrapped = unsupportedParts ? undefined : object(JSON.parse(outputText)); if (typeof wrapped?.exit_code === 'number' && Number.isSafeInteger(wrapped.exit_code)) metadata.exitCode = String(wrapped.exit_code); } catch { /* Only a complete known JSON wrapper is decoded. */ }
      if (exit && exit !== '0' || payload.status === 'error') metadata.failureFingerprint = fingerprint(stableFailure(outputText), options.fingerprintKey);
    }
    if (payload.exit_code !== undefined && /^-?\d+$/.test(String(payload.exit_code))) metadata.exitCode = String(payload.exit_code);
    if (metadata.exitCode && metadata.exitCode !== '0' && outputText !== null) metadata.failureFingerprint = fingerprint(stableFailure(outputText), options.fingerprintKey);
    if (inner === 'message' && ['user', 'assistant', 'developer', 'system'].includes(String(payload.role)) && Array.isArray(payload.content)) {
      const nonText = { image: 0, audio: 0, other: 0 };
      for (const part of payload.content.map(item => object(item))) {
        if (!part || ['input_text', 'output_text', 'text'].includes(String(part.type))) continue;
        if (['input_image', 'output_image', 'image', 'image_url'].includes(String(part.type))) nonText.image++;
        else if (['input_audio', 'output_audio', 'audio'].includes(String(part.type))) nonText.audio++;
        else nonText.other++;
      }
      if (nonText.image || nonText.audio || nonText.other) metadata.nonTextParts = nonText;
      const texts = payload.content.map(item => object(item)).filter(item => item && ['input_text', 'output_text', 'text'].includes(String(item.type)) && typeof item.text === 'string');
      if (texts.length) {
        const bytes = texts.reduce((sum, item) => sum + Buffer.byteLength(String(item!.text)), 0);
        metadata.outputBytes = String(bytes); metadata.payloadTokenEstimate = String(Math.ceil(bytes / 4)); metadata.tokenizer = 'approx-utf8-bytes-div4/1';
        metadata.captureComplete = payload.truncated !== true; metadata.origin = payload.role === 'user' ? 'user_prompt' : payload.role === 'assistant' ? 'assistant_text' : 'visible_instructions';
      }
    }
  }
  const known = new Set(['session_meta', 'turn_context', 'token_usage_record', 'response_item', 'event_msg', 'compacted', 'inter_agent_communication_metadata']);
  const schemaFingerprint = digest(JSON.stringify([outer, inner, Object.keys(payload).sort(), ...measurements.map(m => m.presence), ...unsupportedUsageShapes, ...(toolOutputShapes.length ? [toolOutputShapes] : [])]));
  const outputSupported = !issues.includes('UNSUPPORTED_TOOL_OUTPUT_FORMAT') && (!issues.includes('UNSUPPORTED_TOOL_OUTPUT_PARTS') || metadata.outputBytes !== undefined || !!metadata.nonTextParts?.image || !!metadata.nonTextParts?.audio);
  return { kind, sourceTimestamp: timestamp(record.timestamp), semanticSequence, schemaFingerprint,
    supported: (context.codex && known.has(outer) && unsupportedUsageShapes.length === 0 && outputSupported) || measurements.length > 0, context, measurements, metadata, issues };
}
