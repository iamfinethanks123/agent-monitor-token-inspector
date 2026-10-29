# 整合規格進度與未完成範圍

目標仍然係完整整合 Agent Monitor、Codex Usage 同指定 Token Inspector 規格，
包括新的介面、分鐘至整日圖表同美元主單位。呢份係工作入口，唔係完成聲明。
檔案存在、單項測試通過或代表畫面成功，都唔代表一整項規格全部驗收。

指定來源：`Agent_Monitor_Codex_Token_Inspector_Spec.md（倉庫副本：docs/spec-reference.md）`。
先前讀取時 pinned SHA-256：
`afe34991f72da8cea0896ca2a0ec2538444f3374fd04e282437301e038bb6480`。
2026-10-14 已成功重新讀取完整原檔，128,468 bytes；SHA-256 同上述 pinned
版本一致。完整內容已保存喺 `spec-reference.md`，作逐項核對來源；原有
`spec-cached-features.md`／`spec-cached-validation.md`／`spec-cached-completion.md`
係功能／案例／完成定義嘅分段入口。重新取得原檔唔代表條文已實作或驗收。

| 規格 | 現有實作入口 | 仍需核對／補齊嘅範圍 |
|---|---|---|
| F01 來源與能力 | Sources、Privacy、原版 discovery、local sample inspector | 完整來源 onboarding／平台能力驗收；一次抽樣唔證明全來源人口 |
| F02 核對帳本 | InspectorStore、Ledger／Total explanation | 已確認 origin/reset/correction 嘅 adapter 證據；完整 F02 逐項驗收 |
| F03 Context 歸因 | ContextAttribution、owned-client manifests | 深層原始／轉換內容及完整 lineage 嘅能力邊界 |
| F04 工具／檔案／Skill 影響 | tool-metadata、tools paging、Context | 全部來源類型同缺少資料嘅條文對照 |
| F05 重讀／重複內容 | deterministic detectors、fingerprints | 意圖、複製歷史同來源覆蓋嘅完整評估 |
| F06 Retry／失敗 | RetryProgress | 完整 acceptance corpus；未知 Task outcome 維持未知 |
| F07 壓縮／Context 增長 | Compactions、Timeline markers | 各平台 lifecycle 覆蓋；無法分開嘅 overhead 維持未知 |
| F08 跨 Agent 重複工作 | AgentComparison | 實際可比較來源群組、意圖覆核同完整覆蓋 |
| F09 Outcome-aware 評估 | Contracts、Trials、Experiments | 完整品質門檻同 outcome/resource 關聯驗收 |
| F10 全歷史／搜尋 | metadata Timeline、investigation layers、經同意本機刪敏片段搜尋 | 大規模及 accessibility 全面驗收；內容按同意／截斷／保留範圍 |
| F11 Budget／Alerts | Budgets、Incidents、feedback、總覽保存發現入口 | 0.1.24保存頁讀取狀態修正；跨來源異常／缺口 cohort 覆蓋及其餘條文對照 |
| F12 有證據嘅建議 | Findings、版本化有界驗證／回退方案、受政策保護嘅預覽／複製 | 完整建議驗收；可選 AI 功能未啟用 |
| F13 Before/after benchmark | Protocols、Trials、local benchmark、逐Pair ID差異及固定版本報告 | 0.1.29有明確參考／比較、逐幣差額及缺失／失敗人口，見paired-comparison.md；完整17.1／M4逐項證據仍需核對。AI runner及原始產物保留按既有同意範圍關閉／條件 |
| F14 多設備 | Mac／Ubuntu／Windows Collector已送達、中央政策／Client receipt | Windows首次4.6GB歷史、長斷線／完整平台驗收；手動重啟保留 |
| F15 Cache／模型／Project／價格 | USD、price snapshots、time charts、model attribution transitions、0.1.25未知排行解釋 | 未知成本／Token排行已接通缺失原因，見unknown-cost-explanations.md；其餘14.2／價目／歸屬條文仍需逐項核對 |
| F16 報告／只讀整合 | frozen JSON／MD／CSV、IPC queries | 完整 export／query 合約驗收；可選外部整合另行核對 |
| F17 私隱／安全／保留 | granular privacy、exclusions、encrypted transport、逐Project文字保留／撤銷、Client政策constraints | 跨平台／全副本界線及完整安全驗收 |
| F18 品質／健康 | 集中品質統計／診斷匯出、Status、capabilities、resource meter | scale／idle／p95／平台及 collector 運作證據 |
| F19 可選 Account | passive quota snapshots、官方累計／每日活動及目前額度明確唯讀按鈕 | 0.1.21已實際讀取多桶額度／Credits／可用reset數，唔執行帳戶寫入；逐筆身份／歷史人口未建立，見account-usage.md、account-limits.md |
| F20 可選 Context manifests | consent/import、owned-client hook | 真實已授權 client inclusion 與跨模式完整驗收 |

