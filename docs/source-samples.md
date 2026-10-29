# 本機來源樣本檢查

「設備與來源」新增獨立檢查入口。使用者經原生檔案選擇器揀一份 `.jsonl`，
檢查結果只留喺該畫面記憶體，唔會加入 root、來源、帳本、Collector spool
或配對資料；取消／清除唔會改動原始檔案。入口唔提供原始內容預覽。

讀取上限係首 4 MiB、512 個完整換行記錄，每行 2 MiB。未完整／被 prefix
切開嘅尾段唔會解析；行數／bytes／超大行／格式問題／未支援行同限制全部
明示。讀取期間檔案 size、mtime 或位置身份有變，結果標示 partial。
沒有資料只代表樣本範圍未觀察到，唔會變成零 Token 或整份來源無活動。

沿用 `codex-passive/1` 同 lossless integer parsing，列出用量觀察、逐回應
身份、Input／Output、Cache Read／Write、Reasoning、工具配對、Parent
連結、壓縮、模型資料同來源時間。欄位有記錄但語義驗證未能採用會獨立標示。
工具配對只承認同一 Thread 下唯一 call/result ID；重複 ID／未配對保持
partial，唔當成工具失敗。Context manifest 由現有 instrumented 入口處理，
呢個 passive Adapter 唔會聲稱已觀察到 instrumented request inclusion。

Ready 只表示完整檢查範圍有有效身份／Input／Output 回應，唔係所有欄位
或來源人口已知。Legacy counters 保持 partial；未知格式保持 unsupported。
來源 Runtime 係已記錄、可辨認嘅版本，缺少時未知。檢查主機 OS／architecture
係目前 Inspector 主機，唔會推斷來源最初執行設備。Schema fingerprint 最多
顯示 32 種，另列完整種類數目；唔包含欄位值、路徑、模型／Session ID、
prompt、程式碼或工具內容。沒有計算任何新 Token 總數。

檔案只讀、拒絕 symlink leaf／非 regular file／其他副檔名，並核對開啟前後
位置身份；permission_denied／unavailable 有清楚結果，唔會要求管理員權限。
私隱更新或 component 關閉會清除結果並丟棄較早 UI 請求。一次性使用者選擇
係 metadata 檢查，唔係重新啟用已排除來源或繞過原始預覽限制。

針對性測試涵蓋 legacy、rich、工具 namespace／重複 ID、未知 schema、
數值語義、bytes／記錄／行大小限制、未完整 UTF-8、權限、symlink 同原檔
不變。隔離原生流程使用真實 sampler，檔案 chooser 回覆由測試提供；冇 mock
檢查結果。額外獨立檔案帶有大量 usage 仍不會新增帳本／來源。
