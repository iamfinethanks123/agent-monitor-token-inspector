# Agent Monitor Token Inspector

以 **Agent Monitor** 為主體嘅桌面用量分析工具，整合 Codex Token 帳本、多設備 Collector、Agent 圖與 Trace、美元估算、調查及實驗比較。

**保留版本：0.1.29 · 專案已於 2026-10-30 結案，停止主動開發。**
這是供研究及參考嘅本機內測版本；完整規格及跨平台驗收未完成，詳細限制見 [專案狀態](STATE.md)。

## 主要功能

- **統一 Dashboard**：用量及成本總覽、設備／Project／模型篩選、分鐘至整日趨勢、快取及輸入／輸出分析。
- **可追查帳本**：保留用量來源、已知／未知欄位及核對版本；區分 response、interval、aggregate 及控制計數，避免重播或子項重複相加。
- **Agent Monitor 整合**：任務親子圖、節點詳情、完整 Trace、工具輸入／結果、搜尋及模型用量細項。上游支援 Codex、Claude Code、Pi 及 Hermes；新 Collector 帳本以 Codex 為主。
- **多設備 Collector**：macOS、Windows、Linux 統計集中到桌面 App；新增設備、匯出一次性配對、加密待傳佇列、離線匯入及撤銷。
- **調查與品質**：Timeline、工具／Context／Retry／Compaction 分析、解析缺口、來源進度、診斷及固定快照報告。
- **任務與實驗**：驗收條件、試驗快照、逐 Pair ID 比較、本機 Node 驗收預覽與執行，以及 JSON／Markdown／CSV 匯出。

美元數字係按可用模型價目計算嘅 **API 等值估算**，唔係 ChatGPT／Codex 訂閱帳單。未知模型或缺少必要欄位會保留未知；官方帳戶累計同本機已收集帳本嘅涵蓋範圍可能不同，不能直接視為相同總數。

## 從原始碼啟動

建議使用 **Node.js 24 同 npm**。先安裝依賴及建立本機程式：

```sh
git clone https://github.com/iamfinethanks123/agent-monitor-token-inspector.git
cd agent-monitor-token-inspector
npm ci
npm run build
npm start
```

開發模式使用 `npm run dev`；型別檢查使用 `npm run typecheck`，測試使用 `npm test`。
這些指令為提供嘅工作流程，唔代表所有跨平台情境已通過驗收。

`npm run dist:inspector` 係 macOS 本機簽署打包入口，需自行設定既有簽署憑證，見 [簽署說明](docs/keychain-update-identity.md)。此版本未提供公眾公證安裝包；上游下載連結屬於原版 Agent Monitor。

## Collector 與資料私隱

喺主 App「設備與來源」新增 Client、匯出一次性設定，再喺 Client 匯入及啟動 Collector。遠端連線需自行提供 SSH tunnel 或 HTTPS；接收端預設只監聽本機。

- [同步、佇列及刪除傳播](docs/collector-sync.md)
- [Windows 手動啟動](docs/collector-windows.md)
- [Linux service 範本](collector/agent-monitor-collector.service)
- [離線統計交換](docs/offline-collector.md)

Collector 只同步用量統計及設備／Session／Project 識別 metadata，唔傳 Prompt、原始工具輸出、程式碼或完整路徑。本機 Trace 閱讀同選擇性內容功能另有私隱邊界。配對檔、憑證、原始 traces、真實用量資料庫、本機簽署設定及安裝產物均排除於版本控制。

## 文件

- [結案狀態、已知限制及驗證範圍](STATE.md)
- [功能與版本紀錄](docs/release-notes.md)
- [未完成／未證明項目](docs/remaining-work.md)
- [指定規格](docs/spec-reference.md)
- [原版功能整合](docs/agent-monitor-integration.md)
- [公開整理說明](docs/publication.md)

## 來源與授權狀態

本整合以 **Melvin Vivas** 嘅 [donvito/agent-monitor](https://github.com/donvito/agent-monitor) 為基礎，保留上游公開歷史，基線為 `988a28fb9d5bb73597aaa80220a550eda05879dc`。

截至 2026-10-30，上游倉庫未提供 LICENSE，GitHub 回傳 license 為 null；本專案未擅自新增 MIT／Apache 等授權。公開可閱覽不等於已取得任意再分發或商用許可，見 [來源盤點](docs/baseline-audit.md) 及 [GitHub 授權說明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)。

## 上游 Agent Monitor 說明

以下係保留嘅上游使用文件；其中下載連結及示例截圖屬於上游版本。

A local dashboard for **Codex, Claude Code, Pi, and Hermes**. Explore agent trees, read traces, and track token usage and estimated costs. Traces stay on your machine.

![Agent graph](docs/images/agent-graph.png)

## Download

Get the latest macOS, Windows, and Linux builds from [Releases](https://github.com/donvito/agent-monitor/releases). The builds are not code-signed yet; the release notes explain how to open them.

## Run from source

Requires **Node.js 22.12+** and npm.

```sh
git clone https://github.com/donvito/agent-monitor.git
cd agent-monitor
npm install
npm run dev
```

Select a run from the sidebar to load its agents. Click an agent to inspect its trace, or use the icon on its node to open the trace in a tab. Click **Details** next to the token totals for the full breakdown.

Default sources:

| Provider | Local source |
| --- | --- |
| Codex | `$CODEX_HOME/sessions` or `~/.codex/sessions` |
| Claude Code | `$CLAUDE_CONFIG_DIR/projects` or `~/.claude/projects` |
| Pi | `$PI_CODING_AGENT_DIR/sessions` or `~/.pi/agent/sessions` |
| Hermes | `$HERMES_HOME/state.db`, `session-exports/traces`, and `sessions`, defaulting to `~/.hermes` |

## Trace view

Open any agent in a tab to read its conversation, tool calls, and results, with links to its parent and subagents.

![Trace view](docs/images/trace-view.png)

## Token breakdown

Token totals and estimated API cost per agent, with usage charts over time.

![Token usage and cost breakdown](docs/images/token-usage.png)

Switch to **By model** to see tokens and cost grouped by model.

![Token usage and cost by model](docs/images/token-usage-by-model.png)

*Screenshots use synthetic demo sessions.*

## More

- [Using the dashboard](docs/usage.md)
- [Discovery, configuration, and privacy](docs/discovery-and-privacy.md)
- [Development and production builds](docs/development.md)
- [Pricing sources and assumptions](docs/token-pricing.md)
- [Product specification](SPEC.md)
