# 未支援 Token 欄位格式

2026-10-14，F01／F18 格式能力核對修正。既有 native field mapping、adapter family codex-passive/1、canonical accounting policy／wire-v2 保持；唔新增或猜供應商欄位。

## 行為

`token_usage_record`／compatible token-count envelope 提供 nonempty usage，但冇任何目前支援嘅 Token 欄位時，之前已唔會產生用量 measurement，卻仍可能因 outer type 已知而標成 supported。

而家會記錄閉合原因 `UNSUPPORTED_USAGE_FIELDS`。全個 envelope 冇可採用 measurement 時標為 unsupported；若同一 envelope 另有可採用控制 measurement，保留嗰部分，但來源仍有格式問題。未知欄位形狀以 kind／key 結構 hash 區分，唔保存或匯出實際 key 名／內容。未知欄位名唔會被 alias 到 input/output。

- 已知 Input／Output／Cache／Reasoning 欄位沿用原有算術及 null-presence。
- Missing／null／empty usage 唔當成 schema 升級或零成本；維持未有量測。
- Recognition 只係 envelope／已支援欄位能力；唔聲稱全部 unknown optional fields 都被理解。
- Collector 來源 issue 會令 Sources 顯示 partial；Data quality 的 unsupported／semantic issue／capability limited 可見。
- 樣本檢查會直接解釋「已提供用量資料，但欄位格式未支援；唔會猜 Token 數或當成零」。Valid 後續 records照常處理。

## 已有資料及多設備邊界

原始記錄及既有 immutable observations 唔會自動重寫；新的 collection／explicit sample 使用新 guard。想對舊來源套用新解析，需要已提供嘅 deterministic reparse，會建立新分析版本。唔為此自動重解析真實記錄、重設金鑰或部署其他設備。

Shared collector bundle 亦包含 guard，但現有 VPS／Windows 包冇喺呢輪重新部署；使用者確認 Windows 保留手動啟動而目前未運行。Wire-v2 statistics-only sync 只傳可採用 measurements，未支援 empty-measurement envelope／envelope issue 唔會自動成為遠端 health record。中央 Dashboard 唔會因此聲稱已知道遠端所有 unknown shapes；remote health capability 仍需相應 protocol／client 證據。

## 已驗證

先重現 outer recognized／Source current 錯誤，再修正。21 項 usage-schema／accounting／sample／quality 檢查通過。覆蓋 renamed-only／alternate unsupported keys fingerprint 不同、no guessed measurements、缺少／empty／known partial fields、壞格式前後有效回應總數保持24、source partial／sample原因／metadata無私密 marker。

隔離 native Data quality 流程通過：8 records／1 gap／2 semantic issue records，回應追加支持／quarantine同原有總數保持。Local sample chooser先驗證正常樣本及clear/cancel，再驗證 renamed-only 樣本嘅中文警告，冇匯入獨立 sample或修改12-token ledger。新 sample case第一輪忘記重設已選 unknown-file dialog stub，修正 fixture 後重跑通過；屬於測試設定問題。

Build/typecheck/diff／scripts syntax通過。呢啲係 fixture／隔離 UI 證據，唔係 upstream 新版 compatibility、真實 remote 健康告警或原生截圖差異已解決。Logs `/tmp/agent-monitor-usage-schema-red.log`、`-final-tests.log`、`-final-build.log`、`-sample-smoke-final.log`、`-quality-smoke.log`。

後續更新（2026-10-14）：新固定 `collector-health/1` route 已完成並部署 Mac／Ubuntu，Windows 手動包同步更新。中央可見 sender unsupported／gap／semantic issue aggregate，但無 raw shapes 或完整请求人口；前段描述保留作當時驗證邊界，現況以 `collector-health.md` 及 acceptance 最後段為準。
