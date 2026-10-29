# 完成核對：已證明與仍未完成

完整目標保持原樣：整合Agent Monitor、Codex Usage及指定規格功能，整理不同於Demo嘅介面，分鐘至整日圖表及美元主單位。來源以 `spec-reference.md` 為準，SHA `afe34991f72da8cea0896ca2a0ec2538444f3374fd04e282437301e038bb6480`。呢份係目前證據核對，唔係完成聲明。

## 本輪實際結果

- 整合unit／integration：202 cases，198 passed，4 Windows-only skipped，0 failed。四項skip唔係Windows實機證據。Log `/tmp/agent-monitor-completion-audit-tests-verified.log`。
- 初次整合揭示提醒update時間相同時，id tie-break可能將歷史證據排先；固定id案例重現，改按記錄證據時間排序。六項提醒／budget檢查通過。
- 全套再跑揭示fixture將1秒timeout預算沿用到exit2失敗案例；timeout仍1秒，失敗案例改獨立10秒預算並新增exitCode2斷言。Runner／實際query期限冇改。
- 完整原版／整合Electron流程通過。涵蓋graph／trace／streaming／parent-child／model details、Context compactions、預設關閉manifests、trial snapshot、固定report保存及audit、export／source-preview policy、budget、incident入口、分鐘圖表及USD。Log `/tmp/agent-monitor-completion-audit-native-verified.log`。
- 原版smoke路徑因新Context／Findings入口及Benchmark同名預覽而失敗，改用明確section／exact report button；冇移除功能斷言或延長UI等待。
- Build／typecheck及git diff check通過。前述隔離流程唔等於用戶嘅實際benchmark任務成功。

## 功能證據入口

F01–F02以accounting／source sample／scope／ledger explanation／total explanation檢查及實際Mac／Ubuntu資料為據；F03–F08以Context／tool activity／parts／generation／repeat／retry／compaction／cross-agent檢查同專用native流程為據；F09、F12–F13以contracts／outcomes／trials／bounded advice／local runner／report guards為據。F10有10,000 retained metadata事件、restart／cursor／source-order及native Timeline證據；F11有100次recurrence／cooldown／historical quiet／annotation與budget檢查；F14、F17有authenticated statistics-only sync／encrypted spool／offline signatures／revocation／tombstones／project policy檢查及Ubuntu headless實際接收。F15、F16有exact USD、兩個price snapshots、time scope、frozen reports／CSV escaping檢查。F18有schema downgrade／gap／resources／deterministic reparse／retained progress／cancel與實際UI。各批native、部署hash、限制及較新狀態以acceptance／STATE為準。

呢段只定位證據，唔將所有F／T acceptance自動打勾。比如T13嘅實際native reset／correction語义、T50全部crash/storage-full情境及來源人口完整性，仍需要對應scope嘅證據，唔由200多個case或一次抽樣推斷。

## 真正功能缺口

- F10／F17本機正數文字保留／搜尋缺口已補：已識別Project明確同意、bounded刪敏片段、接收時間到期、原子reparse、刪除cascade及keyset搜尋，統計同步／報告不含文字。19個相關及15個整合檢查、隔離native同意／搜尋／撤銷通過；用戶Project維持關閉。內容範圍、容量及限制見local-content-search.md；唔當成完整未截斷原文、全部F10／F17或實際已收集用戶文字嘅聲明。
- F14／F17中央Project政策同步已補：獨立constraints保留Client本機選擇、global／Project版本、完整paged快照、durable queue reset／離線expiry／receipt及設備頁。27相關檢查及隔離native通過；真實Ubuntu已回覆原有global版本0，Mac畫面及持久receipt一致。非預設限制僅在fixture啟用，Windows手動未運行；receipt係Client回報，唔係全部副本取證清除或完整跨平台F17驗收。見project-policy-sync.md。
- 第16.5節：已補24個逐案有理由及Codex覆核記錄嘅合成corpus，模式／可試驗候選分開計precision／recall，缺少指紋嘅1案維持未評分；品質頁同固定JSON／MD／CSV報告顯示版本／來源digest／標籤政策。5條規則測試結果唔代表production accuracy、所有detector覆蓋或可節省成本；冇聲稱獨立人工覆核。6項相關檢查及隔離native報告驗證通過；已安裝0.1.3，實際畫面仍待Mac解鎖。
- Standalone `local` Collector 已喺每次scan之前套用既有retention；實際CLI子程序驗證過期記錄清理、再次scan唔會恢復、之後新記錄仍可索引，原始logs保持不變。Networked／offline export既有cached-policy expiry保留；唔據此聲稱完整跨平台F17驗收。
- 規格18.2／T50嘅Desktop增量儲存FULL／READONLY／PERM：已補固定原因、停止自動巡查、全頁action提示及明確Retry。6項相關檢查及隔離native／目視通過；游標及有效Token保留。全部startup／migration／corruption／headless情境仍未當完成，見storage-recovery.md。