原版功能整合另見 `agent-monitor-integration.md`；美元主單位及計價邊界見
`usd-conversion.md`。逐批實際驗證、安裝 hash、可回退版本及證據限制記錄喺
`acceptance.md` 同 `../STATE.md`，較新記錄優先；舊數字唔當成目前實況。

F01 嘅本機 sample inspection 已接通，詳見 `source-samples.md`。F02 入口已能
固定總數／價目快照、分頁查全部成員同來源量測，並逐筆追查 support/control
來源及版本；詳見 `total-explanations.md`。唔會將呢啲功能當成
整個 F02 或全規格完成。Windows 同可選帳戶／內容功能嘅授權邊界保持原定範圍。

F18 嘅解析覆蓋／缺口／結構指紋／來源進度已集中顯示，同時加入 metadata-only 診斷匯出；定義、限額同實際證據见 `data-quality.md`。受控 Benchmark 第一版已由用戶確認為本機測試／驗收指令（可離線）；唔會自動執行未提供嘅真實任務。

2026-10-14：無變更巡查唔再發出 inspector data-change 通知；來源有進度時仍更新。設定頁美元狀態由固定 Unpriced 改成目前範圍嘅實際換算模式及覆蓋，見 `collector-progress.md`。使用入口及實作／條件／關閉能力分類见 `release-notes.md`。

F12 嘅具體方案及 F16 匯出流程已接通，見 `advice-plans.md`。整合回歸 158 通過／4 Windows 專用略過；唔據此宣告全部 T01–T50／平台／resource gate 完成。

2026-10-14 分析查詢改用現有 Timeline 索引；候選相關用量補齊完整範圍／generation，固定範圍診斷有受 DB／私隱版本保護嘅重用。真實 backend snapshot 比較、33 項相關結果及限制見 `diagnostics-performance.md`；唔當成整個高負載／p95 gate 已通過。

介面整理：分析頁預設候選／驗證方案，另外三個調查模式按需要掛載；隔離四頁及原有方案／policy flow通過。實際版入口／視覺證據見 `findings-workspace.md`；原有完整 spec／平台 gate 仍保持。

F01／F18：outer usage envelope 已知但冇支援 Token 欄位嘅 nonempty usage，會明確標示未支援、來源部分能力及樣本原因，唔猜欄位／數字。只改新解析；retained observations及remote health邊界見 `usage-schema-guard.md`。

F14／F18：Collector 健康快照新增固定 metadata-only route，設備及品質頁顯示時效／未支援／缺口；Mac installed／Ubuntu real receipt 已驗證，Windows 手動啟動包已更新未運行。Project policy／pending deletion 會暫停接收，見 `collector-health.md`。目前分析入口及22候選已有一致原生截圖／AX證據；先前差異根因未確認。

F04／F16：Context 與工具新增完整範圍工具排行、調用項目／已捕捉 Bytes／估算／重複副本／失敗及未配對覆蓋、來源證據及固定 JSON／MD／CSV 預覽。17項相關驗證及原生暫停／恢復／匯出回歸通過；資料定義與跨來源人口／成本歸因限制見 `tool-activity.md`。完整平台／來源能力仍需相應證據。

F01／F03／F04／F06／F18：本機真實工具output為typed parts時，原來只處理string導致未量測；新解析支援文字及獨立media計數、部分／未知格式、唯一process／可分配exit狀態。Readonly24筆全部能量測，隔離原生歷史重解析守住原始bytes與12-token帳本；Mac installed、Ubuntu服務及Windows手動包已更新，歷史重解析正等待實際完成結果，見 `tool-output-parts.md`。

F18進度：新解析已在實際歷史發布78個不同來源分析，文字量測增至5,700以上；舊解析已結束，一般scan繼續。新增持久操作摘要／快取progress／跨頁結果／中斷辨識，避免進度觸發整頁重查；隔離驗證及Mac安裝完成，見 `reparse-progress.md`。舊操作完整結果未保留，不從audit反推；實際大型p95及全部平台gate仍未宣告通過。

