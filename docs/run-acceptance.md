# Run 驗收摘要與 Agent 計數範圍

0.1.11補上規格14.1 Run Inspector嘅驗收／結果入口及exclusive／inclusive選擇。
任務工作台可揀整個Run、已選Agent自己、已選Agent及已識別子Agent。
圖形及關係唔會因計數方式改動而刪走；原有帳本集合去重規則繼續處理子樹，
唔將父／子inclusive小計再相加。源Trace更新唔會把選擇重設為整個Run。

核對金額同Token繼續由完整query／本機machine／Run及帳本revision對齊。
本機machine身份未讀到時唔顯示跨設備合計冒充本機圖形；其他Provider保留
原有Trace，唔由新控制聲稱已有Codex核對帳本或合約。

新run-task只讀方法接受runId及可選machineId，讀取該Run最近immutable
TaskContract、歷史設定數目，及最近20筆同一contract／Run／machine嘅已匯入
試驗摘要。唔讀其他Run嘅比較試驗或將本機離線驗收執行當作Codex用量。
摘要顯示目標、驗收條件、環境、允許範圍及最多5筆試驗／每筆3個證據入口；
截短／歷史設定有明確提示，可開啟既有完整驗收頁。

未有合約、未匯入覆核結果、未記錄允許範圍各自保持未知。完成文字或exit0
唔會自動建立成功結果。保存／匯入仍用既有完整驗收流程，今次入口唔會
自動執行指令、變更價目、改寫合約或改動原始logs。備註只作React文字顯示。
離開任務地圖會停止摘要訂閱，返回時讀最新狀態。

8項Run Task／Experiment相關檢查通過，覆蓋最新合約、不同machine不混入、
證據引用、無結果未知、無效selector，以及原有失敗人口／不可變資源／報告。
測例漏填既有必填Trial ID只修正fixture，冇放寬importTrial驗證。

隔離原生流程以真實parser／Monitor／Inspector核對：父Agent自己100 tokens、
含子200，追加來源後inclusive仍保留；任務圖讀取保存合約，未有結果顯示
未核實，script文字唔執行；直接入口打開驗收頁並預選正確Run。原有美元／
Token切換、Run隔離、Trace Details／By model、搜尋／焦點及較窄視窗檢查保留。
fixture只存喺自己臨時資料庫，冇建立用戶任務或執行真實專案指令。

證據：tests/inspectorRunTask.test.ts、scripts/smoke-agent-search.mjs；
`/tmp/agent-monitor-run-task-unit-20261015.log`、
`/tmp/agent-monitor-run-task-native-20261015.log`。
呢啲係指定流程證據，唔代表所有Outcome／M3條文、平台或實際用戶任務完成。
