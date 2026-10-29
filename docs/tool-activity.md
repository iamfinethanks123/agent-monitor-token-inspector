# 工具輸出與操作排行

2026-10-14，F04／F16：Context 與工具新增完整範圍工具彙總，同 metadata-only JSON／Markdown／CSV 預覽。既有逐筆工具分頁、Context、Compaction 同帳本保持。

## 定義

- 按保留記錄嘅工具名稱及操作類型分組，保留原有 namespace 字串，唔推測工具或 Skill 標籤。
- 調用項目係 tool index 中有 input observation 嘅識別。Output-only 項目另外列入工具識別及未配對數，唔假設有已觀察到嘅調用。呢個唔係跨来源去重後嘅實際執行人口。
- 已捕捉 output bytes、逐段 UTF-8 bytes÷4 估算同帳本 Token 獨立。截斷結果只計已捕捉部分，唔補原始完整長度；後續 request input、參數生成 Token、逐工具 Cache 同美元成本仍未知。
- 衝突輸出排除小計。冇 output 唔當成零長度；冇量測／指紋／時間嘅部分列明覆蓋數，全部缺少時顯示未知。
- 重複係同組工具嘅 keyed output fingerprint 再次出現；列出額外捕捉副本及 bytes。唔代表浪費、同版本完整檔案、後續重複納入或可節省成本。截斷副本仍只比較已捕捉範圍。
- 時長只加已配對並有有效起訖時間嘅非衝突項目；唔係任務 wall-clock time。

總數扫描全部符合目前設備／Run／Agent／模型／Project／Provider／服務級別／時間範圍嘅工具識別，唔受逐筆200列分頁限制。排行只顯示首20組，明示組數；每組最多5個來源證據引用。對應帳本 revision 同 observation watermark 分開保留。新面板遵循暫停／恢復更新，私隱變更會清除旧資料。

## 匯出

沿用 ReportPanel 固定預覽、五分鐘有效、Project export policy、保存及 audit 流程。新 report branch 唔需要載入全部帳本成員，因此工具摘要唔會被10,000筆帳本匯出上限擋住。CSV 保留 aggregate 同首20組、兩個版本、覆蓋及限制，文字 cells 防止公式執行；JSON／Markdown 保存 adapter／policy／估算版本及明示界線。無原始 arguments、輸出、路徑、fingerprint 或金鑰。

## 已驗證

17 項工具／diagnostics／Context／Project privacy 檢查通過。包含超過200筆、模型／Run／時間篩選、23組顯示20組但總數完整、截斷、失敗／未配對、衝突、未知指紋、超過安全整數嘅精確 bytes、JSON／Markdown／CSV 及 Project 匯出拒絕。

隔離原生流程：207調用／208工具識別、419,853已捕捉 bytes、104,964估算 tokens、417,792再次捕捉 bytes；原帳本保持12 tokens。來源證據可開啟，JSON／CSV預覽可見；暫停後新增一項保持207，恢復後顯示208。原有 Data quality 原生報告回歸通過。截圖版面已檢視。Logs `/tmp/agent-monitor-tool-activity-final-tests.log`、`-final-build.log`、`-native-final.log`、`-quality-regression.log`。

初次測試用了不存在嘅 query 欄位名，改成既有 requestedModel／from／to 後通過；未更改 query 合約。真實 installed 驗證另記 acceptance。唔據此宣告全部 F04／平台／完整 Token Inspector gate 完成。
