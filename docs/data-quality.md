# 資料品質與診斷匯出

入口：數據品質 → 解析覆蓋與資料缺口；下方可建立 JSON／Markdown 診斷預覽，再保存完全相同嘅內容。所有全域範圍條件沿用帳本與 metadata 嘅既有篩選規則。呢個功能唔代表 F18 全部平台／效能 gate 完成。

## 計數定義

- 解析記錄：匹配範圍、仍然保留嘅 normalized envelope；可解析、未支援／未解析、gap、非 gap 嘅語義問題各自顯示。語義問題包括 measurement 嘅用量矛盾。
- 未解析 bytes：只累加 gap 嘅原始 byte span，使用整數文字保留精度；唔包括已解碼但未支援 envelope，唔係 Token。
- 帳本：獨立計算目前 canonical revision 嘅已選／隔離成員、缺少組件欄位，同已選 response 嘅額外支持記錄。Replay 或補充支持唔建立重複計費／浪費，亦唔加返總 Token。
- Unknown kind：adapter 標示未支援、非 gap envelope 嘅不同 kind 數；唔匯出任意 event type 文字。呢個唔保證已知 envelope 內每個可選欄位都被理解。
- 成功時間：最近 supported 且冇 envelope／measurement issues 嘅保留記錄入庫時間；唔係 execution timestamp，唔证明整個來源檔案完整成功。
- 來源 offset／file size／backlog：整個匹配來源，而非篩選後記錄子集。Remote statistics-only 檔案大小／backlog 保持未知；offset 大過目前大小明確標記 size changed。
- 結構指紋：schema fingerprint，並非內容相等指紋。來源包含未支援／語義問題、等候完整行或 collector issue 時標記 partial／能力受限，唔顯示完整已驗證。

## 邊界與效能

一次串流讀取 metadata 計算全範圍統計，獨立 SQL 聚合 canonical 帳本；唔重讀原始 Codex 檔案。明細最多 200 個來源、32 個 schema（按記錄量排序），總計數涵蓋全部匹配資料。頁面卸載會移除訂閱；更改範圍／私隱會丟棄舊結果；更新失敗保留最近有效結果並明確標示。短時間 changed 通知以 10 秒合併，採樣時間可見。

診斷報告只用 metadata，省略 raw prompts、工具內容、程式碼、本機路徑、來源 label、任意 error/type 文字及內容指紋。使用既有 Project 匯出政策、privacy version、5 分鐘固定預覽及保存審計流程。診斷分支唔載入完整逐筆帳本報告，因此唔受嗰個 10,000 成員上限阻擋；明細上限仍明確記錄。任務自由文字及實驗資料唔加入。私隱變動會清除可見／正在等待嘅報告預覽。

## 已取得嘅證據

2026-10-14：三項品質測試加五項既有 report／experiment 回歸，共八項通過；build/typecheck/diff check 通過。覆蓋壞行後正常用量繼續、未知格式／measurement 矛盾、日期排除無時間 gap、scope／empty population、額外支持唔重算用量、匯出無內容 marker／路徑，以及 Project 禁止匯出。

隔離原生 Electron 流程通過：7 retained records、1 gap、1 semantic issue、1 extra support、1 quarantined membership；打開來源／schema 明細、JSON 預覽及保存按鈕，canonical total 維持 24。截圖 `/tmp/agent-monitor-data-quality-smoke.png` 已視覺檢查。

實際 monitor-owned SQLite 使用 readOnly + query_only + 固定 read transaction 核對。優化前 7,681 ms；優化後 revision 2426：72,554 records、504 unsupported/unparsed、213 gaps、171 semantic issue records、232,564,885 gap-span bytes、84 matching sources、76 schemas；品質查詢 1,876 ms，診斷預覽 2,199 ms／72,444 bytes。呢個係單次本機採樣，唔係 p95／idle／跨平台保證；live figures 會變。原始檔案／私隱／帳本政策冇改。
