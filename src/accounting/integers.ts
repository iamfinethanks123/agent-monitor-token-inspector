import { TOKEN_FIELDS, type Metric, type TokenValues, type UsageComponents, type MeasurementOrigin, type Provenance } from '../shared/inspector';

export const MAX_INTEGER = 9_223_372_036_854_775_807n;
export const EMPTY_VALUES: TokenValues = { input: null, cachedInput: null, cacheWriteInput: null, output: null, reasoningOutput: null, total: null };

export function integer(value: unknown): string {
  const text = typeof value === 'bigint' ? value.toString()
    : typeof value === 'number' && Number.isSafeInteger(value) ? String(value)
    : typeof value === 'string' ? value : '';
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error('INVALID_INTEGER');
  if (BigInt(text) > MAX_INTEGER) throw new Error('INTEGER_OVERFLOW');
  return text;
}

/** Preserve the JSON number lexeme before an unsafe number can reach accounting. */
export function parseLossless(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source: string }) => {
    if (typeof value !== 'number') return value;
    if (context) return context.source;
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error('UNSUPPORTED_NUMERIC_LEXEME');
    return value;
  });
}

export function metric(value: string | null, provenance: Provenance, origin: MeasurementOrigin, refs: string[] = [], assumptions: string[] = []): Metric {
  return { value, provenance: value === null && provenance !== 'conflicted' ? 'unknown' : provenance, origin, sourceRefs: refs, assumptions,
    ...(value === null ? { missingReason: 'Not reported by the source or not comparable in this scope.' } : {}) };
}

export function components(values: TokenValues, provenance: Provenance, origin: MeasurementOrigin, refs: string[], assumptions: string[] = []): UsageComponents {
  return Object.fromEntries(TOKEN_FIELDS.map(field => [field, metric(values[field], provenance, origin, refs, [...assumptions])])) as UsageComponents;
}

export function validateValues(values: TokenValues, nativeTotal: string | null): string[] {
  const issues: string[] = [];
  if (values.input !== null && values.cachedInput !== null && BigInt(values.cachedInput) > BigInt(values.input)) issues.push('CACHED_INPUT_EXCEEDS_INPUT');
  if (values.input !== null && values.cacheWriteInput !== null && BigInt(values.cacheWriteInput) > BigInt(values.input)) issues.push('CACHE_WRITE_EXCEEDS_INPUT');
  if (values.output !== null && values.reasoningOutput !== null && BigInt(values.reasoningOutput) > BigInt(values.output)) issues.push('REASONING_EXCEEDS_OUTPUT');
  if (values.input !== null && values.output !== null) {
    const total = BigInt(values.input) + BigInt(values.output);
    if (total > MAX_INTEGER) issues.push('INTEGER_OVERFLOW');
    if (nativeTotal !== null && total !== BigInt(nativeTotal)) issues.push('NATIVE_TOTAL_MISMATCH');
  }
  return issues;
}

export function subtract(after: TokenValues, before: TokenValues): { values: TokenValues; falling: boolean } {
  const values = { ...EMPTY_VALUES };
  let falling = false;
  for (const field of TOKEN_FIELDS) {
    if (after[field] === null || before[field] === null) continue;
    const delta = BigInt(after[field]!) - BigInt(before[field]!);
    if (delta < 0n) falling = true;
    else values[field] = delta.toString();
  }
  return { values, falling };
}

export function totalFromParts(values: TokenValues): TokenValues {
  const result = { ...values };
  if (result.input !== null && result.output !== null) result.total = integer(BigInt(result.input) + BigInt(result.output));
  else result.total = null;
  return result;
}
