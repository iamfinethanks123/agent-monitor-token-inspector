# 大型合成資料測量

規格18.1要求單次百萬記錄串流匯入及資源結果。重現入口為
`scripts/measure-scale.ts`，bundle成Node24 ESM後，傳入一個新的絕對目錄。
目錄有exclusive marker，唔可以指向既有測量資料或Monitor資料庫。

程式自己生成100萬行JSONL，寫入約1 MiB批次，唔將整個檔案載入記憶體。
固定資料分佈：普通message約1 KiB、100個约1 MiB記錄、10個超過2 MiB邊界
記錄、100個malformed案例、999個獨立response。預期有效Canonical小計
11,988 tokens；原始合成文字保留關閉。總量1,148,805,203 bytes，中位行1024
bytes。WorkloadSHA-256
`62c0b309fbe475ae7f2e0f10a88ab2e72dd01945582e4988b8216ee39290a5df`。
完整recordSizeCounts及期望值喺工作目錄workload.json。

Importer使用實際InspectorStore／IndexCollector／timeline，沿用32 MiB scan
budget及100-record transaction。記錄每個scan已處理bytes、行數、時間及OS
process.resourceUsage().maxRSS（KiB換bytes），唔只取定時器抽樣峰值。
匯入完成後必須核對100萬保留觀察、110個parse gaps及11,988-token小計。
再量度20次200-row Timeline同Run summary、重開／重讀不變，以及10秒內5次
無變更scan嘅CPU。result.json只在全部驗收步驟完成後輸出。

實際工作已於2026-10-15啟動喺Ubuntu Linux ARM64／Node24.21.0；4 logical CPU、
約24GiB RAM。User transient unit `agent-monitor-scale-20261015.service`，
CPUQuota100%（最多一個核心）、MemoryMax256MiB、Nice10、最長30分鐘。運行中修改到45分鐘被systemd拒絕（Cannot set property RuntimeMaxUSec），實際上限保持30分鐘；若到時未完成，以已提交游標續跑，唔重頭匯入。
只有synthetic工作目錄，唔讀Codex auth／配對／SSH檔案，唔連Dashboard，
唔改或重啟既有agent-monitor-collector.service。

呢個係headless受限記憶體測量，唔係規格4-core／16GiB Desktop reference host。
CPU quota、實際硬件及未符合嘅target要保留，不因為較低CPU配额通過部分結果
而自動推斷全部reference／renderer／事件可見時間驗收。

工作目錄 `/home/ubuntu/agent-monitor-scale-20261015`；原段unit mainPID3247504。
初步5 scans處理146,577筆／167,770,248 bytes，OS process peakRSS132,096,000
bytes。Cgroup memory連檔案快取達268,435,456bytes，唔與processRSS混同。
呢個係原段早期抽樣，唔當成百萬匯入完成。以unit ActiveState／MainPID／
ExecMainStatus／Result及result.json作終局證據，觀察逾時唔當成程序退出。

SourceSHA-256 `191e59ae6f0b4c154bb150f2c98c847746d2cf99a2140e4b82f14129723a4d23`；
bundleSHA-256 `4f10e40b74ba69e31a5def3ad0bfd42de225f19e398c43953967a448ad8470e2`。
本機證據位置/tmp/agent-monitor-scale-evidence-20261015；原始工作輸出及錯誤
保留在獨立progress.log／error.log，唔以預期值或測例manifest替代實際結果。


續跑入口：同一script傳入相同directory，第三參數`resume`；必須先確認前一個
unit terminal／MainPID不存在，唔可以兩個writer同時運行。會檢查exclusive
synthetic marker、workload schema／固定100萬筆／不保留原文、完整JSONL SHA
同bytes，再沿既有source cursor匯入。唔生成或覆寫source。報告明示resumed、
startingRecords／startingOffset、durationScope／peakScope=this_process_only，
唔將第二段時間／RSS當成整段總值。原先執行段嘅log及unit結果要另行保留。

