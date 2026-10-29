import type { AutomaticUsdModel } from './inspector';

// Current API-equivalent scenario, verified from each official model page on this date.
const asOf = '2026-10-13T00:00:00.000Z';
const standard = { standard: '1', default: '1' };
const gpt6 = { ...standard, fast: '2', priority: '2', flex: '0.5', batch: '0.5' };
const definitions: [string, string, string, string, string, Record<string, string>][] = [
  ['gpt-6.1-sol', '2', '0.1', '2.5', '10', { ...gpt6, ultrafast: '6' }],
  ['gpt-6-astra', '10', '1', '12.5', '50', { ...gpt6, ultrafast: '6' }],
  ['gpt-6-sol', '2', '0.2', '2.5', '10', gpt6],
  ['gpt-6-luna', '0.1', '0.01', '0.125', '0.5', gpt6],
  ['gpt-5.6-sol', '4', '0.4', '5', '20', standard],
  ['gpt-5.6-terra', '2', '0.2', '2.5', '12', standard],
  ['gpt-5.6-luna', '0.2', '0.02', '0.25', '1.2', standard],
];
const catalog: AutomaticUsdModel[] = definitions.map(([model, inputRate, cachedInputRate, cacheWriteRate, outputRate, serviceMultipliers]) => ({ model, inputRate, cachedInputRate, cacheWriteRate, outputRate, serviceMultipliers, sourceUrl: `https://developers.openai.com/api/docs/models/${model}` }));
export const AUTOMATIC_USD_DEFINITION = { mode: 'automatic' as const, currency: 'USD' as const, provenance: 'official_snapshot' as const, uniformRate: null, inputRate: null, cachedInputRate: null, outputRate: null, createdAt: asOf, catalog };
