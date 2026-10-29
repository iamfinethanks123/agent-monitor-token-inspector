# 有界改動、驗收及回退方案

入口：分析與建議 → 候選問題 →「改動、驗收與回退方案」。呢個係 F12 deterministic advisor 嘅具體驗證方案，唔係自動優化或 F12／全規格完成聲明。

## 方案內容

每個目前可見候選由本機封閉規則模板生成：

- 只調整一個候選／因素嘅改動範圍。
- 必須保留嘅原有驗收、必要覆核、完整本機證據及可回退版本。
- 固定 baseline／candidate 條件，保留全部嘗試，包括失敗同取消，再按品質門檻比較。
- 驗收失敗、證據或覆核減少、條件不可比或結果無法解釋時嘅回退條件。
- Token／美元節省保持未知；相關用量同重複輸出估算唔係已量測嘅可避免成本。

模板涵蓋 repeated-read、large-output、retry-recurrence、compaction-burst、collector-gap。Gap 方案只比較解析版本／覆蓋／帳本，唔將數據修正叫做節省。Intentional／not relevant／incorrect／resolved 或帶抑制原因嘅候選，會產生 review-only 方案；未知 detector 亦只作調查，唔猜改動。新欄位係 additive optional plan，版本 `bounded-advice/1`；舊 stored finding 無 plan 仍然可讀，現時診斷會生成版本化方案。

## 預覽、複製及保存

「建立方案預覽」重新核對目前 query／finding ID／Project 匯出政策，產生固定 ledger revision 嘅 metadata-only Markdown；JSON 亦可經 structured report 方法取得。專用 advice-plan 分支唔載入完整逐筆帳本，避免因全域帳本超過 10,000 成員而阻止單一方案匯出。

先檢閱，再「複製呢份預覽」或「保存呢份預覽」。複製 handler 只接受已生成 preview ID；主視窗 sender／5 分鐘期限／Project 政策及 privacy version 再核對，並以既有私隱序列化避免競態。內容係同一份 fixed body，之後記錄 report.copy 審計及消耗 preview ID。唔接受任意剪貼簿 body、SQL 或路徑。Scope／意圖／抑制／私隱改動會清除 UI 舊預覽；Append 並唔改寫已固定報告。

原始 Prompt、工具參數／輸出、程式碼、路徑、憑證及內容指紋唔加入方案。報告保留觀察、假設／其他解釋、證據 ID、metadata availability、adapter／accounting／plan 版本及限制。Refs 可以係 detector 已限定嘅子集，唔證明所有原始內容仍可讀。完整 JSON／Markdown finding 報告同 CSV finding 表亦包含方案欄位。

複製只寫本機剪貼簿；唔發送俾任何人，唔執行指令、改 Prompt／檔案、建立試驗或開始 Benchmark。實際改善必須另外經已授權、可比較且通過品質驗收嘅試驗證明。

## 已取得證據

2026-10-14，改動前整合檢查共 162 cases：158 pass、4 Windows-only skip、0 fail。四項 skip 唔算 Windows 已驗證。新功能十一項相關 advice／diagnostics／experiment/report 檢查通過；微調 unknown-template 文案後，三項 focused advice cases 再通過。Build/typecheck/diff 及 smoke script syntax 通過。

隔離原生 Electron UI 流程通過：展開方案、查看回退／未知節省、建立無 raw marker 預覽、固定內容複製及 audit、私隱變更後拒絕舊 preview，canonical total 維持 36。剪貼簿 adapter 只喺呢個隔離 app 換成記憶體 recorder；冇讀取或覆蓋用戶嘅系統剪貼簿。呢個證明 handler／UI／policy flow，唔係真實系統剪貼簿接收端或真實試驗結果。

第一輪 UI fixture 最後一步用錯 bridge 方法名；改用既有 setProjectPrivacy 後完整重跑通過，冇改動真實 Project 政策。最終截圖 `/tmp/agent-monitor-advice-plan-smoke.png` 已視覺檢查。相關記錄：`/tmp/agent-monitor-integration-audit-tests.log`、`/tmp/agent-monitor-advice-plan-tests.log`、`-tests-final.log`、`-build-final.log`、`-smoke-final.log`、`-package.log`。

## 真實資料與運行限制

已安裝版本首先喺真實 Findings 載入 22 個方案。Mac 鎖定後由用戶手動解鎖，沿用同一個 App；collector-gap 方案嘅改動／覆蓋比較／回退／未知節省已展開。其後觀察到 devices／incidents QUERY_TIMEOUT，唔據此聲稱真實預覽已通過。

為減少繁忙索引觸發重複全範圍查詢，Worker 將索引 progress／scan-finish 通知合併至 10 秒一次；初次 scan 仍即時發出完成狀態，停止會清除 timer。資料每輪照常入庫；Receiver、設定、私隱等直接通知保持原流程。冇調高 query timeout 或減少資料／驗收範圍。最終隔離 idle／append UI 檢查會記錄於 acceptance／STATE；真實高負載結果需要另外核對。

最終 coalesced 版本已安裝；八個 packaged files 同 current dist 相符，asar SHA256 `4b3e47857aa47c12e9d0cde3111243084e3bb0c845d67d98c514ff9da43148a6`。修正版一個真實 Findings snapshot 載入 22 個方案，當時未見 QUERY_TIMEOUT；其後原生輸入／捲動觀察仍遇 noWindowsAvailable，進程仍然運行，唔據此重啟。

另用 readOnly／query_only／固定 read transaction 核對真實 monitor-owned SQLite：revision 2582，22 candidate plans；分析 6330 ms，單一方案 Markdown 9985 ms／3195 bytes，包含回退同未量測節省。呢個證明真實資料 backend 方案生成，唔係原生 preview 按鈕／系統剪貼簿驗收或 p95。高負載 query／queue performance 仍未完成；冇保存／分享實際報告或改真實 DB。
