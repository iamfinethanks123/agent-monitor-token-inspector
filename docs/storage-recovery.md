# 本機索引儲存失敗與恢復

規格18.2要求儲存空間／權限錯誤有可處理提示，唔密集重試。Desktop worker
而家識別Node檔案ENOSPC及已使用SQLite binding嘅FULL／READONLY／PERM代碼，
將本機索引標示為degraded，保存固定原因及發現時間，停止兩秒自動巡查。
狀態只包含固定代碼，唔加入原始error message、trace內容或路徑。

儲存commit失敗會傳回worker，唔被包裝成普通來源讀取警告。已提交觀察、
原有游標及最近有效帳本保持；未提交批次唔會當作完成。其他暫時錯誤維持
原有degraded及巡查策略，來源目錄讀取權限警告亦維持逐來源處理。

全部Dashboard頁面顯示同一個「本機索引已暫停」提示，指明需要釋放空間或
檢查資料庫儲存位置／寫入權限。處理後可按「重試索引」或頂部Refresh；
手動重試仍失敗會再次暫停，成功先恢復自動巡查。呢個操作唔會重解析歷史、
刪除原始Codex檔案、改私隱同意或重設任何憑證。

6項相關檢查通過：真正SQLite限制產生FULL／read-only連線產生權限錯誤、
storage commit失敗時游標同12-token帳本不變、重讀後24-token核對、worker
在超過巡查週期後仍只試一次、手動恢復及原有idle／append／空來源行為。
worker失敗注入只喺測試bundle替换Collector；冇production fixture開關。

隔離Electron介面核對storage-full／write-permission兩種提示、跨頁、明確
Retry IPC及恢复清除，12-token總數保持。截圖
`/tmp/agent-monitor-storage-pause-native.png`已目視檢查；唔代表用戶磁碟曾被
刻意填滿，亦唔係用戶App當下故障截圖。

呢批涵蓋Desktop增量掃描失敗／手動恢復。首次資料庫開啟、全部crash／
migration／corruption、headless服務重啟政策及所有T50情境仍需要各自證據，
唔據此宣告完整T50或平台驗收完成。

0.1.3已安裝及codesign deep／strict核對；8個runtime files與build一致。Windows、
Ubuntu在重開接收端後有新認證連線。用戶Mac仍鎖屏，實際原生畫面待解鎖；
冇刻意填滿用戶磁碟、改實際檔案權限或制造資料庫錯誤作驗證。
