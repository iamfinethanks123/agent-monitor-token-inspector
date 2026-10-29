# Agent Monitor 原版功能整合檢查

以本機原版 README、docs/usage.md、App、TraceWorkspace、RunTokenDetails 同
TokenUsageCharts 為準，以下功能由新版「任務地圖」使用同一組實際原生來源，
唔係獨立 Demo 頁：

- Codex、Claude Code、Pi、Hermes discovery 同 Provider／Run 選擇。
- Agent 親子圖、節點狀態、增量發現、手動拖動保留、Fit／Root／Active／
  Auto layout、Zoom／Minimap。
- 節點詳情、最近 Trace、刷新、完整 Trace 分頁、Graph 返回／分頁關閉／鍵盤操作。
- 對話卡、Thinking 收合、配對 Tool Input／Result、交錯及未配對結果、搜尋／
  Event Kind／排序、Parent／Subagent 導航、文字複製。
- 原版逐 Agent／逐模型 Token／API Cost、成本分佈、Token Rate 及 Cumulative
  圖表、動畫及 reduced motion。
- 共用新版 Theme；原有重複 Theme 控制移除。

2026-10-13 修補：新版 Codex 帳本 Header 遮住原版 RunTokenDetails 入口。
現時保留「核對帳本」，旁邊增加 **Trace Details**；完整原版細項可再開啟，
明示來源數字，唔會冒充帳本成員總數。OpenAI 原版成本模組共用最新官方價目
快照，其他供應商保留原版來源及日期。

介面整合唔代表四個 Provider 都已有真實本機 Session 或三部設備完整實測。
目前 Collector 核對帳本係 Codex；其他 Provider 原版 Trace／Cost 仍然保留喺
任務地圖。本次以隔離原生測試驗證入口及 By model 分頁，真實 App 另作驗證。

任務地圖搜尋掣亦已接通：喺目前已載入 Run 以名稱、角色、模型、狀態、
Agent／Thread／Session ID 或 Harness 搜尋 Metadata，點選結果會定位節點同
開啟原有詳情。搜尋唔會刪走親子關係或改變帳本總數。首 20 個結果明示上限，
可縮窄查詢；Escape 返回搜尋掣。轉 Run／Provider 或私隱更新會清除搜尋。
原始對話／程式碼全文搜尋仍須另行啟用，唔會由呢個入口自動開啟。

完整 Token Inspector 規格仍未全部完成。docs/acceptance.md 同 STATE.md 保留
Context 深度分析、Live Account 及受控 Benchmark 等剩餘
範圍；唔會因為美元 Dashboard 或原版入口恢復而宣稱全規格完成。
