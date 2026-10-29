# Timeline 固定範圍暫存

0.1.7每次200行分頁仍會重建完整父子關係及統計；同一1M記錄資料，20次
查詢p95為14.84秒，最慢22.05秒。呢啲係完整查詢，唔係只有200行資料讀取。

0.1.8每個SQLite connection只保留一份目前查詢範圍，放喺SQLite TEMP tables。
範圍包括workspace、篩選身份、watermark、帳本revision、privacy／analysis版本、
日期界線同Finding證據。翻頁游標及頁面行數唔改變範圍；滾動days視窗會用
已捕捉時間作身份，所以無新資料時亦唔會錯用較早視窗嘅結果。

父子關係以watermark之前每個machine／thread嘅最近記錄建立，只做一次。
分類統計亦只掃一次完整範圍，之後SUM／種類／前100個Agent讀取暫存分組。
事件行仍直接由索引、目前已保留解析及固定帳本版本分頁取得。unknown thread
嘅來源回查、unknown時間、全部匹配事件及各lane小計保留；唔靠抽樣減少資料。
切換範圍會清理舊暫存；建立失敗先取消cache身份，唔會重用未完成嘅分組。

TEMP table喺connection關閉後消失，唔新增main schema或改寫原始logs。SQLite
預設TEMP_STORE=1可用磁碟暫存，唔把所有事件或全部Agent列入JavaScript RAM。
metadata／facet查詢仍最多返回100個Agent；事件分頁唔受呢個顯示上限限制。
原有私隱／重新解析游標失效規則保留。

11項相關檢查通過。新增覆蓋同快照翻頁冇完整歷史重掃、caller改動結果唔影響
下一頁、child改父節點後舊cursor保持原範圍、切換scope後可重建舊快照、
connection更換及main readonly，以及無寫入嘅滾動日期視窗。冇重跑全套測試。

修正後精確source SHA-256：
`8097d109d375b086cd5ae68f84dd89010c390ffb277aa0592380021cd95d01c4`。
量測bundle SHA-256：
`0fd79944d5b29883aec81bc9a82f380b532cfbce3a01fe01bb46f748778f209a`。

相同Ubuntu合成1M資料、唯讀main DB、一核心／256MiB限制，第一次建立scope
為3,723.2ms；其後20個連續200行頁，p50 15.3ms／p95 18.4ms／max20.1ms。
總共讀至sequence4200，匹配總數一直1M，OS peakRSS67,325,952 bytes。
unit正常完成，正式Collector保持active；result保存於
`/tmp/agent-monitor-scale-evidence-20261015/timeline-pages-result.json`。

呢個係首次建立scope與連續翻頁嘅分開測量，唔係20個不同cold篩選，亦唔係
4-core／16GiB Desktop reference硬件驗收。冷查詢、100events/s可見時間、
全部原生平台／介面／a11y及完整規格gate仍需獨立證據。
