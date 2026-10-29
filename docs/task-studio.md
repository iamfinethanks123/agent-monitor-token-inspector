# 任務工作台

0.1.10將嵌入式Agent地圖整理成任務工作台，沿用現有圖形及Trace功能，
唔新增第二套Demo資料。獨立原版App保留原有選單及行為。

設計沿用整個Inspector嘅字體同語言：Avenir Next／PingFang TC；夜藍
`#111927`做工作區、藍灰`#1b2739`做承載面、`#87a6f4`突出核對數字、
`#84c5ba`表示來源活動、`#e0e8f5`做正文、`#7989a5`做次要文字。
任務名稱左對齊，右邊保留Provider／Run選擇；下一行依次係協作關係、
目前任務金額及組件、核對／原始詳情；下面保留可操作嘅圖形。
唔另外複製一排統計卡，避免任務同帳本數字變成兩套來源。

美元／Token切換直接使用工作區單位設定。美元由現有manualUsd結果傳入，
唔重寫計價公式；父層要求同一Codex Run及完整query scope匹配，子層再核對
帳本revision。當範圍未完成載入時顯示未知，唔沿用上一個Run嘅金額。
自動模型情境與自訂情境分開標示；部分未定價有提示，全未定價保持「—」，
唔顯示虛構零元。輸入／輸出仍明確標示Token單位。

本機地圖仍只讀實際本機Trace，其他Provider保留原版Trace／價格詳情。
遠端Collector只同步已授權metadata統計，唔據此宣稱已有完整遠端對話。
選取Codex Run繼續帶動核對帳本；地圖頁本身唔假裝套用未提供嘅跨設備
原文篩選，其他統計頁共用既有統一範圍。

檢查使用隔離Electron、真實Monitor／Inspector解析同合成來源。兩個Agent
合計200 tokens，以隔離資料庫自訂每百萬2美元情境顯示`$0.0004`；切成
Token顯示200，再切回金額。改選100-token Run後為`$0.0002`，冇沿用上一
任務結果。呢個自訂情境只用喺fixture，冇改用戶價目或作為官方API價格。

同一路徑亦核對原有Source Trace Details、By model、Agent搜尋、無結果、
選取節點、Escape焦點恢復、Run隔離同完整圖／小計保持。1512px及1100px
視窗已實際渲染並目視檢查；修正嵌入式macOS多餘titlebar左邊距及較窄
工作台嘅多餘堆疊，圖形控制同單位切換無水平溢出。Node framing保留原版
可讀性／Root／Fit選擇，較小畫面仍可平移及Fit查看完整圖。

證據：scripts/smoke-agent-search.mjs；
`/tmp/agent-monitor-task-studio-native-20261015.log`；
`/tmp/agent-monitor-task-studio-wide.png`、
`/tmp/agent-monitor-task-studio-narrow.png`。
截圖係受控fixture嘅實際執行，唔係用戶目前畫面或完整平台／a11y驗收。
