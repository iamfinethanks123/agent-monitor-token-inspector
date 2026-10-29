# 時間分析圖表：逐格解釋與讀取狀態

0.1.26補齊時間分析頁嘅原因入口。1分鐘至1日視窗及粒度保持，沿用
目前設備／Run／Agent／模型／Project／Provider／級別篩選及原有帳本查詢。
冇新增IPC、修改價格算法、來源解析或Collector協定。

九個趨勢圖各有「解釋呢格數字」：保留所選時間起訖、已知小計、記錄數、
缺少欄位、未定價數、比率分母政策、區間結束時間分配同帳本／價目版本。
設備／模型／Project排行改為可用鍵盤開啟嘅按鈕，未知身份亦可查看缺少欄位。
模型圖按Observed Model，缺少時先沿用Requested Model；唔同於Token總覽
只按Requested Model嘅排行。Project未知唔抹走已知模型可換算金額。

範圍小計亦可開解釋，說明目前篩選與滾動視窗嘅交集、時間未知／隔離／缺少
總量同未定價成員。沿用現有provenance對話框、Escape／focus trap／關閉後
還原焦點／私隱關閉；開啟後字串快照唔跟隨背景價目改動。自訂均一／分項
價目列出實際設定，關閉換算時明示冇價目，唔當成零成本。

圖表新增明確更新／重試同成功讀取時間。首次失敗唔繼續顯示讀取中，亦唔
變成成功空資料；更新失敗保留同一範圍嘅結果及原來時間。切換範圍會清空；
私隱事件即時清除，epoch guard拒絕較早嘅完成回覆，再做一次新讀取。
原有一個in-flight／一個pending、60秒滾動更新保持。

每圖可用左右鍵、Home／End選格，圖像以aria-describedby連到文字數字及時間，
排行同圖像有明確focus outline。唔聲稱呢個有限流程已覆蓋全部screen reader。

## 實際驗證

- npm run build：型別／renderer／main及既有24案detector gate通過。
- 原有兩個TimeCharts計算檢查通過，包含bigint、分鐘／日、subset／缺少欄位、
  篩選、untimed prior及interval唔冒充response。
- scripts/smoke-time-explanations.mjs使用真實隔離SQLite／Collector／Electron，
  兩個response共24tokens：官方模型＋未知模型／Project、逐格／群組／小計
  解釋、API等值／自訂價目、固定已開snapshot、鍵盤及focus全部通過。
- 同一隔離App只替換既有chart IPC嘅回覆時機，驗證帶時間舊結果／錯誤／
  重試、私隱即時清除及pre-privacy回覆拒絕；最後帳本維持24tokens。
- 初次腳本最後段誤造零個buckets（真實backend合約永遠至少一格），觸發renderer
  失敗；改用同一backend真實回覆作延遲fixture，冇改產品或放寬斷言。修正版通過。
- tmp/time-explanations-chart.png及-group.png已目視，代表1440／1000視窗中
  該兩張卡片，唔代替實際安裝全介面驗收。

用戶完成已批准、綁定0.1.25嘅本機鑰匙圈步驟後，正常退出並安裝0.1.26。
8個runtime檔案同目前dist吻合，deep／strict簽署及與0.1.25嘅相同
designated requirement已核對。已安裝ASAR SHA-256：
987a93a9902de0f6333ef030a7961f596a33a621c3980ccea572eb769d29f091。
回退App保留於release-inspector/before-time-explanations-20261016。
原有加密檔案保持，實際新啟動指紋可讀，見keychain-update-identity.md。

實際原生圖表完成讀取，範圍小計解釋AX及截圖一致：rev4243、2225個成員、
44未定價、0缺總量，API等值已知部分$203.063843；保留價目版本及讀取時間。
背景圖表已更新至rev4244，開住嘅解釋仍保留rev4243。Escape返回原來按鈕。
呢啲數字只係當時最近1日視窗，唔係全歷史或目前帳戶帳單。

真實啟動／跨Settings後曾有device-activity及time-charts QUERY_QUEUE_TIMEOUT；
保留成功讀取時間01:58:38嘅結果，之後02:02:20HKT讀取恢復、錯誤消失。
屬於未完全定位嘅實際佇列效能問題，唔因新UI重試已通而聲稱根因已修復。
只讀Node26／相同Electron runtime量測記錄喺tmp/*readonly-timing.log；
各自scope及時點唔同，唔當成完整介面p95。完整規格及平台門檻保持。
