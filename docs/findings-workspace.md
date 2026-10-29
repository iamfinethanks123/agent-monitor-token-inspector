# 分析與建議：候選優先嘅工作區

2026-10-14。沿用目前已整合功能同深藍／石墨／淺色主題，整理資訊次序及載入時機；唔改 detector、帳本、價目或匯出政策。

## 排版

預設「候選與方案」直接顯示目前可見候選數、證據、其他解釋、品質風險同有界驗證／回退方案。唔再先堆疊重試、跨 Agent 大型比較圖同全部提醒記錄，令候選位置推到多頁之外。

四個入口共用設備／Run／Agent／模型／Project／Provider／tier／日期範圍：

- 候選與方案：預設工作頁。
- 重試進度：原有 attempts／poll／edit／failure change 同證據／Timeline。
- 跨 Agent 比較：原有成對選擇、同步游標、共同操作、用途及刻意覆核標記。
- 異常與提醒：原有歷史 incident、受控更新、意圖及 scoped suppression。

只掛載已選頁；離開跨 Agent／incident 頁即卸載佢哋嘅 changed 訂閱，避免初次打開分析頁便同時執行額外查詢。主 diagnostics 保留來源完整範圍及既有計數／上限；唔按新頁籤縮窄資料人口或隱藏候選。

## 設計及操作

沿用本產品嘅冷色系 token：石墨 base #1b1d25、sidebar #232631、surface #272c39、steel-blue accent #87a6f4、text #e0e8f5；深藍及淺色均用既有 theme variables。標題／內容採用原有字體與有層次嘅字級，冇載入外部 font／圖像。左對齊內容，頁籤以細圖示、文字及選取左線提示；候選數放喺次要位置，唔將數量當效率分數。

原先重複「用量調查」eyebrow 同泛化 journey 標題已刪去，改用實際功能名稱「候選問題與驗證方案」。四個入口係原生 buttons＋aria-pressed，可用標準鍵盤 Tab／Enter／Space操作，focus-visible 清楚。寬度收窄時先改兩欄，再將標題／次要計數改單欄；無自動動畫。

## 已驗證與限制

Build/typecheck/diff check 通過。隔離原生 Electron 流程通過：預設 candidate 頁不存在 comparison／retry mount；四頁切換可見內容正確、退出卸載、selected state 清楚；回候選後有界方案、完整預覽、exact-copy／audit、私隱撤銷後封鎖舊預覽及總數36保持。Clipboard仍只喺隔離 app stub，冇讀寫用戶真實剪貼簿。

原版 agent-comparison／retry smoke入口已改為先選相應新頁，功能驗收內容保留。最終頂部排版截圖 `/tmp/agent-monitor-findings-workspace-smoke.png` 同方案詳情截圖已視覺檢查。呢次未新增低影響樣式 unit tests，亦唔宣稱持續高負載／p95／全平台／全規格已完成。

已簽署私有版安裝到 Mac，八個 packaged files 同 dist 相符；asar SHA256 `bba7e771b61a742f729daf4eb9007f6f67fdd714094d28bb2e3a427fdcfeb116`。真實 AX revision2706有四個入口及22候選、當時未見timeout；但配對截圖仍顯示Overview2705，原生視覺／互動驗收保持未完成。進程仍運行，冇為觀察失敗重啟，亦冇改／停止其他 Electron。已請用戶確認實際可見畫面，未猜原因。

2026-10-14 最新原生跟進：用戶回覆仍見總覽後，直接綁定 installed path 再切頁；AX與截圖一致顯示22個真實候選。更新後版本亦已展開首個方案並建立 revision2792 固定 Markdown 預覽，實際可見。先前差異根因未確認，但目前切頁／內容／預覽已驗證；未保存或複製、未執行方案。
