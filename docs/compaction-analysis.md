# Context 壓縮分析

`codex-compaction/1` 只接受已識別 Codex 來源嘅明確 `compacted`、
`event_msg/context_compacted` 同 `event_msg/item_started/item_completed`，
後兩種生命週期通知必須有 `ContextCompaction` Item 同有效 ID。
Input 下降、換模型、Responses compaction item 被再次放入 Input，均唔會
自行建立壓縮事件。生命週期形狀按官方 Codex protocol 及
[App Server 文件](https://learn.chatgpt.com/docs/app-server) 核對。

同一設備／Thread／Item ID 歸入一組；開始及完成通知保留各自證據。
冇 ID 嘅不同舊格式通知，只有同一來源、generation、Thread、Turn，
相鄰行及已記錄時間相差不超過一秒，先推定為別名。呢個係 derived linkage，
介面明示，唔會冒充同 ID 證明。同一種冇 ID 標記唔會互相合併；有其他
紀錄隔開、冇時間或來源唔同，會保留為獨立未識別事件組。

完成／明確標記數、未完成開始數、通知數同未知時間數各自顯示。
密集壓縮候選按已完成／明確標記事件組計，唔會將一組三個通知誤報為三次。
時間間隔按來源順序推算；時間逆序保留未知並標示。觸發方式及額外用量
未有獨立證據時維持未知，附近回應唔會歸為壓縮成本。

每個事件顯示最近合資格前／後回應嘅 Input、模型、差額及證據入口。
呢啲係 Context 大小代理值，唔係完整 Context snapshot 或可節省 Token。
只使用目前篩選內、同一來源 generation、已選擇嘅 response membership；
aggregate／interval、被隔離記錄、其他 generation 均唔會補成回應 Input。
模型有變或時間次序不一致會顯示限制。累積帳本保持原有用量。

查詢先使用 Timeline metadata 投影識別壓縮通知，再讀原生 metadata，
避免載入全部一般 item-completed 紀錄。顯示最近 200 組；計數涵蓋全部
已保留符合範圍事件，未知時間唔會放入指定日期。

新 Trial resource snapshots 凍結 `compactionOperations`；原有
`compactionRecords` 保留 compacted 標記數，舊快照嘅新欄位顯示未知。
JSON／Markdown／Trial CSV 及原生試驗列表顯示分開嘅數字，唔重寫舊快照。

目前 wire-v2 Collector 只同步用量，遠端壓縮生命週期仍未提供。舊索引有
Item lifecycle 但冇新 metadata 投影時，可用現有重新分析流程識別；唔會
為補欄位擅自重讀原始內容或更改私隱設定。Schema 11／wire-v2 不變。

驗證：35 個相關測試通過，包括同 ID 生命周期及舊別名歸組、獨立 ID、
未完成開始、Input 下降及模型改變不製造事件、完整日期範圍、來源複製、
generation 隔離、interval 不當 response Input，以及原有私隱／Timeline／
帳本／報告行為。隔離原生流程核對 1,200 → 200 Input、-1,000 差額、
推定別名及未知成本。實際只讀索引樣本為 40 組、33 組前 Input、34 組後 Input；
查找由 1,076 ms 改善到 307 ms，單次量度不代表 p95。
