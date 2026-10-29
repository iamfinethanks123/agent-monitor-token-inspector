# 工具輸出分段格式

2026-10-14，F01／F03／F04／F06／F18：修正工具輸出只接受 string，漏量度 runtime 實際使用嘅 typed parts 清單。依據係本機已授權來源嘅 bounded readonly shape inspection，無複製或輸出原始內容。

## 已確認問題

當時本機 tool index 中4,711筆 custom_tool_call_output同1,143筆 function_call_output未有 outputBytes。抽查最近24個來源指針、最多4MiB／每行2MiB，全部 output 都係 list，包含 input_text及部分 input_image。唔係根據缺少欄位猜測原因。

套用新解析器做同樣範圍嘅 readonly驗證：24／24能量度文字，共150,345個已捕捉 UTF-8 bytes、2個圖片分段、0個未支援輸出、0個來源指針不符。呢個係樣本證據，唔代表所有來源已重解析或全部模型輸入可見。

## 行為

- 保留原有 string輸出及其fingerprint。已知tool result清單支援 input_text／output_text／text文字，image及audio類型分開計數。
- 只加每段實際文字 bytes，唔加人為分隔符、JSON容器、圖片URL／base64，唔由圖片大小猜Token。純圖片輸出冇文字估算；缺少／null亦唔當成零。
- 分段fingerprint係workspace-keyed完整captured parts表示，保留順序／邊界／media，與舊string表示分開。冇安全儲存key就保留未知，唔降級成global明文hash。
- 截斷標記保留；只接受唯一可識別process handle及可分配exit code。多handle、不同exit code或未支援分段時唔猜單一執行狀態。
- 未知分段只記閉合 UNSUPPORTED_TOOL_OUTPUT_PARTS，未支援output物件／scalar記 UNSUPPORTED_TOOL_OUTPUT_FORMAT。已知文字仍可量度，但完整度／整段fingerprint未知；完全未識別嘅輸出為unsupported。來源及樣本會显示partial／具體原因。
- Context可分開顯示非文字分段；工具排行／reports用同一份已捕捉文字metadata。唔改模型用量、cache、reasoning、價格、wire-v2 allowlist或原始來源。

## 歷史與驗證

既有觀察不會被掃描自動改寫。既有重新解析流程先核對原始digest及授權，寫新analysis revision，再原子發布；無法核對者保留舊有效版本。原始log不改動。安全儲存key不可用時，相同內容／重複比較能力保持未知。

20項相关工具／Context／Retry／sample／diagnostics檢查通過；之後新增不同exit code及部分未知process限制，7項相關檢查通過。隔離原生App先模擬舊未量測資料，再用設定頁重新解析：6個調用／6個輸出，其中5個文字有量度、46 bytes、14估算tokens、4個圖片、1失敗、1截斷、1未知完整度。帳本保持12 tokens，來源bytes不變，metadata JSON無私密marker。原生fingerprinting不可用，所以重複比較正確保持未知。

初次原生斷言假設strong和small之間有文字空格，實際DOM係46bytes；修正為核對實際數字元素，完整流程重跑通過，屬fixture斷言問題。Build／typecheck／diff／script syntax通過，截圖已檢視。Logs：`/tmp/agent-monitor-tool-output-parts-final-tests.log`、`-final-process-tests.log`、`-final-build.log`、`-native-final.log`。

Mac／Ubuntu／Windows package更新及真實歷史重新解析結果見acceptance最新段。Windows保持手動、未運行。新功能唔等於完整所有runtime／來源／平台驗收。
