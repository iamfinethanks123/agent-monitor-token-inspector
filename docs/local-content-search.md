# 本機經同意嘅文字保留與搜尋

「設定與私隱 → 逐 Project 私隱設定」可明確啟用本機刪敏文字保留，預設0日／
關閉。只限已識別、未排除且允許本機來源預覽嘅Project；未識別群組不能啟用。
首次啟用或增加日數先顯示原生同意預覽，Cancel為預設。本次更新不替用戶啟用。
指紋比對與文字保留獨立，成功讀取指紋不會啟用文字保留。

只捕捉已授權本機Codex已知response_item文字欄位：訊息文字、工具參數字串／
custom input及工具output／result文字。影像、音訊、未知欄位不序列化成副本；
混合／截斷部分有標示。先刪敏再限制UTF-8長度，每段8 KiB、每Project8 MiB、
工作區64 MiB或20,000段，上限移除最舊片段。最多30日且不超過事件Metadata期，
按原始Monitor接收時間；重新解析不延長到期時間。已知secret／Bearer／私鑰
模式會刪敏，但不保證識別所有私密文字；同意預覽有提示。SQLite沿用700資料夾／
600檔案權限，唔係新增OS全磁碟加密承諾。

只捕捉新讀取記錄；舊歷史須另行按「重新解析」，核對digest／generation後
原子發布該來源嘅解析及片段。失敗、換代或取消未完成來源維持上次結果，原始
logs不變。寫入時再檢查同意／預覽政策；遠端machine不能寫此本機read model。

「執行歷史 → 本機文字搜尋」沿用设备、Project、Agent／Run、模型、Provider／
tier及日期範圍。搜尋係完整字串substring，百分號／底線為普通文字；SQLite
內置lower主要處理ASCII，唔承諾Unicode斷詞。每頁50段／後端最多200段，
keyset watermark固定人口，私隱／解析版本變更使cursor失效。結果有source、
generation、evidenceRef及到期時間，可以定位原Metadata Timeline。

關閉即清除，縮短即清理超期部分；Project／source／metadata刪除由外鍵cascade
移除片段。到期清理獨立於事件／用量到期；查詢排除到期或禁止预覽資料，私隱
操作後介面清除舊結果，顯示中片段到期亦清空。原始logs、匯出檔案、OS備份／
SQLite舊頁或WAL嘅取證抹除不在功能承諾內。其他Client政策仍未由Hub集中傳播。

Schema11附加可重建表local_content；啟動只建立空表及清理失效資料，無全庫
reparse／wire升版。舊Collector仍用statistics-only-v2；sync／encrypted spool／
統計報告不讀此表。舊私有App回退後冇此搜尋；其觀察刪除仍由外鍵清片段，
新版再啟動清理已關閉政策。Global rawCopies/textSearch保持false；正面文字
保留按Project同意獨立管理。

19個content／Project／retention／cancel檢查及15個storage／transport／sync／
Timeline整合檢查通過；最後事件scope alias調整後5個content檢查亦通過。
涵蓋encrypted spool不含文字、UTF-8截斷、hard cap、到期、刪除、重啟、分頁、
未知身份拒絕、原始bytes及12-token帳本不變。隔離原生Electron流程通過Cancel／
Apply、新讀取捕捉、刪敏、來源定位及即時撤銷；同意／dialog只在fixture。
截圖 /tmp/agent-monitor-local-content-native.png 已人工查看。實際用戶Project
文字保留維持關閉，實際新版畫面核對另以acceptance／STATE記錄。
