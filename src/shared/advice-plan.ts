import type { FindingView } from './inspector';
export interface AdviceText { zh: string; en: string; }
export interface AdvicePlan { version: 'bounded-advice/1'; state: 'candidate' | 'review_only'; boundedChange: AdviceText; preserve: AdviceText; comparison: AdviceText; rollback: AdviceText; impact: 'unknown'; }
const text=(zh:string,en:string):AdviceText=>({zh,en});
/** Closed, local templates. No trace text becomes executable instructions. */
export function advicePlan(finding: Pick<FindingView,'detectorId'|'annotation'|'suppressionReasons'>): AdvicePlan {
  const reviewOnly=finding.suppressionReasons.length>0||['intentional','not_relevant','incorrect','resolved'].includes(finding.annotation??'');
  let change:AdviceText;
  switch(finding.detectorId) {
    case 'repeated-read': change=text('只對一個已核對嘅重讀候選，比較保留首次結果／證據索引同縮窄後續讀取範圍；唔刪改動後或獨立覆核所需嘅讀取。','For one reviewed repeated-read candidate, compare retaining the first result/evidence reference and narrowing later reads. Keep post-change and independent verification.');break;
    case 'large-output': change=text('只改一個工具結果嘅呈現：完整輸出保留本機，傳入摘要及必要錯誤／驗收內容；唔改測試本身。','Change presentation for one tool result: retain the complete local output and supply a summary plus required errors/acceptance evidence. Keep the tests unchanged.');break;
    case 'retry-recurrence': change=text('先對一個相近失敗循環核對根因／環境，下一步只做一次有目標嘅診斷或修正，再執行原有驗收；唔減少測試覆蓋。','Review cause/environment for one recurring-failure episode; try one targeted diagnostic or fix, then run the original acceptance checks without reducing coverage.');break;
    case 'compaction-burst': change=text('對一個已核對嘅工作階段，比較明確任務邊界及保留必要證據嘅交接摘要；唔假設壓縮一定有問題。','For one reviewed task segment, compare explicit task boundaries and a handoff preserving required evidence. Do not assume compaction is defective.');break;
    case 'collector-gap': change=text('只對涉及缺口嘅來源做本機格式抽樣；確認 adapter 支援後，才用 Monitor 重解析建立新分析版本。唔修改原始記錄。','Inspect one affected source locally. After confirming adapter compatibility, use monitor reparse to publish a new analysis revision; keep original records unchanged.');break;
    default: change=text('先核對候選證據、適用範圍同驗收條件；未有相符模板，暫時只作調查。','Review candidate evidence, scope and acceptance first. No matching template is available; investigate only.');
  }
  const state=reviewOnly||!['repeated-read','large-output','retry-recurrence','compaction-burst','collector-gap'].includes(finding.detectorId)?'review_only':'candidate';
  return {version:'bounded-advice/1',state,boundedChange:reviewOnly?text('先核對抑制／意圖標記同證據；保留目前行為，未重新確認可處理之前唔執行優化改動。','Review suppression/intent annotations and evidence; preserve current behavior until actionability is confirmed again.'):change,
    preserve:text('保留原有驗收、必要覆核、完整本機證據及可回退版本。唔新增權限，唔自動控制 Codex。','Keep original acceptance, required review, complete local evidence and a recoverable version. Do not expand permissions or control Codex automatically.'),
    comparison:finding.detectorId==='collector-gap'?text('比較重解析前後嘅版本、缺口、來源覆蓋及帳本成員；總數改變要由保留證據解釋，唔當成節省。','Compare parser revisions, gaps, source coverage and ledger membership. Explain changed totals from retained evidence; do not call them savings.'):text('先固定任務／輸入／專案版本、環境同驗收；一次只改一個因素，保留 baseline 及候選嘅全部嘗試，包括失敗／取消。只有驗收通過且條件可比較，才比較已量測 Token／美元／時間。','Freeze task, input/repository revision, environment and acceptance. Change one factor; retain all baseline/candidate attempts, including failures/cancellations. Compare measured tokens/USD/time only after acceptance passes under comparable conditions.'),
    rollback:text('如果驗收失敗、必要證據或覆核減少、條件唔可比較，或者結果未能由證據解釋，就恢復原有流程／可回退版本，唔宣稱改善。','Restore the original workflow/recoverable version if acceptance fails, required evidence/review is lost, conditions are incomparable or results cannot be explained. Do not claim improvement.'),impact:'unknown'};
}
