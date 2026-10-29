# 離線統計交換與本機模式

已配對嘅 Windows／Ubuntu Collector 可以匯出 `.codexstats.json`，喺 Mac
「設備與來源 → 離線統計交換」選擇檔案。Dashboard 會核對已登記設備嘅
Ed25519 簽署，顯示設備、批次、事件、序號、重播數同已報告回應小計；確認後
先匯入。回應小計唔係預測帳本增加量：Counter、重播同衝突仍然由原有核對政策
處理，唔會把累計總量再加一次。

首次啟用需要一次既有配對連線。Collector 用系統保護儲存保存私鑰，接收端只
保存公鑰。舊設備先停止 Collector，再運行 `enable-offline`；新版配對會自動
準備簽署。私鑰、Token 同 Fingerprint Key 唔會加入匯出檔案。Windows 用 DPAPI，
Ubuntu 用既有 systemd encrypted credential；毋須另開公網端口。

停止 Collector 後可以離線運行 `export-offline <輸出資料夾>`。現有加密佇列保留，
匯出唔會當成接收端 ACK。大佇列會分成多個受限大小檔案，按檔名序號由早到晚
逐份匯入。Mac 每個檔案最多 16 MiB，預覽有效五分鐘；確認前會再檢查設備有冇
撤銷、簽署同序號有冇改變。

匯出檔案係簽署嘅統計副本，並非加密檔案；雖然冇原始文字，設備／Session
識別及用量仍然可能敏感。請用你選擇嘅私密儲存／傳送方式搬移。軟件唔會自行
上載檔案。原始 Codex logs 保持只讀。

離線檔案沿用線上批次嘅原始 ID、事件及序號，重複匯入或之後連線重播唔會
再次加進帳本。接收端只喺持久化後確認批次；中斷時已完成批次可安全重試。
有簽署嘅佇列缺口會獨立保存，已刪除來源嘅排除仍然生效。已過期／被缺口
取代而未曾收到嘅舊序號，可能無法再按普通批次匯入；唔會假裝資料已恢復。

Client 佇列會喺下次認證連線讀到 ACK 後清理；離線匯入結果唔會作為未認證嘅
Client 清理指令。佇列仍有七日／256 MiB 上限，超限會留下明確缺口。Dashboard
把最近收到資料同最近認證連線分開，收到離線檔案唔會令 Collector 顯示在線。

Windows 包新增：

- `4-enable-offline.cmd`：初次登記簽署；先關閉 3 號 Collector 視窗，保持 Tunnel。
- `5-export-offline.cmd`：停止 Collector 後離線匯出；預設存喺包旁嘅 `offline-exports`。
- `6-local-only.cmd`：只喺當台索引，唔連 Dashboard，亦唔讀配對憑證。

`local [已授權來源目錄] [--once]` 可以喺無 Electron、無配對、無憑證嘅 Node
環境索引，資料留喺獨立 `local-index.sqlite`。Client state lock 避免同時開兩個
寫入程序；如果提示 Collector 正在運行，請先關閉現有程序。

每次本機scan之前會套用既有事件／用量retention。過期記錄有retention floor，
再次讀取同一來源唔會恢復；之後新記錄仍可索引，原始logs保持不變。實際CLI
子程序已驗證清理／再讀／新增流程，唔依賴連線或配對憑證。

Ubuntu 首次啟用要喺服務外執行，因為服務保留 `NoNewPrivileges` 保護。停止
`agent-monitor-collector.service` 後，用同一個 state 目錄運行 `enable-offline`，再
啟動服務；唔需要放寬服務權限。啟用只更新 Monitor 自己嘅系統保護憑證。

目前證據：合成資料測試涵蓋簽署改動、其他工作區、未知公鑰、撤銷、來源排除、
缺口、重啟、部分匯入同線上重播；原生隔離驗證涵蓋先預覽再確認、預覽唔改
帳本及確認後嘅正確小計。本機 Node 模式亦用獨立來源／狀態目錄驗證。Windows
實機 DPAPI 同手動搬檔仍然需要喺該設備執行，唔會由本機測試推斷已成功。
