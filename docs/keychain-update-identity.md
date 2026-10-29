# macOS 簽署與安全儲存

Inspector 使用 Electron safeStorage 同 macOS 鎖匙圈保護本機資料。應用程式簽署身份與既有鎖匙圈項目嘅權限係兩個需要分開驗證嘅條件。

## 本機打包

`npm run dist:inspector` 會執行 `scripts/package-inspector.mjs`，讀取忽略於 Git 嘅 `electron-builder.local-signing.json`，核對使用者自行設定嘅既有 code-signing certificate，再打包 macOS ARM64 Inspector。

本機設定需繼承 `./electron-builder.inspector.yml`，提供 `mac.type`（development 或 distribution）及有效憑證 SHA-1 selector 作為 `mac.identity`。憑證與身份需由你自己設定，唔應複製其他人嘅 Team ID、selector 或授權規則。

打包入口會拒絕無效／不可用身份，核對 deep／strict 簽署及穩定 designated requirement，唔會退回 ad-hoc。此入口係本機開發簽署流程，唔代表已完成 Developer ID 公眾分發或 notarization。

## 更新後嘅鎖匙圈提示

舊 ad-hoc 簽署可能令每次版本內容改變時身份一併改變。採用穩定簽署身份可以處理呢類更新問題；但舊項目仍可能只信任先前身份，鎖匙圈狀態或讀取限時亦可以造成逾時。

`node scripts/check-keychain-identity.mjs <old.app> <new.app>` 可以核對 bundle 簽署身份；通過呢個檢查唔等於實際鎖匙圈讀取已獲准。仍需自行處理 macOS 系統提示，再喺 App 明確重試，確認實際讀取結果。

歷史開發環境曾經批准並完成唯一 Monitor 項目嘅定點權限修復，保留其他規則同密文，後續版本實際可讀。該機器專用修復腳本、Team ID、ACL、密文指紋及操作日誌只保留喺本機；本倉庫不提供通用修復指令，亦不要求重設鎖匙圈、匯出私鑰或授權所有 App。

未取得受保護金鑰時，App 應保留證據不足狀態，唔應以明文替代或自動重新解析歷史。一次成功讀取亦不保證所有未來版本都不再提示。

來源：[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) 及 [Apple Code Signing Guide](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/AboutCS/AboutCS.html)。
