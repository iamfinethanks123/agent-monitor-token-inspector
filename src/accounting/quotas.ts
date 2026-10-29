import type { QuotaMeasurement, QuotaWindow } from '../shared/inspector';

function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function unsigned(value: unknown): string | null { const text = String(value); return /^(0|[1-9][0-9]*)$/.test(text) && BigInt(text) <= 9_223_372_036_854_775_807n ? text : null; }
function window(value: unknown): QuotaWindow | null {
  const input = record(value); if (!input) return null;
  const percent = String(input.used_percent);
  const usedPercent = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,12})?$/.test(percent) && Number(percent) <= 1000000 ? percent : null;
  const minutes = unsigned(input.window_minutes); const reset = unsigned(input.resets_at);
  let resetsAt: string | null = null;
  if (reset && BigInt(reset) <= 8640000000000n) resetsAt = new Date(Number(reset) * 1000).toISOString();
  return { usedPercent, windowMinutes: minutes === '0' ? null : minutes, resetsAt,
    issues: [...(usedPercent === null ? ['USED_PERCENT_UNKNOWN'] : []), ...(minutes === null || minutes === '0' ? ['WINDOW_DURATION_UNKNOWN'] : []), ...(resetsAt === null ? ['RESET_TIME_UNKNOWN'] : [])] };
}

/** Only observed snake_case passive fields are supported. Credits and identity are excluded. */
export function normalizeQuota(value: unknown): QuotaMeasurement | null {
  const input = record(value); if (!input || !Object.hasOwn(input, 'primary') && !Object.hasOwn(input, 'secondary')) return null;
  const id = typeof input.limit_id === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(input.limit_id) ? input.limit_id : null;
  return { limitId: id, primary: window(input.primary), secondary: window(input.secondary) };
}
