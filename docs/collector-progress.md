# 無變更巡查與 Dashboard 更新

## 問題與修正

IndexCollector 原本每次巡查 `.jsonl` 檔案後，都可在 750 ms 節流窗口以外呼叫 onProgress，即使 indexFile 因游標／mtime／大小完全冇變而提早返回。Worker 將呢個通知轉成 inspector:changed，令統計、價目、圖表及其他可見分析重跑。帳本本身冇因此增加 Token，但產生不必要嘅查詢。

而家 indexFile 會回報有冇實際處理來源；未變及排除來源回傳 false，完成 cursor commit 回傳 true。只有 true 會發出受節流嘅進度通知。Worker 原本完成 scan 後嘅 revision／observation／錯誤 signature 邏輯保留，新資料、空檔來源及 partial tail 完成仍然可見。Reparse 嘅進度通知保持原流程。No-change scan 唔代表阻止人工 Refresh。

呢個係 Monitor UI progress 修正。Headless Collector 冇註冊 onProgress，原有 wire／配對設定／帳本政策及資料庫 schema 冇變；已運行遠端唔需要為此更新。

## 證據

2026-10-14：先加入回歸案例，未修正版本嘅五次無變更巡查收到一次錯誤通知（預期零）；修正後通過。三項 progress 回歸加十一項既有 accounting 測試，共十四項通過。覆蓋 idle 無通知／無 revision 增加、partial tail 完成後更新用量、空來源新增即使 Token 不變仍通知。

隔離原生 Electron IPC 流程：固定資料下跨多輪約 5.5 秒 scan，收到零 inspector data-change 通知，revision／12 tokens 不變；追加 response 後收到更新，Dashboard 顯示 24 tokens。呢個係固定本機 fixture，唔係真實 active workload 嘅 CPU 降幅或跨平台資源保證。

設定頁亦由固定 Unpriced 改成沿用目前範圍同 revision 嘅 currentUsd，顯示 automatic／自訂／未啟用／讀取中及 priced/unpriced counts，唔另做一次計價。

最終隔離介面流程亦確認設定頁顯示 Automatic model pricing 同該 fixture 嘅兩筆未定價記錄，唔再顯示固定 Unpriced。最終 build/typecheck、相關檔案 syntax／diff check 通過。

2026-10-14 歷史修正：真實繁忙 Findings 出現 devices／incidents QUERY_TIMEOUT，當時Worker索引通知改為10秒合併。其後加入分頁範圍暫存、按需分析及單次load限制；0.1.9再將合併縮至100ms、Desktop巡查縮至1秒，回歸結果及大型負載界線見[live-event-visibility.md](live-event-visibility.md)。首次scan完成仍即時通知，stop清除timer，冇變更仍唔通知。Receiver／私隱／設定直接通知及查詢時限保留。
