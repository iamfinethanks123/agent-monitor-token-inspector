# 模型／路線歸屬轉換

F15 要求逐 eligible response／interval 追蹤模型變化。總覽新增收合入口，
打開先讀取分析，避免每次 Dashboard 都載入大量明細。資料沿用全域 query，
列出 Requested、Observed、Provider、recorded service tier 同 Quota alias，
缺少欄位維持未知；沒有更改模型價格、帳本或 quota。

比較只喺相同記錄設備／來源／generation／Thread 內進行。全部位置都有
native ordinal 時用 ordinal，否則用 source record sequence；排序同時間
矛盾會標示。Source order 唔會冒充跨來源／跨設備實際執行因果。

逐位置將 metadata 分開判斷：兩端都有 Observed Model 而且唔同，先標為
observed model change；Observed／Requested fallback／證據程度改變係
attribution change；Requested 改變但 Observed 保持一樣係 configuration
change；其餘 Provider／tier／quota alias 改變係 metadata change。
未知模型、隔離／aggregate 或同一位置有矛盾歸屬會中斷比較。篩選可以隱藏
中間記錄，所以零結果唔代表所有實際請求都冇轉換。

同一位置有多個合資格成員而 metadata 一致時，用一個明示代表成員；唔會
把其成本當成全部位置嘅總成本。Interval 可能跨多個 request／model，顯示
嘅係該 interval 原有歸屬，唔係每次 request 嘅已確認模型。兩端 USD 用該次
價目分別換算，唔會推算「換模型額外成本」或自動節省。

全域計數涵蓋全部已選成員；明細最多顯示首 200 個來源串流候選，再依來源
時間排序，唔係全域最新 200。可以打開既有單筆帳本解釋，或清除來源篩選
定位單一 Timeline 證據。私隱變更立即清除目前結果同未完成 UI 請求；來源
資料仍然只讀，沒有內容傳送。

測試涵蓋 Requested／Observed／證據／tier 差異、亂序 native ordinal、
未知／隔離 barrier、來源串流／generation 邊界、同位置矛盾、200 上限外
完整計數、query 同逐筆 USD 不改帳本。隔離原生流程檢查收合入口、三種
轉換、帳本下鑽同 Timeline。
