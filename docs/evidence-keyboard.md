# 證據／數字來源視窗鍵盤操作

規格14.5要求鍵盤導航及清楚焦點。原有一般Source evidence／Metric provenance
視窗有aria-modal，但Tab可離開視窗；讀取完成亦會重新記住焦點，令Escape
返回已移除嘅關閉按鈕。讀取未完成時按關閉，舊回覆可能再次打開視窗。

0.1.12讓同一視窗開啟期間只保存一次原本按鈕；Tab／Shift+Tab按目前可用
按鈕循環，Escape／關閉／背景關閉共用同一條退出路徑，令原本讀取失效，
effect清理時回到仍存在嘅來源按鈕。讀取完成或由數字來源轉到原始證據，
唔會重設原本焦點。私隱更新仍會讓證據失效並清除視窗。

隔離Electron用真實資料庫／worker／renderer，僅將該次evidence IPC回覆
延遲600ms：來源證據完整載入後Tab循環、Escape返回、讀取中Escape、
讀取中關閉按鈕、數字來源多按鈕首尾循環全部通過；遲到回覆唔會重開。
官方12-token帳本保持。測試先於修正重現焦點離開，亦捕捉到關閉按鈕未
轉用共同退出路徑，已修正產品而冇延長等候或移除斷言。

證據：scripts/smoke-evidence-keyboard.mjs；
`/tmp/agent-monitor-evidence-keyboard-red-20261015.log`、
`/tmp/agent-monitor-evidence-keyboard-green-20261015.log`。
呢個係指定鍵盤／延遲讀取流程，唔係全部screen-reader／平台／寬度驗收。
