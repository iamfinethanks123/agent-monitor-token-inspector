# 受保護內容指紋：狀態與手動重試

真實工具排行冇可比較指紋。只讀檢查確認 Monitor 自己嘅 `fingerprint.enc` 存在；既有helper等15秒仍未完成，結束後密文bytes保持相同。呢個只證明helper未完成，唔據此聲稱密文壞咗、用戶拒絕授權或OS鎖匙圈已重設。

helper新增有界JSONL階段：本機加密保護讀取前發出phase，結果仍只透過私有child pipe傳俾main。Main分清程序啟動逾時、加密讀取逾時、不可用、失敗及已可讀。Renderer只收state／phase，唔接觸key、ciphertext、原始錯誤或任意檔案路徑。

啟動仍只等3秒；之後Token帳本正常工作。「設定與私隱」新增明確手動重試，立即返回並喺背景最多等一分鐘，唔阻Dashboard。如果macOS需要用戶處理提示，由用戶喺系統完成，唔會要求聊天提供密碼。唔重設鎖匙圈或替換未能讀取嘅現有指紋；app退出亦結束helper。

讀到key後只由main傳入私有worker方法；renderer冇set-key方法。Collector後續新紀錄可用key做workspace equality，唔自動重解析或補寫旧觀察。成功讀取狀態代表本機key可讀，舊資料嘅比較覆蓋仍要另外核對；未知唔係冇重複。

4項實際WorkspaceSecrets／Collector檢查通過，包含split framing、3秒及手動60秒deadline、閉合狀態、malformed／oversize／duplicate拒絕、app退出清理、密文讀取失敗不寫入，以及舊觀察保持／新紀錄比較／12-token帳本保持。建置／typecheck／diff通過。原生入口驗證確認public資料只有phase/state、重試按鈕及冇renderer set-key；idle0通知／新增12->24／價目流程亦保持。冇為測試按用戶嘅真實重試或重新解析。

實際系統授權／讀取結果仍需本機確認，唔以模擬safeStorage／helper檢查宣稱鎖匙圈已修復。Ubuntu及Windows既有protected collector憑證冇改。

實際新入口首先確認protected-key階段逾時；用戶手動重試後回報成功，原生介面亦確認可讀。隨後readonly index由6946／0變成6948／2輸出指紋＋2參數指紋，證明新收集已啟用。舊資料未自動重解析，完整歷史比較覆蓋唔據此宣稱完成。

較新實況：用戶確認每次更新都重新提示，實際ad-hoc designated identity跟
cdhash改動。已改現有Apple開發憑證簽署及fail-closed packaging；兩個update
seals身份一致，憑證版已安裝且密文保持。首次新身份授權／實際再次更新讀取
仍需驗證，見keychain-update-identity.md；前述一次成功唔等於更新問題已解決。

2026-10-16最新結果：用戶已自行完成審閱同批准嘅單項partition修復。
receipt／唯讀metadata核對通過；0.1.25原程序仍逾時，但正常退出／安裝
同簽署0.1.26後，原生AX及實際可見畫面均顯示已成功讀取本機指紋。
保留原有密文，未自動補寫歷史；詳細界線見keychain-update-identity.md。
