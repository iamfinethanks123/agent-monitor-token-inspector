# Dashboard 美元單位與模型自動換算

Dashboard 預設用 **USD 成本**做主要用量單位，Token 數放喺旁邊補充。上方
「Display unit」可以切換 USD／Token，並同步設備卡、總量走勢及設備／模型／
Project 排行。每日雙軸圖同時顯示 Token 柱及美元成本線；每日成本平均只用有
時間嘅部分，列出日數分母。每百萬 Token 成本只用可定價 Token 做分母。

**自動按模型官方價目**係預設。2026-10-13 核實七個官方模型頁，保留完整價目、
來源日期同不可變 ID；唔會聲稱係即時價目或歷史當時收費：

- gpt-6.1-sol、gpt-6-astra、gpt-6-sol、gpt-6-luna。
- gpt-5.6-sol、gpt-5.6-terra、gpt-5.6-luna。

逐筆優先用 Observed Model，缺少時明示 Requested Model 假設；混合模型分開
計。未知模型／代理路線／未核實服務級別／缺少 Input 或 Output 保留未定價。
包括 `codex-auto-review`、`gpt-5.3-codex-spark`，唔會猜其他模型價格。

自動計法將 Input 分成互不重疊嘅普通、Cache Read、Cache Write。Cache Write
係 Input 子項用另一價目，唔係額外再加一次。未知快取分項會推算上下限；
>272000 Input 嘅單次回應用 Input／Cache ×2、Output ×1.5，區間跨多個請求
而逐次 Context 未知時用範圍。未知服務級別沿用 **Standard、全球處理**情境；
呢個範圍唔涵蓋地區加價、工具費、稅或所有可能嘅帳單。已記錄、已核實嘅
GPT-6 Fast／Flex／Batch／Ultrafast 按個別支援價目處理。

同一價目來源亦更新原版 Agent Monitor Trace Details 嘅 OpenAI 價目。
原版嚴格計價要求完整來源 Cache／Context Metadata；主 Dashboard 能明示
假設／範圍。Trace 來源計數唔會混入核對帳本，兩者唔一定同數。

「換算設定與價目來源」可展開，亦可以去設定管理；保留以下兩個手動選項。
所有價格單位都係 **USD／100 萬 Token**：

- **統一價格**：已選帳本嘅 Total × 自訂統一價／1000000。
- **分開價格**：`(Input − Cached Input) × Input 價 + Cached Input × Cache 價
  + Output × Output 價`，再除以 1000000。

Cache 係 Input 子項，Reasoning 係 Output 子項，唔會再加一次。統一價格係
使用者設定嘅平均／情境價格，會套用全部模型；唔會冒充每個模型嘅正式價目。
歷史當時價目嘅嚴格計算仍由原有已覆核 price cards 處理。

缺少必要 Input／Output 會保留未知。Cache 未知而兩個 Input 價不同時唔換算；
如果 Input 同 Cache 用相同價格，計算唔依賴 Cache 數量，毋須假設 Cache 為零。
部分記錄不可換算時，只顯示已知小計同未定價數，唔會把未知顯示為 $0。

價目以不可變、工作區專屬識別保存，連同建立時間同 `user_defined` 性質記錄。
使用者之後修改／停用換算唔會改寫舊價目或已匯出報告。JSON／Markdown 分析
報告包含該次美元估算、精確價目及帳本版本，方便重算。偵測器、Token 帳本同
實驗嘅供應商已覆核成本唔會被自訂估算取代。

圖表可選擇把總量走勢同設備／模型／Project 排行轉成 USD。其他 Token、比例
同記錄數圖表維持自己嘅單位。換算使用同一份時間範圍同帳本版本，部分不可
定價記錄會列明。價格只留喺本機，唔會加入 Collector metadata。

計算使用 bigint 同固定小數，保留 12 位美元小數；顯示可簡化至六位，非常小嘅
正值顯示 `< $0.000001`，完整數字仍保留。呢個係按使用者價目計算嘅估算，唔係
供應商帳單、ChatGPT／Codex 訂閱收費或剩餘額度。

針對性測試包含均價、加權 Cache、Reasoning 唔重複加費、缺少 Cache、同價
可計算條件、大於 JavaScript 安全整數嘅精確計算、不可變價目、報告快照及
圖表小計一致性。原生隔離驗證會輸入自訂均價及切換美元圖表；唔會喺真實
工作區設定虛構價目。

自動換算嘅針對性回歸包含混合模型、已觀察／請求模型優先次序、Cache Write
互斥分項、未知 Cache 範圍、272000／272001 Context 邊界、區間範圍、服務
級別、超大整數、未知模型留空、模型成本下鑽，以及圖表／報告快照對帳。
