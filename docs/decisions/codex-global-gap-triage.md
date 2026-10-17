# codex-global 缺口分流（2026-10-17）

`rationale/codex-global.yaml` 遷入時有 8 個 intent 標為 `unimplemented`：這些規則只存在於 Claude Code 全域檔。本紀錄說明逐一判定的結果：保留的規則怎麼針對 Codex 改寫，以及不適用的規則理由與推翻條件。`not-applicable` 紀錄的 `reason` 會連到這份文件。

判定時的限制：

- `~/.codex/AGENTS.md` 與 ChatGPT Custom Instructions 雙向同步（ADR-0001），所以 ChatGPT 對話也會讀這份檔案，只對 agent 有意義的規則會干擾對話。
- 長度上限 5,000 字元（`surfaces.yaml`），判定前檔案已用掉 4,439 字元。
- Codex 上實際安裝的 skill（2026-10-17 查看 `~/.agents/skills`）：`token-preflight`、`judgment`、`dispatch`、`grill-me`、`find-skills`、`better-icons`。`$CODEX_HOME/skills` 沒有 deps.yaml 列出的 skill。

## 保留（補進 `surfaces/codex/AGENTS.md`，狀態 `experimental`）

| intent | 調整方式 |
|---|---|
| `trigger.skill-absent-fallback` | 濃縮成一句通則。Claude Code 版針對每個 skill 列出的替代做法太長；ChatGPT 對話沒有 skill，這條規則反而最有用。 |
| `retry.stop-after-two` | 只保留 `judgment` 判定。原版「再走 `dispatch` 升降級」不適用，見下方 `trigger.dispatch`。 |
| `decisions.persist` | 只保留「寫入專案文件」。拿掉 memory 檔和 `/compact`，因為 Codex 沒有對應的機制。 |
| `workflow.plan-first` | 改寫成獨立的條文，不提 plan mode 這個工具名，只要求「先出方案、取得核准再動手」。 |

## 不適用（狀態 `not-applicable`，定義見 ADR-0002）

| intent | 理由 |
|---|---|
| `meta.maintenance-guide` | 維護指南位於 `~/.claude/harness/maintenance.md`，Codex 端不存在。codex-global 的內容只透過本 repo 修改，再由使用者執行 deploy；修改時的判準由 repo 的 `AGENTS.md`／`CLAUDE.md` 和 lint 把關，不靠全域檔提醒。 |
| `trigger.dispatch` | `dispatch` skill 雖然裝在 `~/.agents/skills`，但它的 description 寫明只適用於 Claude Code（Agent tool、haiku/sonnet、fast mode）。Codex agent 無法自行切換 model，ChatGPT 對話也沒有派工。勉強觸發只會套用到錯誤的平台假設。 |
| `routing.table` | 這份檔案的「觸發」段已經逐條寫出 skill 觸發條件；再加一份路由表只是重複，還會佔用 5,000 字元的額度。Claude Code 版表格的其餘列，各自落在 `trigger.*` 和 `workflow.plan-first`。 |
| `meta.skill-reference-hygiene` | 這條規則規範的是路由表的寫法，而 `routing.table` 不實作。skill 是否實際安裝由 `deps.yaml` 和 `check-deps` 把關，屬於 repo 維護流程，不是 model 的行為。 |

## 推翻條件

- Codex 推出可自行派工或切換 model 的機制，而且 `dispatch` skill 也支援 Codex → 重新判定 `trigger.dispatch`。
- 雙向同步的上限放寬，或兩邊不再同步 → 重新判定 `routing.table`。
