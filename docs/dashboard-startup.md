# Dashboard 啟動及查詢排隊

2026-10-14，針對實際 `QUERY_TIMEOUT` 嘅修正。

保存帳本／工具projection完成初始化後，主程序先開放讀取；首次來源掃描喺背景繼續，畫面以正在索引表示未追上。保留原有120秒初始化上限。先前曾等待整次首次掃描，但實際大型來源超時，呢個策略已由最後有效read model優先取代。總覽主資料載入後先掛載細時間圖表，避免同啟動查詢互相排隊。總覽、Analytics、USD 同時間圖表直接讀目前帳本 membership／payload，再套用該筆 revision，避免每次讀取都喺 SQLite 重寫完整 JSON。範圍、Token 數、快取／Reasoning 子項及價目計法維持。

保留期限巡查只核對今次真正過期嘅 scopes；冇過期觀察時唔執行全帳本刪除輔助流程。獨立 Context／annotation 到期處理仍然執行。唔會喺呢個流程提前消耗其他待處理 Collector scopes。

主程序原本由送出請求開始計 15 秒；單一 worker 前面嘅工作可以用盡後面簡單查詢嘅時間。現在 worker 開始處理每項請求時先發出 metadata-only `started` 訊息，主程序分開計時：排隊最多 60 秒（`QUERY_QUEUE_TIMEOUT`），實際查詢沿用原有 15 秒／60 秒／重新解析 10 分鐘（`QUERY_TIMEOUT`）。重複開始訊息唔延長時限；逾時後嘅回覆唔當成功；128 項容量限制及 worker 結束時拒絕請求保留。進度通知同快取重新解析狀態唔受呢個回應路徑影響。

24 項相關帳本／privacy／USD／圖表測試通過。三項計時回歸直接載入實際 InspectorService，替換 worker 邊界及時鐘，覆蓋 20 項排隊查詢、執行逾時／遲到回覆、排隊上限／worker 結束。建置及原生隔離 fixture 通過，包含零空閒更新通知、新增資料由 12 增至 24 Tokens、設定頁實際定價覆蓋。

實際第一版啟動修正已載入總覽／時間圖表，revision 3226 顯示 $1,025.73 API 等值成本、2,137,769,051 Tokens、9,247 已換算／142 未定價，Mac／Ubuntu 有資料，Windows 未收到統計。但切到設定頁仍出現 prices／privacy／experiments 查詢逾時，促成上述分開計時修正。唔據單一畫面宣告持續負載效能、p95、完整規格或所有平台驗收完成。

工程量測只對保護嘅臨時 metadata DB 副本執行，實際 DB read-only，冇原始對話／憑證複製；副本已清除。某次量測有極端牆鐘停頓，未確認係暫停或負載，唔據此聲稱可靠效能數值。原始 Codex 檔案、帳戶、價目、配對憑證及用戶 privacy 設定冇因呢次修正而修改。

最終排隊修正版已安裝；實際設定頁截圖同 AX 一致，prices／privacy／experiments 已載入，檢查畫面冇 QUERY_TIMEOUT／QUERY_QUEUE_TIMEOUT／INDEX_STARTUP_TIMEOUT。自動模型換算顯示9,269已定價／142未定價，美元估算小計$1,026.14931（該筆view revision3237）。呢個係目前畫面驗證，唔係持續負載／p95 保證。

首次等待超過120秒後，舊Promise已拒絕，稍後完成亦唔會恢復查詢。新修正獨立記錄worker是否已完成初始化；遲到ready後新查詢可恢復，worker終止後直接回傳終止原因。120秒初始化上限及原有查詢時限保留；4項實際service計時檢查通過。唔據此宣稱大型首次索引已達效能target。