## 尚需驗收及條件能力

- 2026-10-15用戶授權代啟動Windows：SSH實際主機、x64啟動包、DPAPI保存／重新讀取、背景程序及Hub送達已確認；183,722,880-token固定小計與Mac介面文字一致。23份／4.6GB歷史未讀完，10秒逾時／socket關閉修正後，診斷版SYNCED24827及正式版SYNCED24903已确认，最新Hub小計2,101,619,811tokens；截圖較舊，完整Windows native／DPAPI情境未完成。保留手動重啟，見collector-windows.md。
- Linux ARM64既有Collector已實際運行及送達；長斷線／backpressure有fixture證據，唔代表已量度真實24小時斷線。
- 第18節已有指定條件嘅發布結果：1M資料完整游標／110gaps／11,988tokens及restart/replay已核對，10k selected-run renderer量測、連續Timeline分頁及100events/s接口有實際報告。詳見scale-measurement.md、timeline-accessibility.md、timeline-query-cache.md、live-event-visibility.md。原匯入兩段因runtime cap退出，連續匯入全程OS峰值仍缺終局抽樣；冷篩選／reference4core16GiB／所有事件實際paint唔由呢啲有限scope結果推斷。
- 第14.5節：完整keyboard／focus／screen-reader及所有screen寬度驗收仍需逐項結果；代表截圖只證明該個畫面。
- F19官方帳戶累計喺0.1.13提供明確按鈕唯讀查詢，與canonical ledger分開；完整帳戶即時額度／餘額／重設及帳戶逐筆對帳仍未完成，見account-usage.md。F12外部AI、F13 paid AI runner、F16 MCP／HTML／PDF、原始遠端內容均保持未啟用／條件或延後，具體分類見release-notes。用戶選擇第一版offline local benchmark，唔自動發paid requests或帳戶write。F20 owned-client metadata有compatible fixture與opt-in，不截取其他Desktop。

逐項原文對照入口requirement-evidence.json：20功能／7milestone／50情境／16交付檢查，全部保留原scope，指標唔等同pass數。原大型headless匯入／finalization／分頁量測程序均已terminal，唔以舊進度當作仍運行；實際限制及結果見scale-measurement.md。

0.1.9至0.1.12新增live reader合併、任務工作台USD／Token、Run驗收／Agent子樹範圍及一般證據視窗鍵盤／延遲回覆修正；相應native流程同精確scope見各版本release-notes.md、STATE.md。呢啲已發布功能證據唔自動升格成全部F09／M3／14.5條文通過。

完整目標未完成。優先功能缺口，再補必要實機／resource證據；唔以較小release範圍替代原目標。

0.1.21補上F19明確按鈕account/rateLimits/read，包括多桶視窗／讀取時間／剩餘百分比／官方ordinaryUsageAllowed／Credits／可用reset數；production CLI唯讀回覆已成功，相關9項及隔離Electron流程通過，見account-limits.md及STATE.md。較早段落「完整帳戶即時額度未完成」由呢個有界讀取取代；帳戶寫入、主動reset、推斷完整餘額及完整歷史逐筆對帳仍未提供或未證明。

0.1.26已安裝；時間圖表逐格／分組／範圍解釋、帶時間失敗保留及私隱隔離已有
隔離及真實原生範圍解釋證據，見time-chart-explanations.md。用戶完成單項
鑰匙圈修復後，新版本實際啟動指紋可讀，原生AX及截圖一致。大型DB實機亦
捕捉到初期查詢排隊逾時後恢復，根因仍需定位，唔當成完整performance通過。

0.1.27–0.1.28已針對確認嘅Project分組／設備完整摘要重算／連續背景分析修正。
固定182442筆37組及同快照三設備比較完全一致，14.2秒→135.8ms／10.2秒→2.2秒。
21項相關分批檢查通過，0.1.28實際Settings載入Project及管理數據，返回總覽
圖表02:25:51HKT成功，冇之前排隊錯誤；指紋仍可讀。完整reference workload／
平台／長期p95門檻唔由呢條實機路徑推斷，詳見query-bottlenecks.md。

0.1.29補原17.2逐對差異缺口：明確選擇兩個變體、按Pair ID保留失敗／缺失／
重複試驗、signed exact分佈、固定ledger／price／calculation版本及報告。
10相關檢查及最終隔離6試驗3配對／552tokens／完整預覽逐字保存／私隱fence
通過。呢個係F13／F16嘅具體新證據，唔自動升格成完整M4或用戶真實試驗成功。
