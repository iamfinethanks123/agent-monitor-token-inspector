# 設定頁與設備總數嘅慢查詢

0.1.26實機曾顯示devices QUERY_TIMEOUT、device-activity／time-charts
QUERY_QUEUE_TIMEOUT。單個背景工作使用同一個SQLite worker，所以慢讀取亦
會令其他查詢等待。唔將所有逾時自動歸因同一方法，亦冇延長執行／排隊時限。

## 已確認及修正

設定頁privacy()會按Project統計全部retained observations，原本每次讀取
normalized JSON抽取Project。相同Electron執行環境、真實資料庫唯讀量測
為21,680.5ms，超過15秒執行時限。加入observation_project_privacy expression
index，內容只係workspace、原有Project分組值及source ID；原本SQL及分組
語義保持，包括未知身份、多來源同原始觀察分類，唔換成另有reparse語義嘅
Timeline投影。沿用現有additive index/table初始化模式，user_version保持11。
首次開啟建立索引會讀一次既有資料；之後SQLite自行維持，舊版亦兼容。
唔改原始觀察、帳本、來源檔案、私隱政策或資料保留期。

設備view()原本逐部呼叫完整summary，只取total；每次仍計全部元件／來源／
隔離數同其他不需要嘅摘要。之前真實三設備唯讀量測為11,341ms，實機亦捕捉
到超過執行時限。改為一次讀取目前selected ledger membership嘅total欄位，
按記錄設備使用bigint／既有integer上限規則累加。冇SQL浮點SUM，冇加入
quarantine、舊revision、Cache或Reasoning子項。零保持0，全部未知或冇記錄
保持null。設備身份／時效／接收確認及usageRevision沿用原有view。

## 針對驗證

- Project測例先確認冇索引時查詢計劃失敗；新索引後9項既有／新增Project
  私隱檢查通過。覆蓋現有DB重開補索引、多Project／未知／同Project兩來源、
  原始觀察及schema／帳本版本／60tokens保持。初次比對遇到SQLite null
  prototype列與一般物件唔同；只將expected row轉普通物件，保留全部欄位斷言。
- 設備測例先確認舊view仍呼叫完整summary；新query後5項設備／transport
  檢查通過。包含兩設備用量加一個未收集設備、超過2^53精確整數、零、
  缺少Total部分同不合法Cache隔離。原本只有native total嘅部分維持canonical
  unknown，唔由原生控制值猜新用量。冇改Canonical算術。
- Build／typecheck／既有24案detector gate／diffcheck通過。
- 真實資料庫固定watermark182442嘅原query基線：182,442筆／37組，14,239.8ms；
  保存分組結果digest，安裝後以相同watermark核對索引結果。
- 同一個Electron唯讀transaction／rev4248，三設備新總數同舊summary逐項完全
  一致：原讀取10,206.7ms，新讀取2,175.2ms。只係呢個固定快照嘅一次比較，
  唔推斷全部冷查詢或p95。結果存於tmp/device-totals-comparison.json。

## 安裝及實際結果

0.1.27已正常退出／安裝，8個runtime吻合，簽署身份保持，指紋密文保持；
原生設定頁仍顯示成功讀取。ASAR SHA-256：
9c24fa113ab1d2ce410e0cdc0c1cc152419fcacbae49b99b22d67c0026ab0d1a。
回退App保留於release-inspector/before-query-bottlenecks-20261016。

實際啟動完成新索引，schema仍11。相同watermark182442／182442筆／37組嘅
分組digest完全一致：739a35a25a52733edee9ee3da18005aed0007ff86b10e6b63310080870a03c22。
相同Electron執行環境，原SQL由14,239.8ms變成135.8ms；目前全privacy()
讀取43.8ms，37個Project組。EXPLAIN確認使用新索引。

原生總覽已讀到rev4250及API等值成本，Settings切頁及指紋可讀；但部分設定
資料仍待佇列，未取得全部Project表單已載入嘅原生證據。呢兩個慢查詢已各自
驗證修正，唔等於整體佇列／全部p95或完整規格驗收完成。下一步定位背景分析。

## 0.1.28：背景分析分輪處理

其後0.1.27原生Settings仍捕捉prices／privacy／experiments排隊逾時，唔以
單獨查詢已快當成整體已恢復。對目前大型Run嘅完整analyze()唯讀量測為
19,964.6ms；另一次SQLite子查詢計時總共11,949.8ms。只讀metadata／函式
計時，冇執行recordFindings或對真實DB寫入。主要時間分散喺工具／Retry／
Compaction及message讀取，唔係單一Project分組。併發／cache條件唔同，
唔將兩次讀取數字當成p95或直接量得目前worker整輪耗時。

背景checkAlerts原本每輪最多連續處理4個完整來源；0.1.28改成每輪最多1個，
成功transaction後保留記憶體內round-robin位置。未處理來源唔前移checkpoint，
下輪由上一來源之後開始，持續新增嘅來源唔會令其他來源永遠排唔到。
checkpoint／保存發現仍喺原有transaction一齊提交，失敗唔前移continuation。
保持同步API；完整手動分析、偵測規則、通知cooldown、歷史quiet及budget
語義保持。背景來源可能較遲完成，唔聲稱所有來源已同時完成分析。

新增三來源檢查先確認原版一輪建立3個發現；修正後每輪1個，忙碌來源有新
append仍輪到其他來源，4輪後全部checkpoint追上、忙碌來源4次recurrence
保留，冇生成模型Token。7項Alerts／Budget檢查、build／typecheck／24案
detector gate及全caller搜尋通過。

0.1.28已正常退出／安裝，8個runtime吻合、穩定簽署及密文保持。ASAR：
fc1c2182f325a58594d46fea3f137f174b7962109397178bd8626842464e1788。
回退App保留於release-inspector/before-alert-scheduling-20261016。
原生總覽已載入rev4258及API等值成本，設定頁指紋仍成功讀取。其後實際
Settings成功載入Project選擇、未知Project87027筆／40來源及193管理記錄，
冇先前prices／privacy／experiments排隊錯誤。開啟清單再Escape保留原選擇。
返回總覽後，圖表成功讀取於02:25:51HKT，冇先前圖表排隊錯誤。
呢個係實際新版本嘅Settings→Overview操作路徑成功，唔擴展成全部工作量／
長期p95或每種冷啟動嘅聲明。完整資源及平台量測門檻仍保持。
