import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, Database, FileClock, Layers, LayoutDashboard, Monitor, Network, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { AnalyticsBucket, BudgetState, DiagnosticsView, EvidenceView, FindingView, InspectorAnalytics, InspectorQuery, InspectorStatus, InspectorSummary, LedgerEntry, LegacyOverview, Metric, ReceiverView, SourceHealth, ScopeOptions, ManualUsdView, ToolView } from '../shared/inspector';
import type { Agent, AgentRun } from '../shared/types';
import App from './App';
import { ThemeSelector } from './ThemeSelector';
import { ExperimentsPanel } from './ExperimentsPanel';
import { DevicesPanel } from './DevicesPanel';
import { PricesPanel } from './PricesPanel';
import { PrivacyPanel } from './PrivacyPanel';
import { ReparseStatus } from './ReparseStatus';
import { QuotasPanel } from './QuotasPanel';
import { ManifestsPanel } from './ManifestsPanel';
import { ReportPanel } from './ReportPanel';
import { BudgetsPanel, budgetAmount } from './BudgetsPanel';
import { IncidentsPanel } from './IncidentsPanel';
import { OverviewInsightsPanel } from './OverviewInsightsPanel';
import { TimeChartsPanel } from './TimeChartsPanel';
import { TimelinePanel } from './TimelinePanel';
import { ContentSearchPanel } from './ContentSearchPanel';
import { ScopeFilters } from './ScopeFilters';
import { CompactionsPanel } from './CompactionsPanel';
import { AgentComparisonPanel } from './AgentComparisonPanel';
import { ContextAttributionPanel } from './ContextAttributionPanel';
import { ToolActivityPanel } from './ToolActivityPanel';
import { RetryProgressPanel } from './RetryProgressPanel';
import { LedgerExplanationDialog } from './LedgerExplanationDialog';
import { SourceSamplePanel } from './SourceSamplePanel';
import { TotalExplanationDialog } from './TotalExplanationDialog';
import { CollectorHealthPanel } from './CollectorHealthPanel';
import { AdvicePlanPanel } from './AdvicePlanPanel';
import { DataQualityPanel } from './DataQualityPanel';
import { SourceAvailabilityPanel } from './SourceAvailabilityPanel';
import { ModelTransitionsPanel } from './ModelTransitionsPanel';
import { UsdConversionPanel } from './UsdConversionPanel';
import { RunTaskPanel } from './RunTaskPanel';
import { AccountUsagePanel } from './AccountUsagePanel';
import { AccountLimitsPanel } from './AccountLimitsPanel';
import { applyDeviceActivity } from '../shared/device-activity';
import { amountUnits, displayUsd, CostRanking, DailyCostChart } from './CostDashboard';
import './InspectorWorkspace.css';
import './InspectorTheme.css';
import './FindingsWorkspace.css';

type View = 'overview' | 'monitor' | 'ledger' | 'history' | 'context' | 'findings' | 'experiments' | 'machines' | 'quality' | 'settings';
type Language = 'zh' | 'en';
const NAV = [
  { id: 'overview', icon: LayoutDashboard, zh: '用量總覽', en: 'Overview' },
  { id: 'monitor', icon: Network, zh: '任務地圖', en: 'Task map' },
  { id: 'ledger', icon: Database, zh: '用量帳本', en: 'Usage ledger' },
  { id: 'history', icon: FileClock, zh: '執行歷史', en: 'History' },
  { id: 'context', icon: Layers, zh: 'Context 與工具', en: 'Context & tools' },
  { id: 'findings', icon: Sparkles, zh: '分析與建議', en: 'Findings' },
  { id: 'experiments', icon: Activity, zh: '任務結果與實驗', en: 'Outcomes & experiments' },
  { id: 'machines', icon: Monitor, zh: '設備與來源', en: 'Machines & sources' },
  { id: 'quality', icon: ShieldCheck, zh: '數據品質', en: 'Data quality' },
  { id: 'settings', icon: Settings2, zh: '設定與私隱', en: 'Settings & privacy' },
] as const;

export function formatInteger(value: string | null | undefined): string { return value == null ? '—' : BigInt(value).toLocaleString('en-US'); }
function compact(value: string | null): string {
  if (value === null) return '—'; const n = BigInt(value);
  for (const [scale, label] of [[1000000000n, 'B'], [1000000n, 'M'], [1000n, 'K']] as const) if (n >= scale) return `${n / scale}.${(n % scale) * 10n / scale}${label}`;
  return n.toString();
}
function ratio(value: string | null, base: string | null): number | null { return value !== null && base !== null && BigInt(base) > 0n ? Number(BigInt(value) * 10000n / BigInt(base)) / 100 : null; }
function time(value: string | null): string { return value ? new Date(value).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false }) : '—'; }
function short(value: string | null, size = 10): string { return value ? value.replace(/^(?:project|source):/, '').slice(0, size) : 'Unknown'; }

function DailyChart({ buckets, language }: { buckets: AnalyticsBucket[]; language: Language }) {
  const visible = buckets.slice(-60); const max = visible.reduce((m, row) => BigInt(row.total ?? '0') > m ? BigInt(row.total ?? '0') : m, 1n);
  const width = 760; const height = 200; const chartWidth = 696; const chartHeight = 144; const slot = chartWidth / Math.max(visible.length, 1);
  const scaled = (value: string) => Number(BigInt(value) * 10000n / max) / 10000 * chartHeight;
  return <figure className="inspector-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={language === 'zh' ? '每日已識別回應及區間用量' : 'Daily response and interval usage'}>
      {[0, 0.5, 1].map(fraction => <g key={fraction}><line x1="54" x2="750" y1={166 - chartHeight * fraction} y2={166 - chartHeight * fraction} className="chart-grid" /><text x="45" y={170 - chartHeight * fraction} textAnchor="end" className="chart-label">{compact((max * BigInt(Math.round(fraction * 100)) / 100n).toString())}</text></g>)}
      {visible.map((row, i) => { const response = scaled(row.responseTotal); const interval = scaled(row.intervalTotal); const x = 54 + slot * i + Math.min(4, slot / 5); const bar = Math.max(2, slot - Math.min(8, slot / 3)); return <g key={row.name}>
        <title>{`${row.name}: ${formatInteger(row.total)} tokens; response ${formatInteger(row.responseTotal)}; interval ${formatInteger(row.intervalTotal)}`}</title>
        <rect x={x} y={166 - response} width={bar} height={response} rx="2" className="chart-response" />
        <rect x={x} y={166 - response - interval} width={bar} height={interval} rx="2" className="chart-interval" />
        {(i === 0 || i === visible.length - 1 || i % Math.max(1, Math.ceil(visible.length / 7)) === 0) && <text x={x + bar / 2} y="189" textAnchor="middle" className="chart-label">{row.name.slice(5)}</text>}
      </g>; })}
      {!visible.length && <text x="400" y="96" textAnchor="middle" className="chart-label">{language === 'zh' ? '未有可分配時間嘅用量' : 'No timed usage available'}</text>}
    </svg>
    <figcaption><span><i className="legend-response" />{language === 'zh' ? '已識別回應' : 'Identified responses'}</span><span><i className="legend-interval" />{language === 'zh' ? '區間用量（按結束時間）' : 'Intervals at end time'}</span><span>Asia/Hong_Kong</span></figcaption>
  </figure>;
}

function Ranking({ items, onSelect, onUnknown, unknown, label }: { items: AnalyticsBucket[]; onSelect?: (name: string) => void; onUnknown?: (item: AnalyticsBucket) => void; unknown: string; label: (name: string) => string }) {
  const max = items.reduce((m, item) => BigInt(item.total ?? '0') > m ? BigInt(item.total ?? '0') : m, 1n);
  return <div className="inspector-ranking">{items.slice(0, 7).map(item => <button key={item.name} disabled={item.name === '(unknown)' ? !onUnknown : !onSelect} onClick={() => item.name === '(unknown)' ? onUnknown?.(item) : onSelect?.(item.name)} title={item.name}>
    <div><span>{item.name === '(unknown)' ? unknown : label(item.name)}</span><strong>{compact(item.total)}</strong></div><div className="ranking-track"><i style={{ width: `${Number(BigInt(item.total ?? '0') * 10000n / max) / 100}%` }} /></div>
  </button>)}{!items.length && <p className="inspector-empty">{unknown}</p>}</div>;
}

