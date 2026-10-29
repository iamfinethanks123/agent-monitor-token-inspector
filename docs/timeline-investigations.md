# Timeline 調查分層

「執行歷史」加入全範圍來源類型計數同目前調查標記。來源類型係互斥嘅
用量／工具／訊息／錯誤／壓縮／缺口／其他；一個錯誤工具結果唔會喺工具
同錯誤兩邊重複相加。分類計數涵蓋同一個來源快照內嘅全部符合事件，唔只
目前一頁。更換分類加入 cursor 身份，唔會沿用另一分類嘅下一頁。

來源清單維持原本 watermark、ledger revision、privacy／analysis version 同
親子快照。Category facets 保留其他篩選，但唔被目前 category 限制，所以
使用者可以直接轉去其他類型。Raw row 同分類條用同一套分類規則。

錯誤分類使用已記錄 error kind 或正常化 exit/status flag；壓縮分類亦接受
已識別生命週期。舊索引缺少新 flags 時不自行補推；可透過現有明確重新分析
流程補齊。全部來源永遠保留未分類事件，唔會為圖表刪除來源或改寫用量。

衍生調查區係「目前分析」，唔係來源事件快照嘅不可變 annotation。它展示
Finding、Context compaction、Retry progress 同 retained source gap。普通更新
保留最近有效資料，Scope 及私隱變更清空。每個標記只定位一個有證據、符合
目前 InspectorQuery 嘅來源 anchor；其他關聯證據仍在完整來源／發現頁面。

已知時間標記放喺來源時間圖，未知時間另列。沒有用 Monitor receipt/discovery
time 假扮來源時間，亦不聲稱跨設備因果先後。標記數唔等於事件數或可節省
Token。Finding／compaction／retry 及 gap 上限會明示；達到限制不會聲稱完整
標記人口。完整 retained source search／pagination 繼續可用。

點擊標記會清除互相衝突嘅內部來源分類／工具篩選，定位 evidence record。
原有全域設備／Run／模型／日期範圍保持一致；未知時間明確納入。定位條可以
一鍵返回完整來源。證據正文仍然經原有本機讀取及 Project privacy guards，
沒有 raw-text search、原始內容索引、帳戶操作或 Collector 傳送內容擴大。

Schema 11／wire-v2 保持不變。測試包括全快照互斥計數、分類 cursor、append
快照保留、來源 anchor／未知時間、Scope filtering 同刪除。原生隔離流程
實際操作分類、圖表標記、缺口定位及返回。實際只讀樣本有 264 個標記，222
個來源時間未知、gap 達到 200 上限；查詢約 2586 ms，一次量度不代表 p95。
