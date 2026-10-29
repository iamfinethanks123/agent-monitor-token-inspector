# 新事件送達速度

0.1.8仍用10秒合併索引變動通知、2秒巡查間隔，與規格18.1「索引完成後，
每秒100個有效事件，p95兩秒內可見」嘅目標有落差。實際worker回歸測試
寫入500個有效事件後，等待期間收到0個自動可讀事件；唔係資料未寫入。

0.1.9將Desktop worker巡查間隔縮至1秒、變動通知合併縮至100ms。未變來源
仍提早返回，signature冇改就唔通知；儲存FULL／權限失敗仍停止自動巡查，
只有明確refresh先恢復。Root load同圖表嘅一個in-flight／一個pending限制、
Timeline固定快照預設、查詢queue及execution時限保留。遠端headless Collector、
同步格式及配對設定唔需要更新。

實際500事件、每100ms追加10個約1KiB message、已有來源索引之後，藉自動
changed通知讀取Timeline接口。全部500個事件觀察到，p50為756.6ms、p95
為1,211.6ms、max1,315.0ms，共5次通知。之後3.1秒冇新資料，通知數冇增加。
唯一原有官方response保持12 tokens，追加message唔會被當成官方用量。
Host為macOS／12logical CPU／16GiB，唔係4-core reference host。

分析／帳本／工具reader亦改用同一種一個in-flight／一個pending限制，仍按
所選live／固定範圍更新；停止監聽及scope切換唔會讓舊回覆覆蓋新範圍。
隔離實際renderer以50ms通知、800ms分析回覆重現原本16個重疊查詢；修正後
峰值為1，持續有完成嘅刷新，離開頁面後停止，12-token帳本不變。遲延同
通知只喺隔離App IPC stub產生，product冇測試開關。

4項相關測試通過，包括真實SQLite FULL／readonly、failed commit游標與帳本
保持、暫停／明確恢復。Build／typecheck及diff check通過。隔離Electron實際
IPC／renderer亦確認：5.5秒冇資料變動通知，追加response後Dashboard由12
更新至24 tokens，設定頁仍顯示真正automatic mode及2筆未定價記錄。

Worker接口測量唔等於500個事件全部逐一畫上實際用戶嘅螢幕；virtualized
Timeline仍按頁顯示，預設保留固定快照，啟用live first-page先會自動更新。
原生隔離流程只證明受控fixture嘅Dashboard連接，唔宣告完整reference workload、
大型持續負載、真實Mac畫面或全部平台已驗收。

證據：`tests/inspectorLiveVisibility.test.ts`；
`/tmp/agent-monitor-live-visibility-red-20261015.log`、
`/tmp/agent-monitor-live-visibility-green-20261015.log`、
`/tmp/agent-monitor-live-visibility-native-20261015.log`。
