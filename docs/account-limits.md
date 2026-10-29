# 目前帳戶額度

0.1.21喺用量總覽加入明確「查詢目前額度」入口，使用本機已登入Codex嘅App Server `account/rateLimits/read`。登入由Codex處理；Monitor只發initialize、initialized、account/read(refreshToken=false)同額度read，唔讀取／複製登入檔案。唔啟動任務、推論、登入、額度時段、reset消耗或郵件。讀取唔會因進入頁面或索引通知自動發出；同時請求喺main合併。只保留記憶體快照，唔寫入用量帳本、Collector或匯出報告。

採用多桶rateLimitsByLimitId優先，未提供先用legacy rateLimits；明確空map維持空。每桶主要／次要時段獨立顯示百分比、實際時長及HKT重設時間，null保持未知，唔假設一定有5小時或每週視窗。剩餘百分比為100-used並限制0..100；超100嘅實際used仍如實顯示。ordinaryUsageAllowed只顯示backend回覆，唔由百分比或時間推斷恢復。可用reset只讀count，唔傳出reset id。Credits單位沿用回覆，唔冒充美元或Token。

帳戶快照唔受日期／設備／模型篩選影響；失敗保留上次成功結果同原時間。無資料及錯誤有明確狀態，唔填零。回覆限制2MiB／25秒／100桶，百分比及時間型別核對；不支援登入、無CLI、格式錯誤等安全返回unavailable。原有account/usage/read累計及每日圖表共用有界唯讀stdio流程，方法allowlist仍只有兩種read。

依據[OpenAI Docs App Server額度說明](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt)，並核對本機安裝版本產生嘅GetAccountRateLimitsResponse／Params／RateLimitSnapshot／Window型別。excludeResetCreditDetails=true避免不必要明細查詢；唔啟用supportsLunaReserve。文件／本機型別未有提供嘅欄位唔自行估算。

相關9項實際CLI子程序fixture檢查通過，覆蓋累計保留、多桶優先、legacy、null／zero／空map、超100、異常欄位、受支援登入及實際RPC方法清單。本機production reader於2026-10-15T15:58:27.678Z成功讀到codex桶主要10080分鐘／已用55%／次要null、ordinaryUsageAllowed=true、可用reset1；呢個係當時快照，唔代表持續監察結果。介面驗證同安裝證據另記STATE.md。

隔離Electron介面流程通過：初始零讀取、明確按鈕／讀取中、獨立兩桶、null唔填零、101%保留原值／progress限制100、Credits文字安全、日期／切頁唔重查、失敗保留舊時間／數值及12-token帳本保持。實際安裝0.1.21後原生按鈕成功，AX同截圖一致顯示2026-10-16 00:01:52 HKT快照：7日已用56%／剩餘44%、次要未提供、2026-10-22 15:00:55 HKT重設、可用reset1。只證明呢次讀取及畫面，唔推斷完整帳戶歷史或持續連線。
