# Context 與工具：按選取分析載入

實際舊頁面同時讀取工具排行、完整diagnostics、Context歸因、Client清單同壓縮分析，造成高負載時執行／排隊逾時。Read-only實際Metadata量度：6,899工具row嘅joined讀取1,874ms；同一實際toolActivity函式另一次6,900row／16組需2,764ms。唔據不同snapshot計speedup或p95；呢個只證明單獨排行可完成，而全頁有多項不必要嘅同期分析。

頁面改為五個入口：工具排行、工具明細、Context來源、Client清單、壓縮分析。只掛載選中入口；預設排行＋原有固定報告預覽，唔同步開始其他分析。工具明細直接用原有tools分頁query，而唔先跑完整diagnostics。來源導航、200筆分頁、Context來源drilldown、受控manifest詳情、lineage、compaction證據／Timeline及原有報告保持。

新工具明細狀態喺範圍／私隱改變時清除；原有即時／閱讀狀態保留。Navigation用可聚焦button／aria-pressed，五欄desktop、三欄及兩欄窄視窗。冇新原始內容同步或更改token／USD計法，查詢時限亦冇延長。

Build／typecheck／diff通過。隔離native工具流程涵蓋五入口mount/unmount、209調用／210工具識別、200＋10工具分頁、JSON／CSV預覽、來源導航、暫停／恢復及source generation，12-token帳本保持。原有Context歸因native流程經新入口核對文字origin、truncation、負數discrepancy及matched lineage，亦通過。首次script將invocation count當成含orphan嘅工具總數，分頁期望9實際10；另一script仍喺Context入口找Client drawer，改由Client入口查。修正只限驗收路徑，冇降低斷言或增加timeout。

Screenshot `/tmp/agent-monitor-context-workspace-smoke.png` 已目視核對；實際大型資料頁驗證另記acceptance，唔以fixture成功宣稱全部高負載或完整規格完成。

最終真實App AX／截圖一致，revision3317載入6918調用、41942238捕捉輸出bytes、138344參數bytes／34622文字估算／113有參數量度。查閱預設排行冇逾時；舊資料欠量度保持未知，0可比較指紋唔當冇重複。其他大型分析及持續負載仍需證據，唔據此宣稱全resource gate完成。
