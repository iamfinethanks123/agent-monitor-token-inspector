# 長 Timeline 鍵盤與記憶體情境

規格14.5要求鍵盤、可讀焦點、唔只靠顏色及bounded rendering。原本Timeline
選取只改CSS class，冇可存取selected狀態。事件按鈕新增aria-pressed，選取
詳情polite live region；viewport明確focus outline。未選中時方向鍵從第一行
開始，Home／End仍以目前200-row頁面作界線。textarea亦沿用表單focus outline。

冇更改帳本、排序、來源身份、分頁snapshot或權限。虛擬列表每次仍最多10行。
Selected detail可指向之前選取事件；頁面導航唔以CSS selected狀態推算帳本。

隔離Electronscenario生成10,000個約1KiB訊息加1header，實際索引及Timeline
API，冇把真實trace放入場景。核對10,001matched、第一行、未選中ArrowDown、
Home／End到本頁第200行、latest第10001行、下一批第9801行及最多10DOM rows。
原測例重現aria-pressed缺少；修正後通過，viewport outline亦核對。

四個render階段（first／keyboard／latest／next）以Electron app.getAppMetrics
Tab process memory量測。工作集／已觀察峰值單位KB換bytes，冇把JS heap當
全renderer記憶體，亦拒絕空或全零metric。Mac ARM64本機情境實測
186,023,936 bytes（約177MiB）最大工作集，低於初始1GiB目標。
證據/tmp/agent-monitor-timeline-renderer-measurement.json及
/tmp/agent-monitor-large-timeline-native.png（已目視）。

呢個係目前code嘅文件化10k selected-run scenario，唔係全部工作區、actual
user screen、所有尺寸／screen-reader實機、所有tab或長時間leak stress驗收。
完整可及性及其餘資源target仍需對應證據，唔以此宣告全規格完成。

官方metric定義： https://www.electronjs.org/docs/latest/api/structures/memory-info 。

0.1.6已安裝，8runtime files同build一致，既有certificate及指紋密文保持。
新ReceiverPID51218／9897，Windows同Ubuntu更新後有新認證連線；
用戶Mac當下畫面及screen-reader仍等先前解鎖回覆，未由隔離圖像推斷。
