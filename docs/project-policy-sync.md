# Collector 中央政策同步

Hub 全域事件／用量保留設定，以及逐Project嘅保留、匯出、來源預覽及排除限制，
會透過認證通道傳到Collector。Project用已記錄嘅工作區識別，唔按名稱或路徑猜
跨設備映射。傳送內容只係opaque IDs、日數、布林限制、版本及識別碼，冇文字。

Client另存中央constraints，保留原本本機政策；取兩邊較嚴格嘅日數／權限。
逐Project中央override會代替中央global fallback，本機較嚴格限制仍生效。
中央正數contentDays只係上限，不能建立本機文字同意；本機預設0日仍係0日。
先前本機同意仍保留，中央限制放寬時只容許原有本機選擇重新生效。排除Project
會清理並抑制後續匯入，唔因中央其他設定放寬而解除已刪除排除。

每項政策有monotone版本及內容識別碼；修改global設定亦更新受其影響嘅版本。
一般資料到期／私隱epoch改動不會令未改政策重新傳送。每頁最多32項，沿用
16KiB回應上限及10秒request期限。Client每次走完整政策快照，唔靠Hub舊receipt
跳過內容；Client DB回退／重建亦會重新補套用。快照中途變更、舊控制、相同
版本不同內容、工作區錯配及撤銷設備會被拒絕。

套用前保存durable privacy-reset plan，記錄將取代嘅transport範圍，再移除
加密待傳送批次、套用constraints／清理到期索引／content，並按原identity重排
仍保留資料。中途重啟先完成plan，離線亦可恢復；完成後先寫Client receipt及
回覆Hub。失去ACK重試不重置已完成queue，重播不重複帳本。已收到嘅政策會喺
networked Collector及離線匯出流程持續到期清理，唔等另一個新政策先執行。
原始Codex logs、先前匯出檔案及備份不被刪除；receipt係Client已套用嘅回報，
唔代表OS取證抹除或所有副本已消失。Standalone local-only mode仍另行管理。

設備頁新增政策同步欄：目前版本、已確認／待確認數及時間。單靠在線、heartbeat
或來源排除receipt不會當政策已套用。Project／global保留設定將影響已配對Client
時，原生預覽列出設備數、可能清除範圍，Cancel為預設。舊Hub可繼續統計同步，
但不提供中央政策；舊Collector未有receipt，顯示待確認。回退舊Collector不能
宣稱仍執行新版constraints，需保留呢個兼容性邊界。

Schema11附加表collector_project_constraints，metadata wire2保持。新增認證route
`/v2/project-policies`／`/v2/project-policies/ack`，冇任意SQL／路徑／命令執行。
Project限制或未完成排除存在時，健康快照等政策receipt完成先接收。

驗證：27個content／Project／retention／sync／health檢查通過，包括71政策三頁、
global繼承、較嚴格本機選擇、Project刪除、離線expiry／restart／lost ACK、舊／
偽造控制、回退Client DB、未授權workspace及撤銷。隔離native完整流程通過
Project／global Cancel及Apply、真實fixture Collector套用、確認欄更新、metadata
只到達一次、文字0日及34-token不變。截圖已人工查看。

實際部署：Mac已安裝，8個runtime檔案吻合，ASAR
e2e460edb61b3cf9cc9fb01d31d20a417114350850c335ef8dd8f6363fbd15f0。
Ubuntu service active，PID3208165，Collector
52914b47f8cd9caa9f158f12d936bd1bde7e9126607a79712e119b0b773b9483。
部署前兩邊均為原有30／180日、冇Project政策；Ubuntu最舊接收2026-10-12。
新Client已實際回覆global版本0，Hub持久receipt時間2026-10-14T17:24:54.587Z；
Mac原生AX／截圖一致顯示Ubuntu已確認1項，Windows1項待確認（rev3460）。
真實非預設Project限制未替用戶啟用；其正面行為由上述fixture驗證。
Windows手動ZIP已更新11members／manifest，SHA
2ca2444b5ff0ecae57df63966515981cd5a4eb02f60bcb53fa0643495427dd77，未實機運行。
