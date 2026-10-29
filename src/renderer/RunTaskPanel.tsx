import { useEffect, useState } from 'react';
import type { InspectorBridge, RunTaskView } from '../shared/inspector';

const outcomes: Record<string, [string, string]> = { verified_success: ['用戶覆核：驗收成功', 'User reviewed: accepted'], verified_failure: ['用戶覆核：驗收失敗', 'User reviewed: failed'], partial: ['部分完成', 'Partial'], cancelled: ['已取消', 'Cancelled'], unverified: ['未核實', 'Unverified'], setup_failed: ['啟動失敗', 'Setup failed'] };
export function RunTaskPanel({ api, runId, machineId, language, active = true, onOpen, onEvidence }: { api: InspectorBridge; runId: string; machineId?: string; language: 'zh' | 'en'; active?: boolean; onOpen: (contractId?: string) => void; onEvidence: (ref: string) => void }) {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [data, setData] = useState<RunTaskView>(); const [error, setError] = useState('');
  useEffect(() => {
    if (!active) return;
    let alive = true, running = false, pending = false; setData(undefined); setError('');
    const load = async () => { if (running) { pending = true; return; } running = true;
      try { const value = await api.runTask({ runId, machineId }); if (alive) { setData(value); setError(''); } }
      catch (e) { if (alive) setError((e as Error).message); }
      finally { running = false; if (alive && pending) { pending = false; void load(); } }
    };
    void load(); const stop = api.onChanged(() => void load()); return () => { alive = false; stop(); };
  }, [api, runId, machineId, active]);
  return <details className="task-studio-contract" aria-label="Run acceptance and outcomes"><summary><span>{t('任務驗收及結果', 'Task acceptance and outcomes')}</span><small>{data?.contract ? data.trials.length ? `${data.trials.length} ${t('筆目前 Run 試驗', 'trials for this run')}` : t('已設定驗收・結果未核實', 'Contract saved · result unverified') : data ? t('未有任務驗收設定', 'No task contract') : t('讀取中…', 'Loading…')}</small></summary>
    {error && <p role="alert">{error}</p>}
    {data?.contract && <div className="task-studio-contract-fields"><div><strong>{t('目標', 'Objective')}</strong><p>{data.contract.objective}</p></div><div><strong>{t('驗收條件', 'Acceptance criteria')}</strong><p>{data.contract.acceptance}</p></div><div><strong>{t('環境及允許範圍', 'Environment and permitted scope')}</strong><p>{data.contract.environment}</p><p>{data.contract.permittedScope ?? t('允許範圍未記錄', 'Permitted scope unrecorded')}</p></div></div>}
    {data?.trials.slice(0, 5).map(trial => <div className="task-studio-outcome" key={trial.id}><strong>{outcomes[trial.outcome]?.[language === 'zh' ? 0 : 1] ?? trial.outcome}</strong><span>{trial.acceptanceReviewed ? t('有覆核記錄', 'Review recorded') : t('未有驗收覆核', 'Acceptance not reviewed')}</span>{trial.excludedReason && <span>{t('排除：', 'Excluded: ')}{trial.excludedReason}</span>}{trial.evidenceRefs.slice(0, 3).map(ref => <button className="inspector-link" key={ref} onClick={() => onEvidence(ref)}>{t('查看來源證據', 'Inspect evidence')} · {ref.slice(0, 18)}</button>)}</div>)}
    {data && <p className="inspector-footnote">{data.contractCount > 1 ? t(`只顯示最近驗收設定，另有 ${data.contractCount - 1} 份歷史設定。`, `Latest contract shown; ${data.contractCount - 1} historical contracts remain.`) : ''}{t('完成訊息或指令 exit 0 唔會自動當成任務驗收成功。', 'Completion text or exit zero does not establish task acceptance.')}{data.truncated || data.trials.length > 5 ? t('試驗預覽已截短，完整記錄喺驗收頁。', 'Trial preview is bounded; open acceptance for full records.') : ''}</p>}
    <button className="inspector-action-button" onClick={() => onOpen(data?.contract?.id)}>{data?.contract ? t('開啟完整驗收記錄', 'Open acceptance records') : t('設定呢個任務嘅驗收', 'Define acceptance for this task')}</button>
  </details>;
}
