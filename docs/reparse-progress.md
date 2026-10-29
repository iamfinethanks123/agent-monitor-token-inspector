# 歷史重新解析進度與結果

2026-10-14，F18：原有重新解析回覆係一個長IPC request。切離設定頁會失去該頁結果；讀取或等待逾時唔等於背景操作停止。實際大型歷史解析期間亦會因progress觸發整頁重查，加重查詢負擔。

## 改動

Worker保留單一操作識別、開始／更新／結束時間、來源人口、已發布／未能核對來源數、帳本版本及閉合錯誤碼。Metadata-only摘要存Monitor settings，冇來源IDs、路徑、內容或憑證。呢個係過去操作記錄，唔係目前模型／Project範圍嘅來源人口。

專用progress channel送到主程序快取。讀取呢份狀態唔排入忙碌Worker嘅查詢佇列；Progress亦唔觸發全部頁面資料重查。既有scan progress／receiver變更在重解析期間合併，完成／失敗後各頁刷新一次。主畫面可見進度，設定頁保留上次結果，切頁後仍可讀。

既有reindex合約及durable分析發布流程保持；同一Worker並行reindex等候同一操作，唔另開副本。長request即使逾時，快取progress仍可辨識running。設定頁來源／保留／Project改動在running時暫停，避免重複操作。重新開App若最後狀態仍running，就明示interrupted／PROCESS_RESTARTED，保留部分計數及既有有效分析，唔偽裝完成。無法驗證、未知版本或不完整completed record顯示無可採用結果。

## 驗證與限制

9項相關檢查通過：中斷恢復、完成人口一致性、無額外私密欄位、未知狀態、來源成功／不可用進度、既有parts與privacy reparse。隔離原生App驗證初始未完成操作恢復為interrupted；真正重解析2個fixture來源，其中1個發布／1個來源檔案不可用。Progress與完整data-change通知分開，結果跨切頁／重啟保留，帳本24 tokens保持。

這一輪工具parts真實更新：Mac新資料30／30個工具輸出有文字量測；历史audit確認78個不同來源有新分析，文字量測大幅增至5,700以上。最後來源發布在香港時間15:34:04，之後一般本機掃描仍收新資料（16:18:41），證明舊reparse已退出阻擋scan嘅狀態。升級前操作冇完整持久化摘要，唔由audit數反推每次成功／未能核對結果。程序PID曾由14910變19361；原因未確認，未為觀察失敗而主動重啟。

短CPU抽樣只見V8／Buffer／SQLite iterator活動，唔足以指定全部逾時根因。新改動減少可確認嘅重查觸發，唔宣稱大型來源p95／完整資源gate已通過。實際新tracker安裝結果另記acceptance。Logs：`/tmp/agent-monitor-reparse-state-tests.log`、`-final-build.log`、`-native-final.log`。