原段曾由PID3247504運行，冇因為觀察或屬性修改失敗而重啟。當時抽樣
321,576筆／368,810,201bytes，OS peakRSS147,042,304bytes；app Collector active。
當時已上傳resume bundle但未執行：
sourceSHA `eb2c318349465fd2abc30a650e409063be7cce0e3f943422590254f12a0da1f2`，
bundleSHA `ef29c8f09dd26b96ac5aa891d1ddf8017b116c684e4d1cc731bc0149a7133ce9`。
原段30分鐘限制不變；工作未terminal前唔派第二個writer。

原段其後提交468,150筆／536,577,694 bytes，OS peakRSS147,283,968 bytes；
當時unit active/running，現有Collector active，冇終局result。


第一段unit已在UTC2026-10-14T21:40:37因RuntimeMax30min退出，Resulttimeout／
ExecMainStatus15／MainPID0，唔係OOM。unitMemoryPeak268435456包含filecache。
最後progress檔613699筆，但readonlyDB643424筆／游標737899247bytes／generation0，
dirty_scopes0，證明額外已提交進度亦保留。第一段unit／progress複本已保存。

核對第一段terminal及resume-bundleSHA後，獨立unit
agent-monitor-scale-resume-20261015.service已啟動PID3253871，同樣256MiB／
CPUQuota100%／Nice10／30min。Whole-source SHA驗證後，起點643424筆／
737899247bytes，最近700825筆／805007526bytes，第二段OS peakRSS129728512。
呢個係續同一輸入／資料庫，唔重頭匯入；原段及新段結果／峰值分開記錄。
以上係第二段早期抽樣，終局結果如下。

## 目前結果：匯入完成，查詢修正已安裝

第二段亦於UTC2026-10-14T22:14:20達30分鐘上限退出，Resulttimeout／
ExecMainStatus15／MainPID0。唯讀核對確認1,000,000筆觀察、110個解析缺口、
999個selected response及11,988 tokens。來源generation0／游標1,148,805,203
bytes到完整檔案尾，dirty_scopes0。第二段最後process peakRSS135,233,536
bytes；兩段cgroup peak均包含檔案快取，唔當成OS process RSS。

原程式未輸出result.json，因為後續查詢未喺剩餘時限完成。獨立唯讀計時以
相同1M資料及同樣一核心／256MiB限制，原200-row Timeline需27,297.5ms。
查詢計劃確認父子關係重複展開，四份全範圍統計亦重複掃描同一批記錄。

0.1.7把父子關係喺同一SQL内固定一次，分類／種類／Agent／缺時間統計改用
同一份分組結果；分頁仍保留完整範圍、未知時間及固定watermark／revision。
相同唯讀計時200行／完整1M匹配結果為6,650.1ms。7項Timeline相關檢查通過。
呢個係單次觀察，唔係p95，亦未達原300ms目標。

修正版Timeline source SHA-256
`a7c653982f935471cc61a9a53b6331287f3b70e50492a1519dc50a1f8e17c958`。
新finalize bundle SHA-256
`4093958ef114f67fbefb091740a733033950194a5cb56cbf8023740909b60b2b`。
原兩段terminal後，獨立unit `agent-monitor-scale-finalize-20261015.service`
沿同一1M資料做剩餘查詢／restart／idle量測；起點1M筆／完整游標，唔重新
生成或匯入。限制一核心／256MiB／10分鐘。正式Collector保持運行。
此unit已正常完成（MainPID0／inactive/dead／success／ExecMainStatus0），
UTC2026-10-14T22:39:46產生result.json。20次200-row Timeline p50為6,894.7ms、
p95為14,840.5ms、最慢22,051.6ms；Run summary p50為110.7ms、p95為117.9ms，
最慢6,377.7ms。Timeline速度目標仍未達到，亦存在超過目前15秒查詢限時嘅
尾端樣本；唔延長限時或把尾端樣本排除。

重開資料庫／來源重播維持1M觀察、相同revision及11,988 tokens。
5次無變更scan、約10.06秒觀察，單核心CPU均值0.093%；此finalization程序
OS peakRSS88,784,896 bytes。呢個係最後一段程序嘅峰值，唔代替兩個匯入段
未完成終局抽樣嘅完整process peak。三個執行段、硬件同limits保留分開。
result.json及finalize-progress.log已保存到本機證據目錄。原300ms Timeline／
reference hardware／100events/s visibility及全部平台／原生介面驗收仍開放。
