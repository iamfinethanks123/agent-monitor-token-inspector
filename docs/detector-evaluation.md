# 合成 Detector 覆核與評估

第16.5節嘅可重現入口係 `tests/fixtures/detector-corpus.json` 同
`npm run evaluate:detectors`。評估會用真實 IndexCollector、InspectorStore 同
analyze 流程讀取臨時合成來源，輸出 `src/shared/detector-corpus-results.json`；
唔讀取用戶來源或執行fixture入面嘅工具指令。

Corpus `synthetic-candidates-2026-10-15` 有24案，涵蓋重讀、重試、過大輸出、
壓縮集中及Collector缺口五條規則。每案有明確標籤同理由，覆核記錄為Codex；
唔聲稱有獨立人工標註，亦唔代表全部F03–F08 detector已涵蓋。

每案只評指定target detector，分開兩個問題：

- 模式：記錄有冇出現該類重複、大小、壓縮或解析缺口。
- 候選：係咪適合提出有界調查／試驗；唔代表已證明浪費或可節省成本。

必要驗收、改動後核對、部分讀取、process polling及intentional／resolved
註記可以保留模式，但候選維持只供覆核。缺少指紋能力嘅1案唔評分，唔當
真陰性。其他detector輸出唔屬於該案嘅標籤人口。

Precision = TP / (TP + FP)，Recall = TP / (TP + FN)；分母為零維持未知。
目前合成模式結果TP12／FP0／FN0／TN11，候選TP5／FP0／FN0／TN18，兩者
都有1案未評分。呢個細小合成集嘅100%唔係production accuracy、真實用量
節省保證或全部來源嘅覆蓋證明。評估保留不匹配結果，唔以改標籤強迫通過。

品質頁顯示逐規則及逐案結果、標籤政策、覆核人、覆核／量測時間、來源同
corpus SHA-256。Build會重新量測，結果屬於該build嘅合成資料；唔受用戶日期、
模型或Project篩選影響。固定JSON／Markdown／CSV報告唔加入用戶觀察記錄，
沿用既有私隱版本及預覽保存核對。

6項相關數學／報告／私隱／standalone CLI檢查通過；隔離Electron品質頁及
JSON／CSV預覽通過，原有24-token fixture總數保持。原生截圖
`/tmp/agent-monitor-detector-evaluation-native.png` 已目視核對。0.1.3已於2026-10-15安裝，8個runtime files與build一致；真實原生畫面仍因Mac
鎖屏待檢查。全部平台／資源／accessibility gate另行記錄，唔由呢份評估代替。
