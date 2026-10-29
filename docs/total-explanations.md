# 解釋 Dashboard 總數

總覽「解釋總數」固定點選時嘅帳本版本、已知 Token 小計及美元價目。初次
核對版本／價目／顯示值不符會拒絕開啟舊數字嘅解釋；可以明確改用最新快照。
USD 係 API 等值估算；未定價、缺少分項、Cache／Reasoning 子項同隔離成員
維持原有意義。沒有更改任何 accounting policy。

快照包含所有符合 canonical query 嘅 selected／quarantined 成員 ID 及各自
不可變 revision，以及相關保留 usage measurement ID。每頁 50 筆，可以
按計入狀態查看成員，或核對來源量測。正常 append／換價目唔會改寫既有
快照或逐筆成本；來源刪除、私隱／重新解析會失效。只保留記憶體 references，
最多四個快照、每個 20 分鐘；超過 100000 成員／200000 量測會明確拒絕，
唔會靜默截短後聲稱完整。

來源範圍係符合原始量測 timestamp/model/identity query 嘅紀錄，另加被選
成員嘅必要支持。Counter interval 嘅較早端點可能喺日期／模型範圍外，會
保留作支持。來源量測行數、帳本成員數、逐次 request 人口係唔同分母。
Raw counter 唔會逐點相加；只計入 canonical interval／aggregate。部分
來源可能尚未成為快照成員，呢個狀態唔代表已確認零成本或可省用量。

同一 response identity 嘅多筆來源支持只計一筆 canonical 成員；額外支持
可能係重播或補充缺少欄位，唔會一概聲稱係相同內容、跨設備複製歷史或浪費。
Quarantined response/counter 支持會分開顯示。每筆成員可打開現有解釋視窗；
來源 Timeline 明示會清除來源篩選，保留記錄設備及單一 evidence target，
避免隱藏必要嘅早期支持。呢個入口冇新增原始內容讀取或匯出。

測試包含 53 成員／57 量測嘅完整分頁、replay/control 不重複加總、美元逐筆
總和、append／換價後固定頁面、版本／價目／值變動、範圍外 counter 支持、
隔離量測、缺少 usage、Workspace 隔離及私隱／reparse 失效。隔離原生流程
檢查兩個分頁入口、來源角色同逐筆下鑽，唔會替代全 F02/spec 驗收。
