# 統一用量範圍

總覽、時間圖表、帳本、Timeline 同分析報告共用 `InspectorQuery`。
原有設備／Run／Project／模型／最近日數以外，增加 Provider、服務級別、Agent
自己／子樹及香港時間自訂起止日期。開始包括，結束不包括；有時間邊界時，
未知時間用量保留未知而不加入該日期總數。

Provider／Tier 按每個 ledger member 回報，不使用 Session 最後模型／級別
套用全段。明確 null 表示未記錄，undefined 表示不限範圍；未記錄 Tier 不會
成為已知 Standard 群組。自動美元估算仍按其標示嘅 Standard 情境假設处理
未記錄 Tier，兩個概念分開。篩選選項只來自已記錄資料，不填猜測值。

指定 Agent 預設只計自己，inclusive 使用已識別子樹嘅集合聯集。親子遞迴
按 machine_id／thread_id 配對，不會借用其他設備同名 Thread 關係。子樹
總數不應再同子 Agent inclusive 總数相加。

原始 Metadata 工具／Context 記錄若冇 observed model，依其 requested model
篩選；不假設它一定同後來某筆 response effective model 一致。報告的 immutable
Trial resources 保存 model/provider/tier/agent 集合，只選完整、可證明在範圍內
嘅 Trial。混合 Provider、跨日期或含範圍外 Agent 嘅 Trial 不拆分資源。
舊 Trial 缺少新 frozen fields 時，不會用目前帳本重算它來冒充舊快照。

新篩選都加入 cursor 身份。更換範圍不能沿用另一範圍的下一頁；Timeline
仍按原本 watermark、privacy/analysis version 執行 snapshot pagination。
Project export restriction 仍然保守檢查混合來源，不能以篩選繞過權限。

驗證：21 個相關測試及隔離原生介面流程通過。Provider／null-tier／日期／
子樹同時套用时，summary、USD、charts、timeline canonical refs 同 JSON
報告精確對帳；相同 Thread ID 跨設備不混入；整段 Trial 不拆分／不重定價。
原生隔離介面操作 Provider、Fast、Agent 子樹並核對精確 3-token fixture。
實際只讀選項：openai、未記錄 Tier、62 個 Agent；選項查詢由 904 ms 改善到
143 ms，一次量度不代表 p95。實際資料無明確 Tier 時，介面不補 Standard。
