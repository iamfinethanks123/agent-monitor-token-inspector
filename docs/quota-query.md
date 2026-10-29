# 被動額度查詢與讀取狀態

0.1.19修正數據品質頁實際inspector:quotas QUERY_TIMEOUT。先前同一批歷史JSON分別掃兩次，供應每來源／limitId最新快照同全域最近200筆；來源更新亦會重疊觸發查詢。

現在用既有timeline_kind_order定位token_count事件，單次materialized候選計算兩種排序，以最多400筆聯集同時保留兩個獨立200筆限制。Workspace、來源／Agent／Run、模型、Provider／服務級別、日期、active source analysis、timestamp／rowid tie順序及null處理保持。唔加入新Schema或改原始觀察／Token帳本，亦唔提高IPC逾時。

每個Store只留一個記憶體快取：scope／日期參數、來源身份／parent／generation／active分析revision、token_count數目及watermark核對。冇相關變更直接複製回傳；純append時只讀新序列，再同舊快照／history合併，最多保留400筆。新增數目唔吻合、刪除、重解析、來源／scope改變會重建，唔假設刪舊加新等同append；caller改回覆唔會污染快取。相對日期嘅移動cutoff亦納入scope。遠端來源／保留政策及原有缺失值邊界保持。

介面合併通知10秒、最多一個進行中加一個待更新。初次及新scope顯示讀取中，只有成功空結果先顯示未有資料；同一scope失敗保留已量測快照。私隱改變即時清除結果並失效遲到回覆，唔等10秒通知。唔新增背景定時帳戶輪詢、登入／餘額／重設操作，官方帳戶累計仍係獨立明確按鈕。

tests/quotaQuery.test.ts對照原本SQL，覆蓋scope、相同timestamp、null bucket、active重解析、hot-source與205來源下兩種200筆限制、快取caller隔離、append／倒序時間、刪除及刪舊加新。scripts/smoke-quota-loading.mjs驗證通知合併、失敗保留、新scope及私隱fence。實際唯讀同一snapshot對照及native結果見STATE.md；單次讀取結果唔代表所有硬件／冷快取／持續高負載p95驗收。
