# Context 來源及重建

Context 頁面分開顯示已核對帳本 Input、被動來源內容同受控 Client 請求重建。
來源文字嘅總估算唔會同範圍內 Input 相減，亦唔會當成每次 Request 都被納入。
每份來源內容只有一個主要 origin；transport 同 state 係獨立欄位。

被動工具結果按 Call ID 配對分類。已解析嘅 file read 即使冇 fingerprint key
亦可標為 Project 檔案；AGENTS.md／SKILL.md 標籤只有捕捉到相應讀取路徑先
出現，provenance 係 parsed_path，唔會因為已安裝 Skill 就推定納入請求。
原始檔案／完整 stdout 長度、後續 Request 曝露同逐檔案 Cache 維持未知。
估算只用實際捕捉文字嘅 UTF-8 bytes / 4，唔會用原始 1 MiB 長度取代 2 KiB
截斷 payload。圖片／音訊／其他非文字部分另計數，唔按字數估 Token。

Occurrence API 支援同一模型／設備／Agent／Project／Provider／Tier／日期範圍，
及主要來源分類鑽取。頁面上限 50，但分類計數涵蓋全部符合範圍嘅 snapshot。
Cursor 固定 ingestion watermark 及相對日期 cutoff；privacy／reanalysis 變更
會使舊 cursor 無效。模型 Input 係目前 ledger revision 嘅已知小計，唔係
舊 occurrence snapshot 嘅完整請求重建。

受控 Client 可以選 `owned-context/2`，記錄獨立 origin／transport／state、媒體、
不帶原文嘅 content ID、context epoch、原始大小、included 同 serializationIncluded。
V1 保持相容，缺少新欄位會保留未知。新增／保留／摘要／截斷／移除只接受
Client 明確聲明；移除項目需要空文字，唔會傳入 send callback 或參與重建。
非文字項目唔用字串長度估算 bytes／tokens。

共同 Tokenizer identity/version 先可以合併文字估算。缺項、混合 Tokenizer
及未估非文字會令完整重建保持未知；已知文字小計分開展示。重建高過 Input
會警告，保留負差額而不縮放分類；正差額亦唔代表隱藏 system prompt。
多份不同 Request 聲明同一個回應時，linkage 變為 ambiguous，唔建立重複曝露。

重複納入只統計目前 20 個已配對 Client 請求頁面中，同一 client/content ID
跨不同 canonical response 嘅聲明。呢個係 client-declared lineage，唔證明完全
相同文字、可避免用量或真實 Cache 範圍。普通被動工具紀錄嘅曝露維持未知。

JSON／Markdown 分析報告加入 metadata 結果；CSV 可選 Context 來源。
報告唔包含原文、圖片 URL、Client consent 設定或內容 fingerprint，沿用 Project
匯出權限、凍結預覽同遮罩。原始來源只由現有本機證據入口及私隱權限讀取。
真實 Client manifest 匯入仍然預設關閉；本次沒有啟用使用者嘅受控捕捉。
Schema 11／wire-v2 保持不變，遠端 Collector 繼續只同步統計。
