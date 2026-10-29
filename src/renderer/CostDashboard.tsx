import type { AnalyticsBucket, TimeChartGroup } from '../shared/inspector';
import { usdTextUnits, usdRangeText } from './UsdConversionPanel';

export const amountUnits = (amount: string | null | undefined) => amount == null ? null : BigInt(amount.replace('.', '')).toString();
const compactUsd = (units: string, up = false) => {
  const value = BigInt(units); if (value > 0n && value < 10000000000n) return usdTextUnits(units);
  const cents = (value + (up ? 9999999999n : 0n)) / 10000000000n;
  return `$${(cents / 100n).toLocaleString('en-US')}.${(cents % 100n).toString().padStart(2, '0')}`;
};
export function displayUsd(lower: string | null, upper: string | null): string {
  if (lower === null) return '—'; if (upper === null || lower === upper) return compactUsd(lower);
  return `${compactUsd(lower)} – ${compactUsd(upper, true)}`;
}

export function CostRanking({ items, label, onSelect, onUnknown, language }: { items: TimeChartGroup[]; label: (id: string) => string; onSelect?: (id: string) => void; onUnknown?: (row: TimeChartGroup) => void; language: 'zh' | 'en' }) {
  const rows = [...items].sort((a, b) => BigInt(b.usdUnits ?? '0') > BigInt(a.usdUnits ?? '0') ? 1 : BigInt(b.usdUnits ?? '0') < BigInt(a.usdUnits ?? '0') ? -1 : a.id.localeCompare(b.id));
  const max = rows.reduce((max, row) => BigInt(row.usdUnits ?? '0') > max ? BigInt(row.usdUnits!) : max, 1n);
  return <div className="inspector-ranking">{rows.slice(0, 7).map(row => <button key={row.id} disabled={row.id === '(unknown)' ? !onUnknown : !onSelect} onClick={() => row.id === '(unknown)' ? onUnknown?.(row) : onSelect?.(row.id)} title={`${row.id}: ${usdRangeText(row.usdUnits, row.usdUpperUnits)}; ${row.usdUnpriced} unpriced entries`}><div><span>{label(row.id)}</span><strong>{displayUsd(row.usdUnits, row.usdUpperUnits)}{row.usdUnpriced ? ' *' : ''}</strong></div><div className="ranking-track"><i style={{ width: `${Number(BigInt(row.usdUnits ?? '0') * 10000n / max) / 100}%` }} /></div></button>)}{!rows.length && <p className="inspector-empty">—</p>}<p className="inspector-footnote">{language === 'zh' ? '按估算下限排序；* 有未定價記錄，未知唔係 $0。' : 'Ordered by lower estimate; * includes unpriced entries. Unknown is not $0.'}</p></div>;
}

export function DailyCostChart({ buckets, costs, language }: { buckets: AnalyticsBucket[]; costs: TimeChartGroup[]; language: 'zh' | 'en' }) {
  const rows = buckets.slice(-60); const prices = new Map(costs.map(item => [item.id, item]));
  const maxToken = rows.reduce((max, row) => BigInt(row.total ?? '0') > max ? BigInt(row.total!) : max, 1n);
  const maxCost = rows.reduce((max, row) => BigInt(prices.get(row.name)?.usdUpperUnits ?? '0') > max ? BigInt(prices.get(row.name)!.usdUpperUnits!) : max, 1n);
  const left = 55; const right = 645; const bottom = 170; const height = 145; const slot = (right - left) / Math.max(rows.length, 1);
  const x = (index: number) => left + slot * (index + .5);
  const tokenHeight = (value: string) => Number(BigInt(value) * 10000n / maxToken) / 10000 * height;
  const costY = (value: string) => bottom - Number(BigInt(value) * 10000n / maxCost) / 10000 * height;
  const path = (field: 'usdUnits' | 'usdUpperUnits') => { let active = false; return rows.map((row, index) => { const value = prices.get(row.name)?.[field]; if (value == null) { active = false; return ''; } const command = active ? 'L' : 'M'; active = true; return `${command}${x(index)},${costY(value)}`; }).join(' '); };
  return <figure className="inspector-chart"><svg viewBox="0 0 760 208" role="img" aria-label={language === 'zh' ? '每日美元成本同 Token 用量' : 'Daily USD costs and token usage'}>
    {[0, 1, 2, 3].map(index => { const fraction = BigInt(index); const tokens = maxToken * fraction / 3n; return <g key={index}><line className="chart-grid" x1={left} x2={right} y1={bottom - height * index / 3} y2={bottom - height * index / 3} /><text className="chart-label" x={left - 8} y={bottom - height * index / 3 + 4} textAnchor="end">{tokens >= 1000000n ? `${tokens / 1000000n}M` : tokens >= 1000n ? `${tokens / 1000n}K` : tokens.toString()}</text><text className="chart-label" x={right + 9} y={bottom - height * index / 3 + 4}>{compactUsd((maxCost * fraction / 3n).toString(), true)}</text></g>; })}
    {rows.map((row, index) => { const response = tokenHeight(row.responseTotal); const interval = tokenHeight(row.intervalTotal); const width = Math.max(1, Math.min(36, slot * .6)); const cost = prices.get(row.name); return <g key={row.name}><title>{`${row.name}: ${row.total ?? 'unknown'} tokens; ${usdRangeText(cost?.usdUnits ?? null, cost?.usdUpperUnits ?? null)}; ${cost?.usdUnpriced ?? 0} unpriced`}</title><rect className="chart-response" x={x(index) - width / 2} y={bottom - response} width={width} height={response} rx="2" /><rect className="chart-interval" x={x(index) - width / 2} y={bottom - response - interval} width={width} height={interval} rx="2" />{cost?.usdUnits != null && <circle cx={x(index)} cy={costY(cost.usdUnits)} r="3" fill="var(--warning)" />}{(index === 0 || index === rows.length - 1 || index % Math.max(1, Math.ceil(rows.length / 7)) === 0) && <text className="chart-label" x={x(index)} y="195" textAnchor="middle">{row.name.slice(5)}</text>}</g>; })}
    <path d={path('usdUpperUnits')} fill="none" stroke="var(--purple)" strokeWidth="2" strokeDasharray="4 3" /><path d={path('usdUnits')} fill="none" stroke="var(--warning)" strokeWidth="2.4" />
    {!rows.length && <text className="chart-label" x="350" y="90" textAnchor="middle">{language === 'zh' ? '未有時間用量' : 'No timed usage'}</text>}
  </svg><figcaption><span><i className="legend-response" />{language === 'zh' ? '回應 Token' : 'Response tokens'}</span><span><i className="legend-interval" />{language === 'zh' ? '區間 Token' : 'Interval tokens'}</span><span>{language === 'zh' ? '實線成本下限・虛線上限；右軸 USD' : 'Solid lower / dashed upper cost; right axis USD'}</span></figcaption></figure>;
}