F01／F02／F06／F18 啟動／resource 修正：首次索引就緒後開放查詢、主資料先於時間圖表、熱查詢直接讀 active membership/payload、保留處理只核對受影響 scopes。實際第一版總覽成功但設定頁仍有逾時，後續分開 queued/started 時限；原有 execution timeout 保留。24項相關＋3項計時回歸及原生隔離 flow通過；完整持續負載／p95 gate 未宣告完成，見 `dashboard-startup.md`。

F04／F16 補齊參數文字量度：支援已記錄function/custom tool字串，參數／返回輸出分開，官方模型生成Output／後續Input／Cache維持不可分配。10項相關檢查、原生工具排行／固定報告／暫停恢復／12-token帳本保持通過，六格版面已目視核對。metadata-only remote wire及旧資料保留；唔自動重解析，見 `tool-arguments.md`。

完整第18–19節重新核對：重新解析新增操作ID核對嘅取消入口，暫存來源唔發布、已發布保留、持久cancelled狀態、重開及正常scan；9項相關檢查及原生20,000事件取消／重啟／重新完成流程通過，見reparse-cancellation.md。完整大型import cancellation及其他backpressure／resource gate仍須逐項核對。完整量化resource targets及M0–M6 gate以spec-reference.md為準，唔以一般未完成字眼代替逐項證據。

F01／F04／F05／F06／F08／F16／F18：工具Call ID嘅來源generation加入身份；Context、Retry、跨Agent及初始工具detector用相同stream边界。原子工具projection重建及失败rollback、cursor失效、JSON／MD／CSV版本provenance已接通。25項相關、最終8項同原生rotation／metadata排行／Context／報告／空閒更新通過；原始觀察、帳本、價目、raw來源保持，見tool-identity.md。

F03／F04／F07／F16 Context工作區改為五個按需載入入口，保留所有原有分析、來源／Timeline及報告，工具明細直接分頁。實際readonly單独tool query約2.8sec；隔離五入口與Context lineage／discrepancy驗證通過；大型實際頁仍需驗證，見context-workspace.md。

F05／F17／F18：受保護指紋新增讀取階段、閉合狀態及非阻塞手動重試；key只留main／private worker、密文不替換、舊分析不寫。4checks/build/native入口通過，實際OS讀取／授權尚待結果，見fingerprint-access.md。

F05啟用證據：用戶手動retry成功、實際native狀態可讀，後續2output＋2argument指紋已出現。先前helper不可用對新收集已恢復；舊人口仍未補寫，無重解析，詳见fingerprint-access.md。

完整核對入口：completion-audit.md。此前202case結果198pass／4Windows-onlyskip／0fail，原版及整合native流程通過。之後本機經同意片段搜尋及中央Client政策已補，另有針對檢查／native／Ubuntu實際receipt證據。24案reviewed synthetic corpus及模式／候選precision／recall報告已補，品質頁及固定JSON／MD／CSV驗證通過，已安裝0.1.3；唔代表production accuracy或完整detector人口。Standalone local Collector嘅定期expiry亦已接通並由實際CLI驗證。原定完整功能及全部gate保持；2026-10-15Windows配對／DPAPI重新讀取／背景運行及Hub送達已確認；正式Collector已SYNCED24903；首次4.6GB歷史及實際畫面一致性仍待結果，見collector-windows.md。


規格18.2／T50進度：Desktop增量掃描storage-full／資料庫readonly／permission固定原因、停止巡查及明確Retry已接通。6相關檢查、隔離native及目視通過；0.1.3已安裝，不能據此宣告所有T50情境完成，見storage-recovery.md。

規格18.2更新負荷：設備心跳／health／政策確認改為獨立通知及輕量唯讀IPC，唔觸發全用量重查。6項相关檢查及隔離真實HTTP／native通過；原有新用量同60秒rolling charts保留。完整資源及實際畫面門檻未完成，見device-activity.md。

F09 Task contract新增獨立permittedScope備註、未知／舊record兼容、所選合約顯示及notes預設排除／明確包含遮蔽。14相關檢查及隔離表單IPC／報告通過；唔授予執行或路徑權限，見task-scope.md。

F10／14.5：Timeline選取新增可存取狀態、polite詳情、明確focus、未選取方向鍵起點；10k真實索引隔離renderer情境first／last／paging／keyboard及10行上限通過，工作集觀察峰值約177MiB。只對應該情境，唔代表全a11y／長期leak，見timeline-accessibility.md。
