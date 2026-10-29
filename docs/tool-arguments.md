# 工具參數與返回輸出分開分析

`Context 與工具` 嘅工具排行新增已記錄參數文字、獨立文字估算，同逐工具量測覆蓋。六格統計同排行將參數、工具返回輸出及重複輸出分開，仍按完整選取範圍計數，唔受逐筆工具分頁限制。

只量度已支援 `function_call.arguments`／`custom_tool_call.input` 字串嘅 UTF-8 bytes，估算使用 `approx-utf8-bytes-div4/1`。空字串係已觀察零 bytes；缺少、非字串或舊分析冇相關量度係未知。衝突調用唔加入參數小計，未配對返回輸出唔會猜參數；大整數彙總用 bigint／十進位字串。

呢個係來源已記錄嘅參數文字量，唔係官方模型生成 Output Tokens，亦唔係後續模型 Input／Cache／美元成本。JSON／Markdown／CSV 彙總保留數字、覆蓋、estimator、adapter、policy、ledger revision及observation watermark；唔保留或輸出參數原文、完整路徑或內容指紋。原有 Project 匯出限制／固定預覽及 CSV 防公式仍然適用。

新資料直接有量度，舊資料保持未知，直到用戶選擇既有重新解析功能。唔自動重跑大型歷史。已選 metadata-only 遠端 wire 仍只傳核對用量；呢次冇擴大遠端同步內容，Ubuntu／Windows 唔需為純本機工具分析重新部署。

10 項工具／typed output／Context 相關檢查通過，包含中文／Emoji、空／缺少／非字串、衝突、exact bigint、範圍／安全報告同隔離歷史重解析。隔離 native app 驗證207調用／208工具識別，7,400參數bytes／1,851文字估算、419,853輸出bytes，JSON／CSV預覽、來源導航同暫停／恢復；核對帳本維持12Tokens，原始fixture bytes不變。建置／typecheck／diff檢查通過，六格版面已目視核對。Fixture 成功唔代表真實歷史全部量測或完整規格／平台驗收完成。
