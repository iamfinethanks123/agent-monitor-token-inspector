# 設備活動與用量更新

三設備接入後，心跳、解析健康快照及政策確認原本使用同一個changed事件，
令總覽重新讀取summary、analytics、USD、scope及其他資料。呢啲活動冇改
Token帳本，唔應觸發全部用量重查。

Receiver新增devices-changed通知，經worker／service／preload送到設備介面。
Heartbeat、health、憑證讀回確認、離線簽署登記及Client政策／刪除receipt
使用呢個通知。新用量batch、配對／新增／撤銷、gap及離線匯入保留原有
資料更新；私隱資料失效仍走原有guard。

唯讀device-activity IPC只讀設備、健康及政策／刪除確認資料，唔讀summary、
ledger或USD。結果冇用量total；介面保留上次完整設備快照嘅total同
usageRevision，未有完整快照唔會由活動推算用量。設備頁明示用量係最近
核對版本，連線／政策可以獨立更新。

Root同設備頁合併進行中活動查詢；每分鐘亦查活動，令全部Client停止後嘅
過期在線狀態會更新。時間圖表本身既有60秒rolling刷新保留，新用量仍透過
原有changed即時更新。舊API／測例缺少新method時保持原有資料通知模式。

6項相關檢查通過，重現原本兩個無用量活動發出兩次data-change；新路徑
只發devices-change，revision不變。測試將summary設成throw，活動仍可讀，
證明輕量路徑冇隱藏總量查詢；UI合併保留12-token小計及其版本。政策及
憑證確認刷新亦有獨立檢查，原有metadata-only／replay／revocation guards通過。

隔離Electron以真實HTTP配對、heartbeat及health，確認設備／總覽更新而
主summary IPC查詢次數為零，帳本12及1-minute圖表仍可查。測例一開始把
health數量錯寫成字串，原有validator正確拒絕；只修正測例，冇放寬contract。
截圖/tmp/agent-monitor-device-activity-native.png已目視核對。

呢個修正減少無用量活動觸發嘅重查，唔等於已量度完整p95／持續CPU／
million-record／renderer memory門檻，亦唔代替用戶Mac嘅實際畫面驗收。


0.1.4已安裝；8runtime files與build一致，既有certificate身份不變，原有cipher
保持。實際唯讀repository查詢（唔係live IPC／reference dataset）50次，3設備，
12 logical CPU／16GiB：p50 0.307ms、p95 0.440ms、max5.626ms。冇Token total。
原有隔離native idle／append驗證亦通過：無新資料冇data-change，新增來源令
總覽12→24，價目狀態保留。更新後Ubuntu及Windows有新認證連線。
實際Mac畫面仍等之前manualunlock回覆；唔由隔離截圖推斷用戶畫面。
