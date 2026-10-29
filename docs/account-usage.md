# 官方帳戶累計與已收集明細

0.1.13喺用量總覽加入兩個獨立範圍。官方帳戶累計取自支援嘅本機Codex登入帳戶，固定全部時間；已收集明細沿用現有日期、設備、Run及其他篩選，同一份canonical ledger繼續供應模型、設備及USD分析。Cache及Reasoning仍然係Input／Output子項，唔重複相加。

0.1.14新增可展開官方每日活動圖、最近7日／30日／已回傳歷史範圍（最多366筆），同官方全部時間單日峰值。圖表及精確數字表沿用同一次官方回覆，日期按真正日距定位；官方有回傳嘅0保留，缺日唔補0。範圍以最新官方日期為終點；只顯示已回傳日期已知小計，唔當成全部時間用量或套用設備／模型篩選。官方回覆未標明日期時區，唔自動同香港時間帳本圖表合併。冇daily buckets保持可用累計同明確空白狀態。

## 讀取及界線

用戶按「讀取官方帳戶累計」才發出請求，更新同樣需要按鈕；冇背景帳戶輪詢。Monitor啟動已安裝Codex CLI嘅stdio app-server，只傳initialize／initialized、account/read（refreshToken:false）、account/usage/read，唔建立或恢復thread，唔發出模型請求，唔登入／登出／重設額度。憑證驗證由CLI處理；Monitor唔開啟、複製或保存auth檔案，唔將帳戶數據放入Collector payload。官方回覆只保留記憶體，讀取時間及遮蔽帳戶識別顯示喺介面。

未登入、API-key-only等未支援登入、CLI缺失、逾時、協定／數值錯誤均顯示不可用。25秒有界請求、2MiB回覆上限；非安全整數拒絕而唔四捨五入，官方null保持未知。重新讀取失敗保留舊值及舊時間並顯示失敗，唔偽裝成最新。離開總覽再返回仍保留該次成功讀取。

兩邊唔相加。現有帳本未逐筆證明帳戶身份或完整歷史覆蓋；官方總數亦未提供可直接對應到每台設備／每個模型嘅明細。因此唔將數字差距當成已證實漏收量、覆蓋率或USD成本。衝突累計記錄可能互相重疊或包含已計回應，唔可以解除隔離後直接求和。完整歷史／帳戶逐筆對帳仍然未完成。

## 驗證

- tests/accountUsage.test.ts：實際隔離CLI子程序驗證唯讀方法序列、官方大額整數、遮蔽身份、null、未登入／API-key-only停止、不安全數字、缺失CLI、無效日曆日期及重複日期拒絕。
- scripts/smoke-account-usage.mjs：隔離Electron介面／IPC樣本，官方數字同12-token帳本分開，日期排序、精確0、缺日、7日範圍及全部時間峰值分開，篩選及切頁唔重複請求，更新失敗保留原數字及時間，canonical總數保持12。樣本唔代表真實帳戶或全平台驗收。
- 本機已登入CLI嘅實際官方讀取已成功；實際已安裝App介面結果另見STATE.md。純讀取成功唔證明所有設備歷史已收齊。

官方來源：[Profile settings](https://learn.chatgpt.com/docs/app/settings)、[App Server account/usage/read](https://learn.chatgpt.com/docs/app-server)。

0.1.21同頁另有明確按鈕讀取目前帳戶額度，與累計、每日圖表及被動記錄視窗保持各自範圍；詳細讀取／未知值／Credits／reset次數界線見account-limits.md。
