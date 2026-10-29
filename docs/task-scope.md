# 任務允許工作範圍

F09嘅Task contract除objective／acceptance／environment之外，而家有獨立
permittedScope備註，最多4000字。由使用者輸入，唔解析成Shell、路徑授權或
程式權限；原有本機Benchmark sandbox及明確執行預覽維持獨立。

新表單可以填允許改動、保留介面或排除項目。未填及舊合約維持未記錄／
未知，唔補上猜測範圍。保存後係immutable合約record；試驗仍按contractId／
revision引用，唔以新備註改寫舊試驗。匯入試驗同選擇Benchmark合約時顯示
已保存範圍，避免只睇到另一個待覆核執行嘅合約。

內容可能包括敏感項目，報告預設排除。只有includeTaskNotes明確選取後先
加入JSON／Markdown，沿用redactText及Markdown escaping。唔加入metadata
sync、通知或CSV試驗數值表；未知冇當成已核實限制或新增權限。

14個experiment／Project privacy相關檢查通過：新field保存、無效型別及長度
拒絕、預設排除、明確notes包含／秘密遮蔽，以及原有品質優先／失敗人口。
測例原先冇選新contract報告同未處理Markdown下劃線escaping，只修正測例
selection／期待，冇放寬產品私隱guard。

隔離Electron表單經真實IPC保存，合約／Benchmark顯示、文字script不執行、
notes選擇／遮蔽通過。首次Benchmark提示引用待覆核執行合約，真實介面
測例找到，已改為準備執行選取嘅合約。原始測量資料、用戶權限、憑證及
上游Codex紀錄冇因呢個功能更改。實際用戶畫面仍等既有Mac解鎖確認。

0.1.5已安裝；8runtime files同build一致，簽署身份及受保護指紋不變。
原生隔離截圖已目視核對，範圍欄位沿用表單樣式及完整行寬；真實Mac畫面
仍等原先manualunlock回覆。更新後Windows／Ubuntu有新認證連線。
