# 受控本機驗收 Benchmark

「任務結果與實驗」可以選擇一份信任嘅 `local-benchmark/1` 驗收包，先建立
五分鐘有效嘅預覽，再由使用者明確確認執行。App 唔會自動執行匯入檔案內嘅
Shell 指令，亦唔會啟動付費模型任務。第一版係 Mac 本機 Node 驗收；其他
平台／AI 任務需要各自嘅實際授權及執行邊界，不能以相容 collector 作為證明。

驗收包係相對路徑嘅顯式輸入清單：

```json
{
  "schema": "local-benchmark/1",
  "suiteId": "acceptance-suite-v1",
  "entry": "check.cjs",
  "files": ["check.cjs", "input.json"],
  "args": [],
  "outputs": ["result.json"],
  "timeoutSeconds": 30
}
```

預覽讀取及固定輸入 bytes、大小同 SHA-256。執行用預覽嘅 bytes，而唔係之後
修改嘅來源檔案；來源檔案永不寫入。拒絕絕對／上層路徑、symlink、敏感設定
名稱、非 Node entry，及超過檔案／總大小／時間上限嘅輸入。最多 128 個
輸入、32 MiB 總量、32 個產物，時間上限 600 秒。

只有確認之後先寫入暫時快照。輸入位於唯讀 input directory，產物請寫入
`process.env.BENCHMARK_OUTPUT_DIR`；輸出清單相對呢個目錄。示例驗收程式：

```js
const fs = require('node:fs');
const assert = require('node:assert/strict');
const input = JSON.parse(fs.readFileSync('input.json', 'utf8'));
assert.equal(input.expected, 4);
fs.writeFileSync(process.env.BENCHMARK_OUTPUT_DIR + '/result.json', JSON.stringify({
  schema: 'local-test-metrics/1', tests: 1, passed: 1, failed: 0, skipped: 0,
}));
```

macOS sandbox 禁止網絡同 output directory 外嘅寫入；Node 權限限制一般
filesystem、child process、worker、addon、inspector 操作。Node 官方明示
[Permission Model 係防止誤操作嘅 guardrail](https://nodejs.org/download/release/v24.21.0/docs/api/permissions.html)，
唔係惡意程式安全隔離，部分 builtin／既有 descriptor 可以繞過 Node filesystem
限制。因此產品預覽要求只選信任嘅驗收程式，不聲稱能安全執行任意惡意程式。
環境不繼承 API Key、NODE_OPTIONS、使用者 HOME 設定或模型用量授權。

完成、非零退出、取消、逾時、setup failure、output limit 或中斷全部保存。
stdout/stderr 只保留 bytes，唔保存原文。產物保留大小、SHA、及有閉合 schema
嘅數字 test metrics；其他 JSON/任意內容不能成為可執行指示。臨時 raw inputs
同產物執行完即清理，metadata 記錄 contentRetained false。原始產物內容不保留。

命令退出碼、source-reported test metrics 同使用者任務驗收三者分開。執行成功
仍然 unreviewed；要明確覆核產物／合約先可以記錄 reviewed success/failure。
執行列表全部進入比較人口，包括未覆核、失敗、取消，不能只保留成功試驗。
同一執行只可覆核一次，結果及資源 metadata 不以新帳本重算。中斷結果保持未知，
不會按舊 PID 擅自操作其他程序。

本機驗收沒有模型 Token telemetry，唔加入 Codex usage，亦唔排名 Token／美元
節省。其 Task contract 關係只用來維持 scope/privacy 及比較目標，唔將相關
Codex run 嘅所有用量歸因俾本機測試。來源刪除／到期會清理相關 metadata／trial；
report 使用既有 Project export guards，省略 input/output hash 同原文。
Schema 11／wire-v2 不變，collector 傳送內容不擴大。
