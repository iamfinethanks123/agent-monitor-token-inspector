# 分析查詢、範圍及重用

2026-10-14 修正。目標係減少真實 Findings／方案報告等待，同時保持範圍、版本及私隱一致；唔係全規格／高負載 p95 驗收完成聲明。

## 改動

- Message／gap 分析沿用 schema-11 已有 `timeline_events` kind 索引，避免逐次掃描所有 observation body。使用目前分析版本嘅 kind，原始 observation 保持不變；唔新增索引、資料庫 migration 或 wire 格式。
- 候選相關用量加入同 canonical ledger 一致嘅模型／Provider／tier／Project／日期／Agent 範圍條件。Source ranges 以 source＋generation 分開，interval endpoints 亦必須同源同代次。第一個回歸先重現錯誤：model-a 帳本 36 tokens，但候選混入 model-b，顯示 342；修正後兩者係 36，全帳本仍然係 342。
- 相關 ledger 查詢直接用目前 membership＋immutable payload，唔重複 join reduced ledger view，並喺一次分析內重用同一個 prepared statement。
- 固定範圍可重用已算好嘅 metadata 診斷，最多四個範圍／store。Query keys 明確正規排序，省略及 explicit default limit 均一致。Cache 回傳 detached clone，caller 修改唔會污染下一次結果。
- SQLite `data_version`＋exact-text `total_changes()` 包括本 connection 同其他 connection 嘅變更；變更即作 cache miss。私隱 version 變更主動刪除 cache。滾動 `days` 範圍每次重算，唔快取時鐘相關結果。原始 Source 檔案及內容唔加入 cache。
- Report project-policy population 改從目前 retained Timeline 嘅 project metadata 取得，避免讀每筆 normalized JSON；仍保留原有 source-scope 及 mixed-source 政策，唔使用已刪除記錄嘅歷史 project links 去擴大阻擋範圍。

## 已驗證

33 項 diagnostics/cache/scope/compaction/alert/advice/privacy/project-privacy 檢查通過，build/typecheck/diff 同隔離 native advice flow 通過。覆蓋 observed model、source generation、reparse kind、caller mutation、自己／其他 SQLite connection 改標記、rolling date 重算、私隱／匯出封鎖。Native copy flow 仍只喺隔離 app 用 memory clipboard adapter，冇觸及用戶系統剪貼簿。

一次相關 suite 曾出現既有 historical-alert 分類 assertion 失敗；該案例獨立重現及整個相關 suite 重跑均通過。未證實根因；rolling-window test 改用查詢重算證據，避免全域 Date.now mock。唔將單次重跑綠色當成該間歇問題已修復。

真實 readonly/query_only 固定 SQLite snapshot revision 2652：22 findings。Legacy／indexed project-policy population 完全相同，2820 ms 對 890 ms；首次分析 4276 ms，重複 fixed-scope 分析 1 ms，方案報告 1081 ms／3204 bytes；兩次診斷序列化完全相同。初步 standalone profiling 亦顯示負載會令不同 sample 由約 2 秒至約 5 秒波動，因此唔將跨 revision／不同負載時間宣稱為純 code speedup。

以上係單次 backend snapshot，唔係持續高負載／整個原生 UI／p95 保證。新資料仍會重新分析；busy-source queue 同完整平台驗收需要相應實際證據。Logs：`/tmp/agent-monitor-diagnostics-profile-before.log`、`-profile-after.log`、`-policy-final-tests.log`、`-policy-final-build.log`、`-policy-final-smoke.log`。

私有 signed 更新已安裝，八個 packaged files 同 current dist 相符；asar SHA256 `e49d24d6d712646bea091d799a1fb0e26f5026a7e74b94ab56371785fbc3c7f8`，可回退 `release-inspector/before-diagnostics-query-20261014`。真實 Native Overview 2672/2673、Findings 2675 載入 22 個方案，檢查嗰刻未見 QUERY_TIMEOUT，且 collector-gap 回退／預覽控制已展開。原生 input 未確認觸發 actual preview，唔宣稱實機 copy/save／持續高負載逾時已全面解決。
