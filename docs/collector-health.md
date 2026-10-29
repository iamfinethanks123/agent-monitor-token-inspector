# 多設備 Collector 健康快照

2026-10-14，F14／F18：中央「設備與來源」及「數據品質」新增 Collector 解析健康。Client 自報、設備層級，唔係完整模型請求清單或供應商帳單。

## 資料及接收

Client 每輪既有同步成功後，沿用裝置 bearer 認證，向可選 `/v2/collector-health` 傳送 `collector-health/1`。只接受固定欄位：採樣時間、adapter 版本、來源／部分來源／讀取錯誤數、保留記錄／未支援／缺口／語義問題數、未解析 Bytes、最近成功入庫時間。冇 Prompt、工具內容、路徑、自由文字或 Session／Project 識別資料。

接收端只保留每設備最新快照，附上本機收到時間及 `client_reported` 來源。唔產生用量、唔推進 sequence ACK、唔改 wire-v2 usage 格式。原有 authenticated heartbeat 同時更新網絡聯絡時間，避免冇新增用量時仍被顯示離線。

三分鐘前收到／revoked 嘅資料顯示較舊，冇快照顯示未收到，唔當成健康或零。缺口包含喺未支援記錄內，兩者唔可相加。Sender 時鐘可能唔同，時效依中央收到時間。模型／日期篩選唔會改呢份設備快照。

舊 Receiver 回覆 `UNSUPPORTED_METHOD` 時，新 Client 停用本次程序嘅可選健康上報，原有統計同步繼續。其他健康上報錯誤只記錄閉合錯誤碼，唔阻斷已成功嘅用量同步。

## 私隱邊界

Project 私隱／保留／刪除變更會清除快照。未完成來源刪除同步，或工作區有任何 excluded Project／特定 metadataDays 或 usageDays policy 時，接收端暫停健康快照。設備總量冇每 Project 證據，暫時無法證明 Client aggregate 已套用中央規則；所以保守顯示未收到，唔保留舊總量。呢個限制唔會改現有用量同步政策。

## 驗證

12 項 health／transport／Project privacy 檢查通過：authenticated receipt、錯誤 workspace／多餘欄位拒絕、計數範圍、撤銷、私隱失效及 retention 暫停；sender fixture 未支援／缺口保留且無原始 marker／路徑／識別資料。原生隔離 App 驗證設備及品質頁新面板、最近／較舊／未收到區分，12 Token 帳本及 ACK 保持。

測試紀錄：`/tmp/agent-monitor-collector-health-final-tests.log`、`-final-build.log`、`-native.log`。部署與真實接收結果另記 acceptance；Windows 仍按使用者要求保留手動啟動，未有實機接收證據。