export default function InspectorWorkspace() {
  const api = window.tokenInspector;
  const [view, setView] = useState<View>('overview'); const [language, setLanguage] = useState<Language>(() => localStorage.getItem('inspector.language') === 'en' ? 'en' : 'zh');
  const [qualitySection, setQualitySection] = useState<'coverage' | 'collectors' | 'quotas' | 'resources'>('coverage');
  const [monitorOpened, setMonitorOpened] = useState(false);
  const [timelineTarget, setTimelineTarget] = useState<{ findingId?: string; evidenceRef?: string }>();
  const [currency, setCurrency] = useState<'USD' | 'tokens'>(() => localStorage.getItem('inspector.unit') === 'tokens' ? 'tokens' : 'USD'); const [usd, setUsd] = useState<ManualUsdView>();
  const [graphSelection, setGraphSelection] = useState<{ id: string; threadId: string | null; harness: string; name: string }>();
  const [experimentTarget, setExperimentTarget] = useState<{ runId: string; contractId?: string }>();
  const [summaryScope, setSummaryScope] = useState('');
  const [query, setQuery] = useState<InspectorQuery>({ days: 0 }); const [summary, setSummary] = useState<InspectorSummary>();
  const [analytics, setAnalytics] = useState<InspectorAnalytics>(); const [sources, setSources] = useState<SourceHealth[]>([]);
  const [legacy, setLegacy] = useState<LegacyOverview>(); const [status, setStatus] = useState<InspectorStatus>();
  const [receiver, setReceiver] = useState<ReceiverView>(); const [scopeOptions, setScopeOptions] = useState<ScopeOptions>();
  const [deviceReadError, setDeviceReadError] = useState(false);
  const [liveHistory, setLiveHistory] = useState(true); const readerSelection = useRef('');
  const [ledger, setLedger] = useState<LedgerEntry[]>([]); const [ledgerCursor, setLedgerCursor] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsView>(); const [error, setError] = useState<string>(); const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(''); const [evidence, setEvidence] = useState<EvidenceView | null>(null); const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [metricDetail, setMetricDetail] = useState<{ title: string; value: Metric; displayValue?: string; valueLabel?: string } | null>(null); const [showConflicts, setShowConflicts] = useState(false);
  const [explainedEntry, setExplainedEntry] = useState<LedgerEntry>();
  const [totalExplanation, setTotalExplanation] = useState<import('../shared/inspector').TotalExplanationRequest>();
  const [analysisSection, setAnalysisSection] = useState<'candidates' | 'retries' | 'agents' | 'incidents'>('candidates');
  const [historySection,setHistorySection]=useState<'timeline'|'content'>('timeline');
  useEffect(() => { if (timelineTarget) setHistorySection('timeline'); }, [timelineTarget]);
  const [contextSection,setContextSection]=useState<'activity'|'tools'|'attribution'|'manifests'|'compactions'>('activity');
  const [contextTools,setContextTools]=useState<ToolView[]>([]);const [contextToolsCursor,setContextToolsCursor]=useState<string|null>(null);
  const [modelTransitionsOpen, setModelTransitionsOpen] = useState(false);
  const [budgets, setBudgets] = useState<BudgetState>();
  const evidenceEpoch = useRef(0); const generation = useRef(0); const previousFocus = useRef<HTMLElement | null>(null);
  const evidenceDialog = useRef<HTMLElement>(null);
  const evidenceDialogOpen = !!(evidence || evidenceLoading || metricDetail);
  const closeEvidence = useCallback(() => { evidenceEpoch.current++; setEvidence(null); setEvidenceLoading(false); setMetricDetail(null); }, []);
  const loadInFlight = useRef(false); const reloadQueued = useRef(false); const latestLoad = useRef<(() => Promise<void>) | undefined>(undefined);
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const localMachineId = receiver?.devices.find(device => device.state === 'local')?.id;
  const syncGraphScope = useCallback((run: AgentRun, root: Agent) => {
    const next = { id: run.id, threadId: root.threadId ?? null, harness: run.harness, name: run.title ?? run.cwd?.split('/').at(-1) ?? run.id };
    setGraphSelection(previous => previous?.id === next.id && previous.threadId === next.threadId && previous.name === next.name ? previous : next);
    if (run.harness === 'codex' && root.threadId) setQuery(previous => previous.runId === root.threadId && previous.machineId === localMachineId && !previous.days && !previous.requestedModel && !previous.attributedModel && !previous.projectId ? previous : { runId: root.threadId, machineId: localMachineId, days: 0 });
  }, [localMachineId]);
  const changeGraphAccounting = useCallback((agent: Agent | undefined, mode: 'exclusive' | 'inclusive') => {
    if (graphSelection?.harness !== 'codex' || !graphSelection.threadId) return;
    const agentId = agent?.threadId;
    setQuery(previous => previous.runId === graphSelection.threadId && previous.machineId === localMachineId && previous.agentId === agentId && (!agentId || previous.agentMode === mode) ? previous : { runId: graphSelection.threadId!, machineId: localMachineId, agentId, agentMode: mode, days: 0 });
  }, [graphSelection?.threadId, graphSelection?.harness, localMachineId]);
  const changeView = (next: View) => { if (next === 'monitor') setMonitorOpened(true); setView(next); setSearch(''); };

  const load = useCallback(async () => {
    if (!api) return;
    if (loadInFlight.current) { reloadQueued.current = true; return; }
    loadInFlight.current = true; const current = ++generation.current;
    try {
      const [[nextSummary, nextAnalytics, nextSources, nextStatus, nextLegacy, nextBudgets, nextUsd, nextScopeOptions]] = await Promise.all([
        Promise.all([api.summary(query), api.analytics(query), api.sources(), api.status(), api.legacy(), api.budgets(), api.manualUsd(query), api.scopeOptions()]),
        api.devices().then(value => { if (current === generation.current) { setReceiver(value); setDeviceReadError(false); } }).catch(e => { if (current === generation.current && !api.deviceActivity) setDeviceReadError(true); throw e; }),
      ]);
      if (current !== generation.current) return;
      setSummaryScope(JSON.stringify(query)); setSummary(nextSummary); setAnalytics(nextAnalytics); setSources(nextSources); setStatus(nextStatus); setLegacy(nextLegacy); setBudgets(nextBudgets); setError(undefined);
      setUsd(nextUsd); setScopeOptions(nextScopeOptions);
    } catch (e) { if (current === generation.current) setError((e as Error).message); }
    finally { loadInFlight.current = false; if (reloadQueued.current) { reloadQueued.current = false; void latestLoad.current?.(); } }
  }, [api, query]);
  useEffect(() => {
    generation.current++; latestLoad.current = load; void load();
    const unsubscribe = api?.onChanged(() => { void load(); });
    return () => { generation.current++; latestLoad.current = undefined; unsubscribe?.(); };
  }, [api, load]);
  useEffect(() => {
    if (!api?.deviceActivity || !api.onDevicesChanged) return;
    const activity = api.deviceActivity; let alive = true, running = false, pending = false;
    const update = async () => {
      if (running) { pending = true; return; } running = true;
      try { const value = await activity(); if (alive) { setReceiver(previous => applyDeviceActivity(previous, value)); setDeviceReadError(false); } }
      catch (e) { if (alive) { setDeviceReadError(true); setError((e as Error).message); } }
      finally { running = false; if (alive && pending) { pending = false; void update(); } }
    };
    void update(); const unsubscribe = api.onDevicesChanged(() => void update());
    const timer = setInterval(() => void update(), 60000);
    return () => { alive = false; clearInterval(timer); unsubscribe(); };
  }, [api]);
  useEffect(() => {
    if (!api || !['ledger', 'context', 'findings'].includes(view) || view === 'context' && !['tools','compactions'].includes(contextSection) || view === 'findings' && analysisSection === 'incidents') return;
    const selection = JSON.stringify([view, contextSection, query, showConflicts]);
    if (!liveHistory && readerSelection.current === selection) return;
    if (readerSelection.current !== selection && view === 'context') { if (contextSection === 'tools') { setContextTools([]);setContextToolsCursor(null); } else setDiagnostics(undefined); }
    readerSelection.current = selection;
    let alive = true, running = false, pending = false;
    const read = async () => {
      if (running) { pending = true; return; } running = true; if (alive) setBusy(true);
      try {
        if (view === 'ledger') { const page = await api.ledger({ ...query, includeQuarantined: showConflicts }); if (alive) { setLedger(page.items); setLedgerCursor(page.nextCursor); } }
        else if (view === 'context' && contextSection === 'tools') { const page = await api.tools(query); if (alive) { setContextTools(page.items); setContextToolsCursor(page.nextCursor); } }
        else { const result = await api.diagnostics(query); if (alive) setDiagnostics(result); }
      } catch (e) { if (alive) setError((e as Error).message); }
      finally { running = false; if (alive) setBusy(false); if (alive && pending) { pending = false; void read(); } }
    };
    void read(); const unsubscribe = liveHistory ? api.onChanged(() => void read()) : undefined;
    return () => { alive = false; unsubscribe?.(); setBusy(false); };
  }, [api, view, contextSection, analysisSection, query, showConflicts, liveHistory]);
  useEffect(() => {
    if (!evidenceDialogOpen) return;
    previousFocus.current = document.activeElement as HTMLElement;
    const timer = setTimeout(() => evidenceDialog.current?.querySelector<HTMLButtonElement>('button')?.focus(), 0);
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeEvidence(); return; }
      if (event.key !== 'Tab') return;
      const buttons = Array.from(evidenceDialog.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
      const first = buttons[0]; const last = buttons.at(-1);
      if (!evidenceDialog.current?.contains(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
    };
    window.addEventListener('keydown', listener); return () => { clearTimeout(timer); window.removeEventListener('keydown', listener); if (previousFocus.current?.isConnected) previousFocus.current.focus(); };
  }, [evidenceDialogOpen, closeEvidence]);
  useEffect(() => window.agentMonitor?.onPrivacyChanged?.(() => { evidenceEpoch.current++; setEvidence(null); setEvidenceLoading(false); setMetricDetail(null);setContextTools([]);setContextToolsCursor(null); }), []);
  const openEvidence = async (id: string) => {
    if (!api) return; const epoch = ++evidenceEpoch.current; setEvidenceLoading(true); setMetricDetail(null);
    try { const value = await api.evidence(id); if (epoch === evidenceEpoch.current) setEvidence(value); } catch (e) { if (epoch === evidenceEpoch.current) setError((e as Error).message); } finally { if (epoch === evidenceEpoch.current) setEvidenceLoading(false); }
  };
  const refresh = async () => { if (!api) return; setBusy(true); try { await api.refresh(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const paged = async () => {
    if (!api) return; setBusy(true);
    setLiveHistory(false);
    try {
      if (ledgerCursor) { const page = await api.ledger({ ...query, includeQuarantined: showConflicts, cursor: ledgerCursor }); setLedger(page.items); setLedgerCursor(page.nextCursor); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const selectedSources = sources.filter(source => !query.machineId || source.machineId === query.machineId);
  const threads = useMemo(() => [...new Set(sources.map(source => source.threadId).filter((id): id is string => !!id))], [sources]);
  const machines = useMemo(() => [...new Set(sources.map(source => source.machineId))], [sources]);
  const machineName = (id: string) => receiver?.devices.find(device => device.id === id)?.name ?? `Device ${short(id)}`;
  const currentUsd = usd?.revision === summary?.revision && summaryScope === JSON.stringify(query) ? usd : undefined;
  const explainUnknownTokens = (kind: 'model' | 'project', row: AnalyticsBucket) => {
    if (summaryScope !== JSON.stringify(query)) return;
    setMetricDetail({
      title: kind === 'model' ? t('Requested Model 未記錄', 'Requested model unrecorded') : t('Project 身份未識別', 'Project identity unidentified'),
      valueLabel: t('呢組已選帳本成員嘅 Token 用量', 'Token usage of this selected ledger group'),
      value: { value: row.total, provenance: row.total === null ? 'unknown' : 'derived', origin: 'monitor_calculation', sourceRefs: [],
        missingReason: kind === 'model' ? t('Token 模型排行按 Requested Model 分組；呢項只代表 Requested Model 未保留，唔會推斷 Observed Model 一定未知。', 'Token model rankings group by requested model. This group lacks a retained requested model; it does not establish that the observed model is unknown.') : t('呢組成員嘅 Project 身份未識別；已知 Token 用量仍保留，唔會猜成其他 Project。', 'Project identity is unidentified for this group; known token usage is retained without assigning a guessed project.'),
        assumptions: [
          `${row.entries.toLocaleString()} ${t('筆已選成員', 'selected entries')} · ${t('讀取時帳本版本', 'Ledger revision at opening')}: ${summary?.revision ?? '—'}`,
          t('Cache 與 Reasoning 已包含喺所屬總量；唔會額外相加。呢個係已收集帳本嘅分組，唔代表帳戶全部模型請求。', 'Cache and reasoning are included subsets, not added again. This is a collected-ledger group, not the complete account request population.'),
          t('打開解釋唔會改動原有篩選或帳本。', 'Opening the explanation changes no filters or ledger records.'),
        ] },
    });
  };
  const explainUnknownCost = (kind: 'model' | 'project', row: import('../shared/inspector').TimeChartGroup) => {
    if (!currentUsd) return;
    setMetricDetail({
      title: kind === 'model' ? t('模型資料未記錄', 'Model information unrecorded') : t('Project 身份未識別', 'Project identity unidentified'),
      displayValue: displayUsd(row.usdUnits, row.usdUpperUnits), valueLabel: t('已換算部分 · API 等值 USD', 'Priced portion · API-equivalent USD'),
      value: { value: null, provenance: 'unknown', origin: 'monitor_calculation', sourceRefs: [],
        missingReason: kind === 'model' ? t('呢組已選帳本成員冇可用嘅 Observed Model 或 Requested Model；唔會猜成其他模型。按模型自動換算需要模型資料。', 'This selected ledger group has no usable observed or requested model. Another model is not guessed; automatic per-model pricing needs that field.') : t('呢組已選帳本成員冇可用嘅 Project 身份。已知模型嘅可換算金額仍保留，唔會猜成其他 Project。', 'This selected ledger group has no usable project identity. Priceable amounts for known models are retained without assigning a guessed project.'),
        assumptions: [
          `${row.entries.toLocaleString()} ${t('筆已選成員', 'selected entries')} · ${formatInteger(row.total)} tokens · ${row.usdUnpriced.toLocaleString()} ${t('筆未定價', 'unpriced entries')}`,
          t('上面只顯示已能換算嘅部分；未定價部分唔當成零。身份未知亦唔等於全部金額都未知。', 'The amount covers the priceable portion only; unpriced entries are not treated as zero. Unknown identity does not make every amount unknown.'),
          currentUsd.price?.mode === 'uniform' ? `${t('目前用戶設定均一每百萬 Token 價目：', 'User-defined rate per million tokens: ')}${currentUsd.price.uniformRate} USD。${t('唔需要模型身份；呢個係自訂情境估算。', 'Model identity is not required; this is a custom scenario estimate.')}` : currentUsd.price?.mode === 'components' ? `${t('用戶設定每百萬 Token 價目：', 'User-defined rates per million tokens: ')}Input ${currentUsd.price.inputRate ?? '—'} / Cached Input ${currentUsd.price.cachedInputRate ?? '—'} / Output ${currentUsd.price.outputRate ?? '—'} USD。${t('只有必要欄位足夠嘅成員可以換算。', 'Only entries with the required fields can be priced.')}` : t('目前沿用已保存嘅模型官方價目快照；必要模型或用量欄位不足嘅成員保持未定價。', 'The saved official model-price snapshot is used; entries missing required model or usage fields remain unpriced.'),
          `${t('讀取時帳本版本', 'Ledger revision at opening')}: ${currentUsd.revision} · ${t('價目版本', 'Price version')}: ${currentUsd.price?.id ?? t('未啟用', 'Disabled')}`,
          t('打開呢個解釋唔會改篩選、帳本或價目；顯示嘅金額唔係訂閱帳單。', 'Opening this explanation changes no filters, ledger records or prices. The displayed estimate is not a subscription bill.'),
        ] },
    });
  };
  const lowerUsd = amountUnits(currentUsd?.amount); const upperUsd = amountUnits(currentUsd?.upperAmount);
  const timedDays = currentUsd?.breakdown.days.filter(day => day.id !== '(untimed)') ?? [];
  const observedDays = timedDays.length ? Math.max(1, Math.round((Date.parse(timedDays.at(-1)!.id) - Date.parse(timedDays[0].id)) / 86400000) + 1) : 0;
  const averageDays = query.days || observedDays;
  const dailyUsd = (field: 'usdUnits' | 'usdUpperUnits') => averageDays && timedDays.some(day => day[field] !== null) ? (timedDays.reduce((sum, day) => sum + BigInt(day[field] ?? '0'), 0n) / BigInt(averageDays)).toString() : null;
  const millionUsd = (units: string | null) => units !== null && BigInt(currentUsd?.pricedTokens ?? '0') > 0n ? (BigInt(units) * 1000000n / BigInt(currentUsd!.pricedTokens)).toString() : null;
  const changeCurrency = (value: 'USD' | 'tokens') => { setCurrency(value); localStorage.setItem('inspector.unit', value); };
  const included = summary?.usage; const cacheShare = ratio(summary?.cacheCoveredRead.value ?? null, summary?.cacheCoveredInput.value ?? null);
  const filteredLedger = ledger.filter(entry => `${entry.identity.responseId ?? ''} ${entry.model.requestedModel ?? ''} ${entry.identity.threadId ?? ''} ${entry.grain} ${entry.issues.join(' ')}`.toLowerCase().includes(search.toLowerCase()));

  if (!api) return <App />;
  return <div className="inspector-shell">
    <aside className="inspector-sidebar"><div className="inspector-brand"><span className="inspector-mark"><Activity size={20} /></span><div><strong>Agent Monitor</strong><span>Token Inspector</span></div></div>
      <nav aria-label="Workspace">{[
        { label: t('工作區', 'Workspace'), ids: ['overview', 'monitor', 'machines'] },
        { label: t('調查', 'Investigate'), ids: ['ledger', 'history', 'context', 'findings', 'experiments'] },
        { label: t('管理', 'Manage'), ids: ['quality', 'settings'] },
      ].map(group => <div className="inspector-nav-group" key={group.label}><p>{group.label}</p>{NAV.filter(item => group.ids.includes(item.id)).map(item => <button key={item.id} className={view === item.id ? 'is-active' : ''} onClick={() => changeView(item.id)} title={item.en} aria-current={view === item.id ? 'page' : undefined}><item.icon size={17} /><span>{language === 'zh' ? item.zh : item.en}</span></button>)}</div>)}</nav>
      <div className="inspector-sidebar-foot"><ShieldCheck size={16} /><span>{t('本機分析・統計同步', 'Local analysis · metadata sync')}</span><small>Agent Monitor + Codex Usage</small></div>
    </aside>
    <main className="inspector-main">
      <header className="inspector-header"><div><span className="inspector-breadcrumb">Workspace / {t('用量調查', 'Usage investigation')}</span><h1>{language === 'zh' ? NAV.find(item => item.id === view)?.zh : NAV.find(item => item.id === view)?.en}</h1></div>
        <div className="inspector-header-actions"><ReparseStatus api={api} language={language} /><span className={`inspector-status ${status?.phase === 'degraded' ? 'is-warning' : ''}`}><i />{status?.phase === 'ready' ? t('已同步索引', 'Index current') : status?.phase === 'indexing' || !status ? t('正在索引', 'Indexing') : t('需要檢查', 'Needs attention')}</span><button className="inspector-icon-button" onClick={() => void refresh()} disabled={busy} aria-label="Refresh"><RefreshCw size={17} /></button><ThemeSelector inspector /></div>
      </header>
      {status?.scanBlocked && <div className="inspector-error" role="alert" aria-label="Indexing paused"><span>{status.scanBlocked.reason === 'STORAGE_FULL' ? t('本機索引已暫停：儲存空間不足。請釋放空間後重試。', 'Local indexing is paused: storage is full. Free space before retrying.') : t('本機索引已暫停：資料庫未能寫入。請檢查儲存位置及寫入權限後重試。', 'Local indexing is paused: the database is not writable. Check the storage location and write permission before retrying.')}{' '}{t('保留最近有效帳本；自動掃描已停止。', 'The last valid ledger is retained; automatic scans are stopped.')}</span><button onClick={() => void refresh()} disabled={busy}>{t('重試索引', 'Retry indexing')}</button></div>}
      {error && <div className="inspector-error" role="alert">{t('資料暫時未能更新；保留最近有效數據。', 'Update unavailable; last valid data retained.')} <code>{error}</code><button onClick={() => void refresh()}>{t('重試', 'Retry')}</button></div>}
      {view !== 'monitor' && view !== 'experiments' && <div className="inspector-filters"><select aria-label="Time range" value={query.days ?? 0} onChange={event => setQuery(q => ({ ...q, days: Number(event.target.value), from: undefined, to: undefined }))}><option value="0">{t('所有已記錄用量', 'All recorded usage')}</option><option value="1">{t('最近 1 日（有時間紀錄）', 'Last day · timed')}</option><option value="2">{t('最近 2 日（有時間紀錄）', 'Last 2 days · timed')}</option><option value="7">{t('最近 7 日（有時間紀錄）', 'Last 7 days · timed')}</option><option value="30">{t('最近 30 日（有時間紀錄）', 'Last 30 days · timed')}</option><option value="90">{t('最近 90 日（有時間紀錄）', 'Last 90 days · timed')}</option></select>
        <select aria-label="Machine filter" value={query.machineId ?? ''} onChange={event => setQuery(q => ({ ...q, machineId: event.target.value || undefined, agentId: undefined }))}><option value="">{t('全部設備', 'All machines')}</option>{machines.map(id => <option key={id} value={id}>{machineName(id)}</option>)}</select>
        <select aria-label="Run filter" value={query.runId ?? ''} onChange={event => setQuery(q => ({ ...q, runId: event.target.value || undefined }))}><option value="">{t('全部 Session／Run', 'All sessions / runs')}</option>{threads.map(id => <option key={id} value={id}>{short(id, 16)}</option>)}</select>
        {(query.requestedModel || query.attributedModel || query.projectId) && <button onClick={() => setQuery(q => ({ ...q, requestedModel: undefined, attributedModel: undefined, projectId: undefined }))}>{query.attributedModel ?? query.requestedModel ?? short(query.projectId ?? null)} <X size={13} /></button>}
        <select aria-label="Display unit" value={currency} onChange={event => changeCurrency(event.target.value as typeof currency)}><option value="USD">{t('美元成本（預設）', 'USD cost (default)')}</option><option value="tokens">Token</option></select><span>{summary ? `Revision ${summary.revision}` : t('讀取中…', 'Loading…')}</span>
      </div>}

      {view !== 'monitor' && view !== 'experiments' && <ScopeFilters query={query} options={scopeOptions} receiver={receiver} language={language} onChange={setQuery} />}
      {view === 'monitor' && <div className="inspector-filters inspector-monitor-scope" role="status"><span>{t('本機實際 Trace・節點保留來源回報，上方總數使用核對帳本', 'Actual local traces · nodes show source reports; totals use the reconciled ledger')}</span>{graphSelection && <><span>{graphSelection.harness === 'codex' ? query.agentId ? query.agentMode === 'inclusive' ? t('帳本顯示已選 Agent 同子 Agent 嘅聯集', 'Ledger shows selected agent and descendant union') : t('帳本只顯示已選 Agent 自己', 'Ledger shows selected agent only') : t('用量帳本已跟隨呢個 Run（包括已識別子 Agent）', 'Ledger follows this run, including identified descendants') : t('其他 Provider 保留原版 Trace；Codex 帳本範圍另行選擇', 'Other providers retain their original traces; Codex ledger scope is selected separately')}</span></>}</div>}
      <div className="inspector-monitor" hidden={view !== 'monitor'}>{monitorOpened && <App liveOnly embedded active={view === 'monitor'} language={language} canonicalSummary={localMachineId && graphSelection?.harness === 'codex' && graphSelection.threadId === query.runId && summaryScope === JSON.stringify(query) ? summary : undefined} canonicalUsd={localMachineId && graphSelection?.harness === 'codex' && graphSelection.threadId === query.runId && summaryScope === JSON.stringify(query) ? currentUsd : undefined} currency={currency} onCurrencyChange={changeCurrency} accountingScope={query.agentId ? query.agentMode ?? 'exclusive' : 'run'} onAccountingScopeChange={changeGraphAccounting} taskAcceptance={localMachineId && graphSelection?.harness === 'codex' && graphSelection.threadId ? <RunTaskPanel api={api} active={view === 'monitor'} runId={graphSelection.threadId} machineId={localMachineId} language={language} onEvidence={ref => void openEvidence(ref)} onOpen={contractId => { setExperimentTarget({ runId: graphSelection.threadId!, contractId }); changeView('experiments'); }} /> : undefined} onInspectUsage={() => changeView('ledger')} onRunSelected={syncGraphScope} />}</div>
      <div className="inspector-content" hidden={view === 'monitor'}>
        {(view === 'ledger' || view === 'context') && <div className="inspector-reader-controls"><button className="inspector-link" onClick={() => setLiveHistory(value => !value)}>{liveHistory ? t('暫停即時更新', 'Pause live updates') : t('恢復即時更新／首頁', 'Resume live / first page')}</button><span>{liveHistory ? t('Live', 'Live') : t('閱讀中；保留目前頁面', 'Reading · page preserved')}</span></div>}
        {budgets?.policies.filter(policy => policy.crossed).map(policy => <div className="inspector-budget-alert" role="status" key={policy.id}>{t('已觀察用量達到設定門檻：', 'Observed usage reached budget: ')}{budgetAmount(policy.current, policy)} / {budgetAmount(policy.tokenLimit, policy)} <button className="inspector-link" onClick={() => { setQuery(policy.query); changeView('ledger'); }}>{t('查看帳本', 'Inspect ledger')}</button></div>)}
        {view === 'experiments' && <ExperimentsPanel api={api} threads={threads} sources={sources} machines={receiver?.devices ?? []} language={language} target={experimentTarget} />}
        {view === 'machines' && <DevicesPanel api={api} language={language} />}
        {view === 'settings' && <UsdConversionPanel api={api} query={query} language={language} />}
        {view === 'settings' && <PricesPanel api={api} query={query} language={language} />}
        {view === 'settings' && <PrivacyPanel api={api} sources={sources} language={language} />}
        {view === 'quality' && <nav className="inspector-context-navigation inspector-quality-navigation" aria-label="Data quality sections">{[
          { id: 'coverage', zh: '資料覆蓋', en: 'Coverage', detailZh: '解析、缺口與原始檔', detailEn: 'Parsing, gaps and originals' },
          { id: 'collectors', zh: '設備健康', en: 'Collector health', detailZh: '跨設備連線與 Client 快照', detailEn: 'Connections and client snapshots' },
          { id: 'quotas', zh: '額度記錄', en: 'Recorded quotas', detailZh: '來源記錄內嘅額度視窗', detailEn: 'Quota windows in source records' },
          { id: 'resources', zh: 'Monitor 資源', en: 'Monitor resources', detailZh: 'CPU、記憶體與索引空間', detailEn: 'CPU, memory and index storage' },
        ].map(section => <button key={section.id} aria-pressed={qualitySection === section.id} onClick={() => setQualitySection(section.id as typeof qualitySection)}><strong>{t(section.zh, section.en)}</strong><small>{t(section.detailZh, section.detailEn)}</small></button>)}</nav>}
        {view === 'quality' && qualitySection === 'coverage' && <SourceAvailabilityPanel api={api} sources={sources.slice(0, 200)} limited={sources.length > 200} language={language} />}
        {view === 'quality' && qualitySection === 'quotas' && <QuotasPanel api={api} query={query} language={language} onEvidence={id => void openEvidence(id)} />}
        {(view === 'quality' || view === 'settings') && status?.fingerprinting === 'unavailable' && <section className="inspector-panel"><h2>{t('內容指紋暫時不可用', 'Content fingerprints unavailable')}</h2><p>{t('系統鑰匙圈未能喺限時內提供 Monitor 自己嘅指紋金鑰。Token 帳本照常使用；新內容嘅相同比較會標示證據不足，唔會改用明文金鑰。', 'The OS keychain did not supply the monitor fingerprint key within the time limit. Token accounting remains available; new content equality analysis reports insufficient evidence and does not use a plaintext key.')}</p></section>}
        {view === 'settings' && <>
          <BudgetsPanel api={api} query={query} data={budgets} language={language} reload={async () => setBudgets(await api.budgets())} />
          <ReportPanel api={api} query={query} language={language} />
        </>}
        {view === 'overview' && <>
          <section className="inspector-hero"><div><span className="inspector-eyebrow">{currency === 'USD' ? t('已選範圍・API 等值成本', 'Selected scope · API-equivalent cost') : t('已選帳本用量', 'Selected ledger usage')}</span><div className="inspector-total" aria-label="Primary usage total" title={currency === 'USD' ? `${currentUsd?.amount ?? 'unknown'} – ${currentUsd?.upperAmount ?? 'unknown'} USD` : undefined}>{currency === 'USD' ? displayUsd(lowerUsd, upperUsd) : formatInteger(included?.total.value)}<span>{currency === 'USD' ? 'USD' : 'tokens'}</span></div><p><strong>{formatInteger(included?.total.value)} tokens</strong> · {currentUsd?.pricedEntries ?? '—'} {t('已換算', 'priced')} · {currentUsd?.unpricedEntries ?? '—'} {t('未定價記錄', 'unpriced entries')}</p><p>{currency === 'USD' ? t('按每筆模型計價；未知快取顯示成本範圍。呢個係 API 等值估算，唔係訂閱帳單。', 'Per-entry model prices; unknown cache produces cost bounds. API-equivalent estimate, not a subscription bill.') : t('Cache 與 Reasoning 已包含喺總數。', 'Cache and reasoning are included subsets.')}</p><button className="inspector-link" disabled={!summary || summaryScope !== JSON.stringify(query) || currency === 'USD' && !currentUsd} onClick={() => summary && setTotalExplanation({ query: { ...query }, revision: summary.revision, usdPriceId: currentUsd ? currentUsd.price?.id ?? null : undefined, expectedTotal: summary.usage.total.value, expectedUsd: currentUsd ? { amount: currentUsd.amount, upperAmount: currentUsd.upperAmount } : undefined })}>{t('解釋總數', 'Explain this total')}</button><button className="inspector-link" style={{ marginLeft: 18 }} onClick={() => changeView('ledger')}>{t('查看用量明細', 'Inspect usage records')} <ArrowRight size={15} /></button><button className="inspector-link" style={{ marginLeft: 18 }} onClick={() => changeView('settings')}>{t('價目及資料匯出', 'Pricing & export')} <ArrowRight size={15} /></button></div>
            <div className="inspector-hero-details"><button onClick={() => document.querySelector('.time-dashboard')?.scrollIntoView({ behavior: 'smooth' })}><span>{t('平均每日成本（有時間部分）', 'Average daily cost · timed')}</span><strong>{displayUsd(dailyUsd('usdUnits'), dailyUsd('usdUpperUnits'))}</strong><small>{averageDays ? `${averageDays} ${t('日分母', 'day denominator')}` : t('時間未知', 'Time unknown')}</small></button><button onClick={() => changeView('settings')}><span>{t('每百萬 Token 等值成本', 'Cost per 1M priced tokens')}</span><strong>{displayUsd(millionUsd(lowerUsd), millionUsd(upperUsd))}</strong><small>{t('只用可定價部分做分母', 'Priced token coverage only')}</small></button><button onClick={() => included && setMetricDetail({ title: 'Input / cache coverage', value: included.cachedInput })}><span>{t('快取覆蓋比例', 'Cache share')}</span><strong>{cacheShare === null ? '—' : `${cacheShare.toFixed(1)}%`}</strong><small>{t('只比較有 Input 同 Cache 欄位嘅記錄', 'Only records with both input and cache')}</small></button></div>
          </section>
        </>}
        <details className="inspector-account-access" hidden={view !== 'overview'} aria-label="Official account readings"><summary><strong>{t('官方帳戶累計與額度', 'Official account totals and limits')}</strong><span>{t('全帳戶資料，與上方已收集明細分開；展開後按鈕查詢', 'Account-wide readings, separate from collected records; expand to query')}</span></summary><AccountUsagePanel api={api} summary={summaryScope === JSON.stringify(query) ? summary : undefined} language={language} /><AccountLimitsPanel api={api} language={language} /></details>
        {view === 'overview' && <>
          <div className="inspector-grid"><section className="inspector-panel inspector-panel-wide"><div className="inspector-panel-heading"><div><h2>{currency === 'USD' ? t('每日成本及 Token 用量', 'Daily cost and token usage') : t('用量時間分佈', 'Usage over time')}</h2><p>{t('未有時間嘅先前用量唔會塞入匯入當日。', 'Prior untimed usage is not assigned to import day.')}</p></div><span className="inspector-badge">{t('最多顯示 60 日', 'Up to 60 days')}</span></div>{currency === 'USD' ? <DailyCostChart buckets={analytics?.buckets ?? []} costs={currentUsd?.breakdown.days ?? []} language={language} /> : <DailyChart buckets={analytics?.buckets ?? []} language={language} />}<div className="inspector-chart-note">{t('未分配時間：', 'Untimed: ')}{formatInteger(analytics?.untimedTotal)} tokens · {t('區間內實際發生時間未知。', 'Exact timing inside intervals is unknown.')}</div></section>
            <section className="inspector-panel"><div className="inspector-panel-heading"><div><h2>{t('用量組成與覆蓋', 'Composition & coverage')}</h2><p>{t('缺少欄位會保留為未知。', 'Missing fields remain unknown.')}</p></div></div><div className="inspector-composition"><span>Cached input <strong>{formatInteger(included?.cachedInput.value)}</strong></span><div className="composition-track"><i style={{ width: `${Math.min(cacheShare ?? 0, 100)}%` }} /></div><small>{cacheShare === null ? t('Cache 比例未知', 'Cache share unknown') : `${cacheShare.toFixed(1)}% ${t('有 Cache 欄位嘅 Input', 'of input with cache coverage')}`}</small><span>Reasoning output <strong>{formatInteger(included?.reasoningOutput.value)}</strong></span><small>{t('Output 嘅子項；唔會再加一次。', 'Included in output; never added again.')}</small><hr /><span>{t('Cache 欄位缺少嘅 Input', 'Input without cache coverage')}<strong>{formatInteger(summary?.cacheUncoveredInput.value)}</strong></span><span>{t('有衝突、已隔離', 'Conflicted & excluded')}<strong>{summary?.quarantinedEntries ?? '—'}</strong></span><button className="inspector-link" onClick={() => changeView('quality')}>{t('檢查數據品質', 'Inspect data quality')} <ArrowRight size={14} /></button></div></section>
          </div>
          <OverviewInsightsPanel key={JSON.stringify(query)} api={api} query={query} summary={summaryScope === JSON.stringify(query) ? summary : undefined} sources={summaryScope === JSON.stringify(query) ? sources : undefined} language={language} onLedger={() => changeView('ledger')} onSources={() => changeView('machines')} onQuality={() => { setQualitySection('coverage'); changeView('quality'); }} onFindings={() => { setAnalysisSection('incidents'); changeView('findings'); }} onEvidence={id => void openEvidence(id)} />
        {view === 'overview' && receiver && <section className="inspector-panel"><div className="inspector-panel-heading"><div><h2>{t('各設備用量', 'Usage by machine')}</h2><p>{t('按目前篩選範圍；配對同收到統計分開顯示。', 'Current filter scope; enrollment and received usage are separate.')}</p></div></div><div className="inspector-device-strip">{receiver.devices.map(device => { const bucket = analytics?.machines.find(item => item.name === device.id); const cost = currentUsd?.breakdown.machines.find(item => item.id === device.id); return <button key={device.id} onClick={() => setQuery(q => ({ ...q, machineId: device.id }))}><Monitor size={19} /><span><strong>{device.name}</strong><small>{device.state === 'local' ? t('本機索引', 'Local index') : device.lastSeenAt ? time(device.lastSeenAt) : t('未收到統計', 'No statistics received')}</small></span><b>{currency === 'USD' ? displayUsd(cost?.usdUnits ?? null, cost?.usdUpperUnits ?? null) : compact(bucket?.total ?? null)}<small>{currency === 'USD' ? `${compact(bucket?.total ?? null)} tokens` : ''}</small></b></button>; })}</div></section>}
          <details className="inspector-panel"><summary>{t('換算設定與價目來源', 'Conversion settings and price sources')}</summary><UsdConversionPanel api={api} query={query} language={language} /></details>
          <div className="inspector-grid inspector-grid-equal"><section className="inspector-panel"><div className="inspector-panel-heading"><div><h2>{currency === 'USD' ? t('模型成本分佈', 'Model cost distribution') : t('模型分佈', 'Model distribution')}</h2><p>{currency === 'USD' ? t('優先使用已觀察模型；缺少時沿用 Requested Model。', 'Observed model first, otherwise the requested model.') : t('依照 Requested Model；實際路由可能未記錄。', 'Requested model; actual routing may be unrecorded.')}</p></div></div>{currency === 'USD' ? <CostRanking items={currentUsd?.breakdown.models ?? []} language={language} onUnknown={row => explainUnknownCost('model', row)} label={name => name === '(unknown)' ? t('模型未知', 'Unknown model') : name} onSelect={name => { setQuery(q => ({ ...q, requestedModel: undefined, attributedModel: name })); changeView('ledger'); }} /> : <Ranking items={analytics?.models ?? []} onUnknown={summaryScope === JSON.stringify(query) ? row => explainUnknownTokens('model', row) : undefined} unknown={t('模型未知／未有資料', 'Model unknown / unavailable')} label={name => name} onSelect={name => { setQuery(q => ({ ...q, requestedModel: name })); changeView('ledger'); }} />}</section><section className="inspector-panel"><div className="inspector-panel-heading"><div><h2>{currency === 'USD' ? t('Project 成本分佈', 'Project cost distribution') : t('Project 分佈', 'Project distribution')}</h2><p>{t('使用工作區專屬識別，避免傳送完整路徑。', 'Workspace-specific IDs protect full paths.')}</p></div></div>{currency === 'USD' ? <CostRanking items={currentUsd?.breakdown.projects ?? []} language={language} onUnknown={row => explainUnknownCost('project', row)} label={name => name === '(unknown)' ? t('Project 未識別', 'Project unidentified') : `Project ${short(name)}`} onSelect={name => { setQuery(q => ({ ...q, projectId: name })); changeView('ledger'); }} /> : <Ranking items={analytics?.projects ?? []} onUnknown={summaryScope === JSON.stringify(query) ? row => explainUnknownTokens('project', row) : undefined} unknown={t('Project 未識別', 'Project unidentified')} label={name => `Project ${short(name)}`} onSelect={name => { setQuery(q => ({ ...q, projectId: name })); changeView('ledger'); }} />}</section></div>
          <details className="inspector-panel" onToggle={event => setModelTransitionsOpen(event.currentTarget.open)}><summary>{t('逐回應嘅模型／路線轉換', 'Model / route attribution transitions')}</summary>{modelTransitionsOpen && <ModelTransitionsPanel api={api} query={query} language={language} onEntry={setExplainedEntry} onTimeline={(id, machineId) => { setQuery({ machineId, days: 0 }); setTimelineTarget({ evidenceRef: id }); changeView('history'); }} />}</details>
          {summaryScope === JSON.stringify(query) && <TimeChartsPanel onExplain={setMetricDetail} api={api} query={query} language={language} receiver={receiver} currency={currency} onCurrencyChange={changeCurrency} />}
          {legacy?.available && <section className="inspector-panel"><div className="inspector-panel-heading"><div><h2>{t('已連接嘅原有 Collector', 'Existing collectors')}</h2><p>{t('過渡期間保留原有資料；以下 v1 統計未加入新帳本，避免重複計算。', 'Existing v1 data is preserved separately during migration to avoid overlap.')}</p></div><strong>{formatInteger(legacy.total)} <small>tokens · v1</small></strong></div><div className="inspector-device-strip">{legacy.devices.map(device => <button key={device.id} onClick={() => changeView('machines')}><Monitor size={19} /><span><strong>{device.name}</strong><small>{device.lastSeen ? device.online ? t('Collector 在線', 'Collector online') : t('Collector 離線／較舊', 'Collector stale') : t('未收到資料', 'No data received')}</small></span><b>{compact(device.total)}</b></button>)}</div></section>}
        </>}

        {view === 'ledger' && <section className="inspector-panel"><div className="inspector-panel-heading"><div><h2>{t('總數嘅帳本成員', 'Membership behind the total')}</h2><p>{t('回應、區間、先前總量分開標示；累積 counter 只用作核對。', 'Responses, intervals and prior aggregates; cumulative controls are never added again.')}</p></div><label className="inspector-checkbox"><input type="checkbox" checked={showConflicts} onChange={e => setShowConflicts(e.target.checked)} />{t('顯示隔離紀錄', 'Show quarantined')}</label></div><div className="inspector-search"><Search size={15} /><input aria-label="Search ledger" placeholder={t('搜尋本頁回應、模型或 Session', 'Search this page by response, model or session')} value={search} onChange={e => setSearch(e.target.value)} /></div>
          <div className="inspector-table-scroll"><table className="inspector-table"><thead><tr><th>{t('類型／回應', 'Grain / response')}</th><th>{t('模型歸屬', 'Model attribution')}</th><th>Input</th><th>Cached ↳</th><th>Output</th><th>Reasoning ↳</th><th>Total</th><th>{t('狀態／證據', 'State / evidence')}</th></tr></thead><tbody>{filteredLedger.map(entry => <tr key={entry.id} className={entry.selectionStatus === 'quarantined' ? 'is-quarantined' : ''}><td><span className="inspector-badge">{entry.grain}</span><small title={entry.identity.responseId ?? entry.scopeId}>{entry.identity.responseId ? short(entry.identity.responseId, 15) : entry.coverage.priorHistory ? t('先前／未分配時間', 'Prior / untimed') : `${time(entry.startAt)} →`}</small></td><td>{entry.model.observedModel ?? entry.model.requestedModel ?? 'Unknown'}<small>{entry.model.observedModel ? 'observed' : entry.model.requestedModel ? 'requested' : 'unknown'}</small></td>{(['input', 'cachedInput', 'output', 'reasoningOutput', 'total'] as const).map(field => <td key={field}><button className="inspector-number-button" onClick={() => setMetricDetail({ title: field, value: entry.usage[field] })}>{formatInteger(entry.usage[field].value)}</button></td>)}<td><span className="inspector-badge">{entry.reconciliation}</span><button className="inspector-link" onClick={() => setExplainedEntry(entry)}>{t('解釋呢筆用量', 'Explain entry')}</button><button className="inspector-link" onClick={() => void openEvidence(entry.evidenceRefs[0])}>{entry.evidenceCount} {t('來源紀錄', 'observations')}</button><button className="inspector-link" onClick={() => { setTimelineTarget({ evidenceRef: entry.evidenceRefs[0] }); changeView('history'); }}>Timeline</button>{entry.issues.map(issue => <small key={issue}>{issue}</small>)}</td></tr>)}</tbody></table></div>{!ledger.length && !busy && <p className="inspector-empty">{t('呢個範圍未有可核對嘅用量紀錄。', 'No eligible usage observations in this scope.')}</p>}<div className="inspector-pagination"><span>{ledger.length} / {t('每頁最多 200 筆', 'up to 200 per page')}</span><button disabled={!ledgerCursor || busy} onClick={() => void paged()}>{t('下一頁', 'Next page')}</button></div></section>}

        {view === 'history' && <><nav className="inspector-analysis-navigation" aria-label="History sections"><button aria-pressed={historySection==='timeline'} onClick={()=>setHistorySection('timeline')}><FileClock size={18}/><span><strong>{t('事件與用量歷史','Events and usage history')}</strong><small>{t('已保留 Metadata','Retained metadata')}</small></span></button><button aria-pressed={historySection==='content'} onClick={()=>setHistorySection('content')}><Search size={18}/><span><strong>{t('本機文字搜尋','Local text search')}</strong><small>{t('逐 Project 明確同意','Explicit project consent')}</small></span></button></nav>{historySection==='timeline'?<TimelinePanel api={api} query={query} language={language} receiver={receiver} target={timelineTarget} clearTarget={() => setTimelineTarget(undefined)} onEvidence={id => void openEvidence(id)} onLedger={() => changeView('ledger')} />:<ContentSearchPanel key={JSON.stringify(query)} api={api} query={query} language={language} onTimeline={id=>{setTimelineTarget({evidenceRef:id});setHistorySection('timeline');}} />}</>}

        {view === 'context' && <>
          <nav className="inspector-context-navigation" aria-label="Context investigation modes">{[
            {id:'activity',zh:'工具排行',en:'Tool ranking',detailZh:'參數、輸出與量測覆蓋',detailEn:'Arguments, output and coverage'},
            {id:'tools',zh:'工具明細',en:'Tool details',detailZh:'逐筆配對、時間與來源',detailEn:'Pairs, timing and evidence'},
            {id:'attribution',zh:'Context 來源',en:'Context origins',detailZh:'來源文字與內容出現次數',detailEn:'Visible text and occurrences'},
            {id:'manifests',zh:'Client 清單',en:'Client manifests',detailZh:'已授權 Client 嘅請求重建',detailEn:'Authorized client reconstruction'},
            {id:'compactions',zh:'壓縮分析',en:'Compaction analysis',detailZh:'Context 壓縮與 Input 變化',detailEn:'Compaction and input changes'},
          ].map(section=><button key={section.id} aria-pressed={contextSection===section.id} onClick={()=>{setError(undefined);setContextSection(section.id as typeof contextSection);}}><strong>{t(section.zh,section.en)}</strong><small>{t(section.detailZh,section.detailEn)}</small></button>)}</nav>
          {contextSection==='activity'&&<><ToolActivityPanel api={api} query={query} language={language} live={liveHistory} onEvidence={id => void openEvidence(id)} /><ReportPanel api={api} query={query} language={language} diagnosticOnly diagnosticTable="tool-activity" /></>}{contextSection==='attribution'&&<ContextAttributionPanel api={api} query={query} language={language} onEvidence={id => void openEvidence(id)} />}{contextSection==='manifests'&&<ManifestsPanel api={api} query={query} language={language} onEvidence={id => void openEvidence(id)} />}
          {contextSection==='tools'&&<section className="inspector-panel"><div className="inspector-panel-heading"><div><h2>{t('工具操作', 'Tool invocations')}</h2><p>{t('以 call ID 配對；不會將相鄰 request 全部歸因俾一個工具。', 'Paired by call ID; adjacent request usage is not assigned to one tool.')}</p></div></div><div className="inspector-table-scroll"><table className="inspector-table"><thead><tr><th>{t('工具', 'Tool')}</th><th>{t('類型／狀態', 'Operation / status')}</th><th>{t('輸出 bytes', 'Output bytes')}</th><th>{t('Payload 估算', 'Payload estimate')}</th><th>{t('時間', 'Duration')}</th><th>{t('證據', 'Evidence')}</th></tr></thead><tbody>{contextTools.map(tool => <tr key={tool.id}><td>{tool.name}<small>{short(tool.threadId)} · {short(tool.callId)}</small></td><td>{tool.operation}<small>{tool.status} · {tool.pairedBy}</small></td><td>{formatInteger(tool.outputBytes)}</td><td><button className="inspector-number-button" onClick={() => setMetricDetail({ title: tool.name, value: tool.payloadEstimate })}>{formatInteger(tool.payloadEstimate.value)} ≈</button></td><td>{tool.durationMs === null ? '—' : `${(tool.durationMs / 1000).toFixed(1)}s`}</td><td><button className="inspector-link" onClick={() => void openEvidence(tool.evidenceRefs.at(-1)!)}>{t('查看', 'Inspect')}</button></td></tr>)}</tbody></table></div><div className="inspector-pagination"><span>{contextTools.length} {t('筆；每頁最多 200', 'items; up to 200 per page')}</span><button disabled={busy || !contextToolsCursor} onClick={async () => { setLiveHistory(false); setBusy(true); try { const page = await api.tools({ ...query, cursor: contextToolsCursor ?? undefined }); setContextTools(page.items);setContextToolsCursor(page.nextCursor); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{t('下一頁工具', 'Next tools page')}</button></div></section>}
          {contextSection==='compactions'&&<><CompactionsPanel diagnostics={diagnostics ?? null} language={language} openEvidence={id => void openEvidence(id)} openTimeline={id => { setTimelineTarget({ evidenceRef: id }); changeView('history'); }} />
          {diagnostics?.notes.map(note => <p className="inspector-footnote" key={note}>{note}</p>)}</>}</>}

        {view === 'findings' && <>
          <section className="inspector-analysis-heading">
            <div><h2>{t('候選問題與驗證方案', 'Candidates and validation plans')}</h2><p>{t('先看證據與驗收方案，再按需要核對重試、共同操作及提醒。全部沿用目前範圍。', 'Start with evidence and validation plans, then inspect retries, common operations or incidents. Every section uses the current scope.')}</p></div>
            <div className="inspector-analysis-coverage"><strong>{diagnostics?.findings.length ?? '—'}</strong><span>{t('目前可見候選', 'Visible candidates')}</span><small>{t('唔代表全部行為已被觀察', 'Not complete behavioral coverage')}</small></div>
          </section>
          <nav className="inspector-analysis-navigation" aria-label="Analysis sections">
            {[
              { id: 'candidates' as const, icon: Sparkles, label: t('候選與方案', 'Candidates and plans'), detail: t('證據、驗收及回退', 'Evidence, validation and rollback') },
              { id: 'retries' as const, icon: Activity, label: t('重試進度', 'Retry progress'), detail: t('嘗試、輪詢及改動', 'Attempts, polling and edits') },
              { id: 'agents' as const, icon: Network, label: t('跨 Agent 比較', 'Agent comparison'), detail: t('共同操作及獨立覆核', 'Common operations and independent review') },
              { id: 'incidents' as const, icon: ShieldCheck, label: t('異常與提醒', 'Incidents'), detail: t('歷史記錄及受控更新', 'History and controlled updates') },
            ].map(item => <button key={item.id} aria-label={item.label} aria-pressed={analysisSection === item.id} onClick={() => setAnalysisSection(item.id)}><item.icon size={18} /><span><strong>{item.label}</strong><small>{item.detail}</small></span></button>)}
          </nav>
          <div className="inspector-analysis-content">
            {analysisSection === 'retries' && <RetryProgressPanel view={diagnostics?.retries} language={language} onEvidence={id => void openEvidence(id)} onTimeline={id => { setTimelineTarget({ evidenceRef: id }); changeView('history'); }} />}
            {analysisSection === 'agents' && <AgentComparisonPanel api={api} query={query} language={language} openEvidence={id => void openEvidence(id)} openTimeline={agent => { setQuery(q => ({ ...q, machineId: agent.machineId, agentId: agent.threadId, agentMode: 'exclusive' })); setTimelineTarget({}); changeView('history'); }} />}
            {analysisSection === 'incidents' && <IncidentsPanel key={JSON.stringify(query)} api={api} query={query} language={language} />}
            {analysisSection === 'candidates' && <section className="inspector-panel"><div className="inspector-panel-heading"><div><h2>{t('有證據嘅候選問題', 'Evidence-backed candidates')}</h2><p>{t('區分觀察、可能原因同必要驗證；節省量要由實驗確認。', 'Observations, hypotheses and verification are separate; savings require experiments.')}</p></div><span className="inspector-badge">deterministic · AI off</span></div>{!diagnostics?.findings.length && <p className="inspector-empty">{busy ? t('分析中…', 'Analyzing…') : t('目前未有符合門檻嘅候選問題；唔代表所有行為都已被觀察。', 'No qualifying candidates; this does not establish complete behavioral coverage.')}</p>}{diagnostics?.findings.map(finding => <article className="inspector-finding" key={finding.id}><header><h3>{finding.title}</h3><span className="inspector-badge">{finding.confidence} confidence{finding.annotation ? ` · ${finding.annotation}` : ''}</span></header><p>{finding.observedFacts.join(' ')}</p><dl><dt>{t('可能原因', 'Hypothesis')}</dt><dd>{finding.hypotheses.join(' ')}</dd><dt>{t('其他解釋', 'Alternatives')}</dt><dd>{finding.alternativeExplanations.join(' ')}</dd><dt>{t('建議', 'Suggestion')}</dt><dd>{finding.recommendations.join(' ')}</dd><dt>{t('品質風險／驗證', 'Quality / validation')}</dt><dd>{finding.qualityRisk} {finding.validation}</dd><dt>{t('可避免用量', 'Avoidable usage')}</dt><dd>{t('未知；未有符合品質要求嘅對照實驗。', 'Unknown; no quality-preserving comparison measured.')}</dd></dl>{finding.suppressionReasons.length > 0 && <p className="inspector-footnote">{finding.suppressionReasons.join(' ')}</p>}<AdvicePlanPanel api={api} query={query} finding={finding} language={language} /><footer><button className="inspector-link" onClick={() => { setTimelineTarget({ findingId: finding.id }); changeView('history'); }}>Timeline</button>{finding.evidenceRefs.slice(0, 5).map((id, i) => <button className="inspector-link" key={id} onClick={() => void openEvidence(id)}>{t('證據', 'Evidence')} {i + 1}</button>)}<select aria-label="Finding annotation" value={finding.annotation ?? ''} onChange={async e => { await api.annotate(finding.id, e.target.value as NonNullable<FindingView['annotation']>); setDiagnostics(await api.diagnostics(query)); }}><option value="" disabled>{t('標記呢個發現', 'Annotate this finding')}</option><option value="actionable">{t('值得處理', 'Actionable')}</option><option value="intentional">{t('刻意／必要行為', 'Intentional')}</option><option value="not_relevant">{t('不相關', 'Not relevant')}</option><option value="incorrect">{t('判斷不準確', 'Incorrect')}</option><option value="resolved">{t('已解決', 'Resolved')}</option></select></footer></article>)}</section>}
          </div>
        </>}

        {view === 'machines' && <><SourceSamplePanel api={api} language={language} /><section className="inspector-panel"><div className="inspector-panel-heading"><div><h2>{t('舊版 Collector 資料（過渡保留）', 'Legacy collector data · retained')}</h2><p>{t('以下係舊版 v1 統計，未加入新帳本。現行接入設備同已核對用量請睇上方列表。', 'These retained v1 statistics are excluded from the new ledger. Current enrolled devices and canonical usage appear above.')}</p></div></div><div className="inspector-device-strip">{legacy?.devices.map(device => <div key={device.id}><Monitor size={22} /><span><strong>{device.name}</strong><small>{device.lastSeen ? time(device.lastSeen) : t('等候 Client 傳送資料', 'Awaiting client data')}</small><small>Collector v1 · {device.events} {t('用量紀錄', 'usage records')}</small></span><b>{formatInteger(device.total)}<small>tokens</small></b></div>)}{!legacy?.available && <p>MacBook · {sources.length} {t('個本機來源', 'local sources')}</p>}</div></section><section className="inspector-panel"><div className="inspector-panel-heading"><div><h2>{t('本機來源與能力', 'Local source capabilities')}</h2><p>{t('只讀已授權嘅 trace 目錄；完整原始內容唔會同步。', 'Authorized trace roots only; raw content is not synchronized.')}</p></div></div><div className="inspector-table-scroll"><table className="inspector-table"><thead><tr><th>Session</th><th>Runtime</th><th>{t('狀態', 'State')}</th><th>{t('進度', 'Progress')}</th><th>{t('能力', 'Capabilities')}</th></tr></thead><tbody>{selectedSources.slice(0, 200).map(source => <tr key={source.id}><td>{short(source.threadId, 15)}<small>{source.records} {t('紀錄', 'records')} · gen {source.generation}</small></td><td>{source.runtimeVersion ?? 'Unknown'}</td><td>{source.state}<small>{source.issues.join(', ')}</small></td><td>{formatInteger(source.bytesProcessed)} / {formatInteger(source.fileBytes)}<small>bytes</small></td><td>{source.capabilities.join(' · ') || t('未支援／未識別', 'Unsupported / unidentified')}</td></tr>)}</tbody></table></div></section></>}

        {view === 'quality' && <>{qualitySection === 'collectors' && <CollectorHealthPanel devices={receiver?.devices} language={language} failed={deviceReadError} />}{qualitySection === 'coverage' && <DataQualityPanel api={api} query={query} language={language} />}{qualitySection === 'resources' && status?.resources && <section className="inspector-panel"><div className="inspector-panel-heading"><div><h2>{t('Monitor 自身資源', 'Monitor resource use')}</h2><p>{t('監察程式嘅實際採樣；CPU 以一個核心為 100%，唔係 Agent 用量。', 'Measured monitor process; one CPU core is 100%. These are not agent resources.')}</p></div><span className="inspector-badge">{status.resources.runtimeVersion}</span></div><div className="inspector-context-grid">{[
          { name: 'CPU', value: status.resources.cpuPercent === null ? '—' : `${status.resources.cpuPercent}%` },
          { name: t('程式記憶體 RSS', 'Process RSS'), value: `${(Number(status.resources.processRssBytes) / 1048576).toFixed(1)} MiB` },
          { name: t('索引 Worker Heap', 'Index worker heap'), value: `${(Number(status.resources.workerHeapUsedBytes) / 1048576).toFixed(1)} MiB` },
          { name: t('索引資料庫', 'Index database'), value: status.resources.databaseBytes === null ? '—' : `${(Number(status.resources.databaseBytes) / 1048576).toFixed(1)} MiB` },
          { name: 'SQLite WAL', value: status.resources.walBytes === null ? '—' : `${(Number(status.resources.walBytes) / 1048576).toFixed(1)} MiB` },
        ].map(item => <div className="inspector-resource-item" key={item.name}><span>{item.name}</span><strong>{item.value}</strong></div>)}</div><p className="inspector-footnote">{time(status.resources.measuredAt)} · {t('記憶體唔包括其他 Helper 程式；資料庫數字唔包括保留嘅備份。', 'Memory excludes separate helpers; database size excludes retained backups.')}</p></section>}{qualitySection === 'resources' && !status?.resources && <section className="inspector-panel"><h2>{t('Monitor 自身資源', 'Monitor resource use')}</h2><p role={error ? 'alert' : 'status'}>{error ? t('資源採樣暫時未能讀取；請使用上面嘅重試。', 'Resource measurements are unavailable; use Retry above.') : t('資源採樣讀取中…', 'Loading resource measurements…')}</p></section>}{qualitySection === 'coverage' && <section className="inspector-panel"><div className="inspector-panel-heading"><div><h2>{t('呢啲數字可以信到邊個程度？', 'What does this data establish?')}</h2><p>{t('觀察、推算、估算、未知、有衝突各自顯示。', 'Observed, derived, estimated, unknown and conflicted are distinct.')}</p></div></div><div className="inspector-quality-list"><div><span>{t('用量成員', 'Usage membership')}</span><strong>{summary?.selectedEntries ?? '—'}</strong><button className="inspector-link" onClick={() => changeView('ledger')}>{t('打開帳本', 'Open ledger')}</button></div><div><span>{t('已隔離衝突', 'Quarantined conflicts')}</span><strong>{summary?.quarantinedEntries ?? '—'}</strong><button className="inspector-link" onClick={() => { setShowConflicts(true); changeView('ledger'); }}>{t('檢查衝突', 'Inspect conflicts')}</button></div><div><span>{t('實際模型未識別嘅成員', 'Entries without observed model')}</span><strong>{summary?.modelsUnidentified ?? '—'}</strong><span>{t('Requested model 仍可查看', 'Requested model remains visible')}</span></div><div><span>{t('來源版本／進度', 'Source versions / progress')}</span><strong>{sources.length}</strong><button className="inspector-link" onClick={() => changeView('machines')}>{t('來源能力', 'Source capabilities')}</button></div></div>{summary?.coverageNotes.map(note => <p className="inspector-footnote" key={note}>{note}</p>)}<p className="inspector-footnote">{t('已索引嘅記錄仍唔代表知道所有實際 request。Server 內部 Context 同逐檔案 Cache 分配未能觀察。', 'Indexing discovered records does not establish the complete request population. Server context and per-file cache allocation are unavailable.')}</p>{status?.errors.map(item => <p role="alert" key={item}>{item}</p>)}</section>}</>}

        {view === 'settings' && <section className="inspector-panel"><div className="inspector-panel-heading"><div><h2>{t('設定與資料邊界', 'Preferences & data boundaries')}</h2><p>{t('改動只影響 Monitor；唔會控制 Codex 任務。', 'Monitor preferences do not control Codex tasks.')}</p></div></div><div className="inspector-setting-row"><div><strong>{t('介面語言', 'Interface language')}</strong><small>{t('新分析工作區；原版 Trace 保留既有用語。', 'Inspector workspace; existing traces keep their terminology.')}</small></div><select value={language} onChange={e => { const next = e.target.value as Language; setLanguage(next); localStorage.setItem('inspector.language', next); }}><option value="zh">繁體中文</option><option value="en">English</option></select></div><div className="inspector-setting-row"><div><strong>{t('內容同步', 'Content synchronization')}</strong><small>{t('只限用量、設備、Session／Project 識別。', 'Usage, device and session/project identifiers only.')}</small></div><span>{t('原始內容關閉', 'Raw content off')}</span></div><div className="inspector-setting-row"><div><strong>{t('外部 AI 分析', 'External AI analysis')}</strong><small>{t('核心分析使用本機規則；外部 AI 未啟用。', 'Core analysis uses local rules; external AI is disabled.')}</small></div><span>{t('關閉', 'Off')}</span></div><div className="inspector-setting-row"><div><strong>{t('美元換算狀態', 'USD conversion status')}</strong><small>{t('按目前範圍嘅模型同價目換算；未能定價嘅記錄會另外列出。訂閱額度可喺數據品質查看。', 'Conversion uses model rates in the current scope; unpriced records remain separate. Account quota is available under Data quality.')}</small></div><span aria-label="USD conversion status">{!currentUsd ? t('讀取中…', 'Loading…') : !currentUsd.price ? t('換算未啟用', 'Conversion disabled') : currentUsd.price.mode === 'automatic' ? t('按模型自動換算', 'Automatic model pricing') : t('自訂價目換算', 'User-defined pricing')}{currentUsd && <small>{currentUsd.pricedEntries.toLocaleString()} {t('已換算', 'priced')} · {currentUsd.unpricedEntries.toLocaleString()} {t('未定價', 'unpriced')}</small>}</span></div><p className="inspector-footnote">{t('帳本、來源游標同數據品質資訊存放喺 Monitor 自己嘅 SQLite。原始 Codex 紀錄保持只讀；本機證據預覽會遮蔽常見秘密格式。', 'Ledger, source cursors and quality metadata use monitor-owned SQLite. Codex sources remain read-only; local previews redact common secret patterns.')}</p></section>}
      </div>
    </main>
    {totalExplanation && <TotalExplanationDialog api={api} request={totalExplanation} language={language} currency={currency} onClose={() => setTotalExplanation(undefined)} onEntry={entry => { setTotalExplanation(undefined); setExplainedEntry(entry); }} onTimeline={(id, machineId) => { setTotalExplanation(undefined); setQuery({ machineId, days: 0 }); setTimelineTarget({ evidenceRef: id }); changeView('history'); }} />}
    {explainedEntry && <LedgerExplanationDialog api={api} entry={explainedEntry} language={language} onClose={() => setExplainedEntry(undefined)} onEvidence={id => { setExplainedEntry(undefined); void openEvidence(id); }} onTimeline={id => { setExplainedEntry(undefined); setTimelineTarget({ evidenceRef: id }); changeView('history'); }} />}
    {(evidence || evidenceLoading || metricDetail) && <div className="inspector-dialog-backdrop" onClick={event => { if (event.target === event.currentTarget) closeEvidence(); }}><section ref={evidenceDialog} className="inspector-dialog" role="dialog" aria-modal="true" aria-label={metricDetail ? 'Metric provenance' : 'Source evidence'}><header><div><h2>{metricDetail?.title ?? t('來源證據', 'Source evidence')}</h2><small>{metricDetail ? `${metricDetail.value.provenance} · ${metricDetail.value.origin}` : evidence ? `${evidence.state} · bytes ${evidence.byteStart}–${evidence.byteEnd}` : t('讀取中…', 'Loading…')}</small></div><button className="inspector-icon-button" aria-label="Close evidence" onClick={closeEvidence}><X size={20} /></button></header>{metricDetail ? <div><>{metricDetail.valueLabel && <p>{metricDetail.valueLabel}</p>}<div className="inspector-dialog-number">{metricDetail.displayValue ?? formatInteger(metricDetail.value.value)}</div></>{metricDetail.value.assumptions.map(note => <p key={note}>{note}</p>)}{metricDetail.value.missingReason && <p>{metricDetail.value.missingReason}</p>}{metricDetail.value.sourceRefs.slice(0, 20).map(id => id.startsWith('evidence:') ? <button className="inspector-link" key={id} onClick={() => void openEvidence(id)}>{id.slice(0, 25)} <ArrowRight size={14} /></button> : <small key={id}>{id}</small>)}</div> : evidence?.state === 'available' ? <><pre>{evidence.excerpt}</pre><p className="inspector-footnote">{t('本機只讀預覽，最多 8 KiB；已作秘密格式遮蔽。', 'Local read-only preview, up to 8 KiB, with secret-pattern redaction.')} {evidence.truncated ? t('呢份預覽已截短。', 'This preview is truncated.') : ''}</p></> : <p>{evidenceLoading ? t('讀取中…', 'Loading…') : evidence?.state === 'policy_denied' ? t('呢個 Project 嘅原始內容預覽已被私隱設定限制。', 'Project privacy settings block this source preview.') : t('原始來源已移除、改寫，或者呢段資料未有保留。唔會以目前檔案內容代替舊證據。', 'The original source is missing, changed, or unavailable. Current file content is not substituted for historical evidence.')}</p>}</section></div>}
  </div>;
}
