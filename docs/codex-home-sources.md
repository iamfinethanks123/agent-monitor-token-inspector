# Codex 自訂資料目錄與收集來源

0.1.17修正Collector預設來源同原版Agent Monitor不一致：原版任務圖已跟CODEX_HOME，自家用量Collector之前固定讀使用者目錄下嘅.codex/sessions。現在新建立嘅預設來源、headless run、local及離線匯出都跟目前CODEX_HOME/sessions；未設定時維持原本預設。已直接指向sessions嘅既有相容設定唔會再加多一層sessions。

來源只限sessions子目錄，唔掃Codex home其他檔案。Collector憑證／spool／索引仍由AGENT_MONITOR_CLIENT_STATE或原有專用資料目錄管理，同Codex登入檔案分開。明確傳入嘅來源目錄優先；Desktop已保存、已授權嘅來源清單亦唔會被環境變數自動替換。已有Desktop設定需要改來源時，仍喺設定與私隱新增／停用目錄，唔自動擴大存取範圍。

CODEX_HOME由用戶啟動App／Collector時嘅環境提供，目錄應已存在。呢個修正唔會改系統環境變數，亦唔會自動啟用WSL收集、加入archived_sessions、搜尋其他使用者home或開啟雲端對話內容。

驗證：tests/codexHomeRoots.test.ts用獨立子程序覆蓋自訂目錄（包括空格）、既有sessions相容、明確目錄優先及未設定fallback；原版Graph載入同一個12-token測試Run。測試會先核對預設root，再做scan，避免失敗時讀到真實使用者來源。scripts/smoke-codex-home-collector.mjs直接運行編譯後CLI，分開12-token自訂來源、22-token明確來源及不應匯入嘅其他檔案；不使用網絡、配對或真實登入資料。實際平台發佈狀態見STATE.md。

本輪實機盤點未證明呢個設定差異造成帳戶全部Token差額。WSL預設使用者冇獨立.codex記錄，任務目錄嘅ChatGPT項目亦冇提供可直接加入帳本嘅Token明細；上述資料唔會被當成額外用量。

官方來源：[OpenAI Docs環境變數](https://learn.chatgpt.com/docs/config-file/environment-variables)、[Session記錄位置](https://learn.chatgpt.com/docs/reference/troubleshooting)。
