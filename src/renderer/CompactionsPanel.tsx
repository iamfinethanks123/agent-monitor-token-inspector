import type { DiagnosticsView } from '../shared/inspector';
import './CompactionsPanel.css';

function tokens(value: string | null | undefined) { return value == null ? '—' : BigInt(value).toLocaleString('en-US'); }
function time(value: string | null) { return value ? new Date(value).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong', hour12: false }) : '—'; }
function span(value: number | null) { return value === null ? '—' : value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`; }

export function CompactionsPanel({ diagnostics, language, openEvidence, openTimeline }: {
  diagnostics: DiagnosticsView | null; language: 'zh' | 'en'; openEvidence: (id: string) => void; openTimeline: (id: string) => void;
}) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  return <section className="inspector-panel compactions-panel" aria-label="Context compaction analysis">
    <div className="inspector-panel-heading"><div><h2>{t('Context 壓縮與 Input 變化', 'Context compaction and input change')}</h2>
      <p>{t('按明確事件歸組；前後請求 Input 係 Context 大小代理值。', 'Explicit operation groups; nearby request input is a context-size proxy.')}</p></div></div>
    <div className="compaction-metrics">
      <div><span>{t('已完成／明確標記事件組', 'Completed / explicit marker groups')}</span><strong>{diagnostics?.compactionCompleted ?? '—'}</strong><small>{t('開始但未完成：', 'Started without completion: ')}{diagnostics ? diagnostics.compactionCount - diagnostics.compactionCompleted : '—'}</small></div>
      <div><span>{t('來源通知', 'Source notifications')}</span><strong>{diagnostics?.compactionMarkers ?? '—'}</strong><small>{t('同一 Item ID 合併；舊格式相鄰別名係推定。', 'Item IDs merge lifecycle events; adjacent legacy aliases are inferred.')}</small></div>
      <div><span>{t('時間未記錄', 'Timestamp unavailable')}</span><strong>{diagnostics?.compactionUnknownTimes ?? '—'}</strong><small>{t('指定日期唔包含未知時間。', 'Date scopes exclude unknown timestamps.')}</small></div>
    </div>
    <p className="inspector-footnote">{t('Input 下降唔會建立壓縮事件，亦唔會減少帳本總量。額外成本未知；附近回應用量唔當成壓縮成本。', 'Input drops create no compaction event and reduce no ledger total. Overhead is unknown; nearby response usage is not compaction cost.')}</p>
    {!diagnostics?.compactions.length && <p className="inspector-empty">{t('目前範圍未有已索引嘅明確壓縮事件。', 'No indexed explicit compaction events in this scope.')}</p>}
    <div className="compaction-list">{diagnostics?.compactions.map(item => <article key={item.id} className="compaction-card">
      <header><div><strong>{time(item.timestamp)}</strong><small>{item.threadId?.slice(0, 18) ?? t('Agent 未記錄', 'Agent unknown')} · gen {item.generation}</small></div>
        <span className="inspector-badge">{item.state === 'started' ? t('已開始', 'Started') : item.state === 'completed' ? t('已完成', 'Completed') : t('明確標記', 'Explicit marker')}</span></header>
      <div className="compaction-proxy" aria-label="Compaction input proxy"><div><span>{t('壓縮前 Input', 'Pre-compaction input')}</span><b>{tokens(item.before?.input.value)}</b><small>{item.before?.model ?? t('回應未記錄', 'Response unavailable')}</small></div>
        <div className="compaction-change"><span>{t('Input 變化（代理值）', 'Input change (proxy)')}</span><b>{item.inputChange === null ? '—' : `${BigInt(item.inputChange) > 0n ? '+' : ''}${tokens(item.inputChange)}`}</b><small>{t('唔代表節省量', 'Not measured savings')}</small></div>
        <div><span>{t('壓縮後 Input', 'Post-compaction input')}</span><b>{tokens(item.after?.input.value)}</b><small>{item.after?.model ?? t('回應未記錄', 'Response unavailable')}</small></div></div>
      <dl><div><dt>{t('觀察時長', 'Observed duration')}</dt><dd>{span(item.durationMs)}</dd></div><div><dt>{t('距上次事件', 'Since previous event')}</dt><dd>{span(item.intervalMs)}</dd></div>
        <div><dt>{t('通知合併', 'Merged notifications')}</dt><dd>{item.markers}</dd></div><div><dt>{t('觸發／額外用量', 'Trigger / overhead')}</dt><dd>{t('未知／未知', 'Unknown / unknown')}</dd></div></dl>
      {item.issues.includes('LEGACY_ALIAS_LINK_DERIVED_NOT_OPERATION_ID') && <p className="inspector-footnote">{t('舊通知冇 Item ID；按相鄰來源次序及一秒內時間推定係同一次。', 'Legacy markers lack Item IDs; adjacency and timestamps within one second infer an alias.')}</p>}
      {item.issues.includes('NEARBY_MODEL_CHANGED') && <p className="inspector-footnote">{t('前後模型有變；Input 差額唔能夠單獨歸因於壓縮。', 'The model changed; input differences cannot be attributed to compaction alone.')}</p>}
      {item.issues.includes('SOURCE_TIME_ORDER_UNKNOWN') && <p className="inspector-footnote">{t('來源時間次序不一致，時長及前後比較未能完全核實。', 'Source timestamp order is inconsistent; duration and comparison are not fully established.')}</p>}
      <footer><button className="inspector-link" onClick={() => openTimeline(item.evidenceRef)}>Timeline</button>{item.evidenceRefs.slice(0, 5).map((ref, i) => <button key={ref} className="inspector-link" onClick={() => openEvidence(ref)}>{t('事件證據', 'Event evidence')} {i + 1}</button>)}
        {item.before?.input.sourceRefs[0] && <button className="inspector-link" onClick={() => openEvidence(item.before!.input.sourceRefs[0])}>{t('前 Input 證據', 'Pre-input evidence')}</button>}
        {item.after?.input.sourceRefs[0] && <button className="inspector-link" onClick={() => openEvidence(item.after!.input.sourceRefs[0])}>{t('後 Input 證據', 'Post-input evidence')}</button>}</footer>
    </article>)}</div>
    {diagnostics && diagnostics.compactionCount > diagnostics.compactions.length && <p className="inspector-footnote">{t('顯示最近 200 個事件組；上方計數涵蓋全部符合範圍嘅已保留事件。', 'The latest 200 groups are shown; counts cover all retained matching operations.')}</p>}
    <p className="inspector-footnote">{t('現有遠端 Collector 只傳統計，未傳壓縮生命週期；舊索引嘅新格式通知需要重新分析先可識別 Item ID。', 'Current remote collectors send statistics without compaction lifecycle. Older indexed lifecycle notifications require reanalysis to identify their Item IDs.')}</p>
  </section>;
}
