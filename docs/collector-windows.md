# Windows Collector

第一版保留手動啟動方式，唔會自行建立開機服務。

## 啟動

以下編號步驟適用於既有本機交付包；公開倉庫只保留部分離線腳本及 Collector 原始碼，不包含 1–3 號啟動包。

1. 喺主機開啟 **Agent Monitor Token Inspector**。
2. 準備自己嘅 SSH tunnel 或 HTTPS 連線；如使用既有啟動包，執行 `1-start-tunnel.cmd` 並保持視窗開啟。SSH 位址／使用者需自行設定。
3. 主 App「設備與來源」新增 Windows 設備，匯出有效 10 分鐘、只可使用一次嘅配對設定。
4. 將配對 JSON 拖到 `2-import-pairing.cmd`；長期憑證以 Windows DPAPI 保存。
5. 執行 `3-start-collector.cmd`。主 App 實際收到認證連線及統計後，先算該次連線成功。

原始碼提供 `collector/windows/` 離線輔助腳本及 `src/collector/` 實作。既有本機交付包曾包含 Node 24 runtime；**本公開倉庫不包含該 ZIP、runtime 或預先配對憑證**，亦未提供已驗收嘅 Windows 公眾安裝包。

Collector 讀取該使用者嘅 Codex sessions。只傳用量、模型、設備及 Session／Project 識別資料；原始 Prompt、程式碼、工具輸出及完整路徑不會傳送。配對過期可為同一設備重新匯出，避免重複新增設備。

## 離線交換

先停止 Collector 並保留連線，執行 `4-enable-offline.cmd` 一次。之後可以關閉 tunnel，執行 `5-export-offline.cmd`，按序號由早到晚喺主 App 預覽及確認匯入 `.codexstats.json`。

離線交換檔係簽署統計副本，唔係加密檔案，需以私密方式搬移。待傳 spool 另有加密及 7 日／256 MiB 上限，超限記錄缺口。`6-local-only.cmd` 只喺該台索引，唔連 Dashboard 或讀取配對憑證。

## 驗證範圍

歷史開發記錄曾確認實際 Windows DPAPI 保存／重讀、配對、正式 Collector 接收及斷線重連。完整歷史涵蓋、Windows 原生 Desktop App、長斷線、全部離線交換情境及資源門檻仍未完成驗收。配對成功、收到部分統計及完整歷史收齊係不同狀態。

主 App 同連線通道需要可用；Windows 重開或通道斷線後需手動啟動／重連。接收端維持 loopback，不會因此開放公網端口。

更多內容見 [Collector 同步](collector-sync.md) 及 [離線交換](offline-collector.md)。
