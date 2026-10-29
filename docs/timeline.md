# 完整保留歷史 Timeline

「執行歷史」使用持久 Metadata 索引，搜尋全個保留範圍，唔只係目前一頁。
每次最多取 200 筆，畫面以固定高度虛擬行只渲染可見區域；鍵盤上下／Home／End
可選擇事件，上一批／下一批、最早／最新可以到達全部符合範圍記錄。

支援 Metadata 關鍵字、事件類型、Agent、Observed／Requested Model、Provider、
service tier、完整工具名稱、Call ID、檔案身份指紋、開始／結束時間及未知時間。
Source order 係 Monitor 接收次序，另保留原始 generation／行號／位元範圍；
time order 用來源事件時間，缺少時間放喺尾，並以接收序號解決同時事件。
時間排序唔會聲稱跨設備因果次序。

Agent 區域顯示符合範圍嘅最多 100 個 Agent，記錄頁仍包含全部符合事件。
Agent 自己／包括子 Agent 使用同一快照時嘅親子關係，並按設備隔離。
Finding 同帳本可以打開精確證據定位；清除定位會返回原有篩選。
精確來源定位暫時唔套用日期／模型條件，避免早期 counter 或 header 被隱藏。

第一次查詢固定最高事件序號、帳本版本、政策版本及解析版本。之後新增
事件唔會令舊頁失效或重複，重新整理先顯示新事件。返回首頁亦使用原快照。
刪除、保留或重新解析變更會令舊快照失效；讀取中切換範圍會丟棄舊回應。
使用者可停留喺快照閱讀，或者啟用首頁即時更新；翻頁會暫停即時更新。

顯示 canonical ledger references 時使用捕獲帳本版本。重複觀察可以指向
同一帳本成員，唔可按 Timeline 行直接加總。累積 source counter 係核對
資料，唔會當成額外用量。unsupported／oversized／parse gap 事件會保留。
保留缺口及排除來源嘅數目係整個工作區統計，唔冒充只屬於目前篩選。

本版只索引已允許 Metadata 身份，唔索引原始 prompt、程式碼或工具輸出文字。
本機原始證據預覽仍然受 Project 權限、來源內容指紋、generation 同位元範圍
檢查。未有寫入、已刪、未保留或已變更內容唔會用目前檔案代替歷史證據。
原始文字搜尋與更完整嘅衍生 Finding／Gap swimlane 仍然未加入。

Schema 11 加入單調遞增事件序號同 Metadata 投影，cascade 跟隨觀察刪除，
重新解析只更新投影，唔改接收序號。migration 保留舊帳本，先保存相符備份。
查詢先等 Worker 資料庫／政策準備完成，再開始 query deadline；啟動等候有
120 秒上限及明確失敗狀態，唔會把約 19 秒嘅索引升級當成查詢 timeout。

驗證包含 10,000 筆首尾／重啟／全歷史搜尋、同時／倒序／無時間排序、
append 中持續翻頁、政策／reparse 失效、親子範圍、Finding／證據定位及
Schema 10→11 帳本保留。29 個相關測試及隔離原生介面流程通過。
真實一致副本：60,887 events，migration 19,075 ms；索引改善後 200-row
queries 實測 ingestion 226 ms、model search 96 ms、time order 294 ms。
呢三次量度唔代表完成 p95 或所有資料規模驗收。


2026-10-14：加入互斥來源類型、全快照分類計數、目前調查標記圖同未知時間區。見 timeline-investigations.md。衍生分析同固定來源快照分開，沒有以標記數替代事件／用量總數。


0.1.8固定範圍分頁使用每connection一份SQLite TEMP範圍／分類暫存，日期／版本／私隱界線保持原有合約。實際1M資料首次scope同後續20頁分開量測；見[timeline-query-cache.md](timeline-query-cache.md)。
