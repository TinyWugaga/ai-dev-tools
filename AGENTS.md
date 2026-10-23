# ai-dev-tools（Codex 專用）

## 開始前

- 先讀 `docs/decisions/` 下與任務相關的 ADR。ADR 是設計依據；任務需求與 ADR 衝突時，停下來回報衝突點，不要自行選擇其中一方。

## 修改規則時

- 部署檔（`surfaces/**`、`CLAUDE.md`、`AGENTS.md`）中的規則文字被新增或修改時，在同一次變更內完成：
  1. 更新 `rationale/<surface-id>.yaml` 中對應紀錄的 `text`，與部署檔逐字相同。
  2. 把該紀錄的 `status` 設為 `experimental`。
- `AGENTS.md` 只給 Codex 讀，`CLAUDE.md` 只給 Claude Code 讀。不要建立 symlink、不要複製內容到另一個檔案，也不要在 `project_doc_fallback_filenames` 加入 `CLAUDE.md`。Nodit 管理的 `<!-- nodit:start -->` 區塊除外（ADR-006）。
- `surfaces.yaml` 中的平台事實（長度上限、載入行為）必須附 `source` 與 `checked`。沒有查到來源時填 `unknown`，不要從記憶填入數值。

## 記錄決策與任務

- 以下兩種情況，執行 `npm run issue -- <decision|task> --key <key> --title "<標題>" --body-file <檔案>`，不需要先詢問，完成後在回覆中附上 issue 連結：
  1. ADR 狀態成為 Accepted（包括新建時就是 Accepted）：kind 用 `decision`，key 用 ADR frontmatter 的 `id`（如 `ADR-0005`、`ADR-006`），body 放 ADR 路徑與決策摘要。
  2. 使用者核准一份具體 plan：kind 用 `task`，key 用 `task-<核准日 YYYY-MM-DD>-<slug>`，body 放 plan 摘要和 checklist。使用者直接要求執行、沒有核准 plan 時，不建立。
- body 連到當下已存在的對方 issue（task ↔ decision），不要為了等對方建立而延後。
- task key 在第一次核准時產生並寫進當輪回覆；同一天內 slug 不可重複。重跑時沿用同一個 key，不要依日期或標題重新產生。
- 這是常設授權，只涵蓋在 `TinyWugaga/ai-dev-tools` 建立 issue 並加入 Project 5。不要建立 label、編輯、關閉、reopen 或刪除 issue。
- 指令回傳非 0 時，回報 stdout 與 stderr，不要改用 `gh` 或其他方式建立。使用者排除原因後，可以重跑同一指令。

## 禁止事項

- 不要寫入 `~/.claude`、`~/.codex`、`~/.agents` 底下的任何檔案。global 檔只能由使用者執行 deploy script 更新。

## 完成前

- 只要改動了 `intents.yaml`、`surfaces.yaml`、`deps.yaml`、`rationale/` 或任何部署檔，執行 `npm run lint`。指令回傳非 0 時，修正後重跑；仍失敗就回報錯誤內容，不要回報完成。

<!-- nodit:start v2 -->
## Nodit：決策與工作卡片格式

這個專案用 Nodit 把 ADR、Milestone、Task 畫成關聯圖。在 `docs/decisions/`、`docs/milestones/`、`docs/tasks/` 新增或修改檔案時，遵守下列格式；不符合的檔案會在 Nodit 裡標成無效，而且不能透過 UI 編輯。

### 檔案

- ADR：`docs/decisions/ADR-###-<slug>.md`
- Milestone：`docs/milestones/MS-##-<slug>.md`
- Task：`docs/tasks/T-###-<slug>.md`
- `id` 一旦建立就不要修改；改標題不必改檔名。

新建卡片時，先確認 `nodit` 指令可用（`command -v nodit`；專案把 Nodit 裝成 devDependency 時改用 `npx --no nodit`），可用就執行 `nodit new`，它會在寫入鎖內配發不重複的編號：

```sh
nodit new adr "<標題>" [--supersedes ADR-002]
nodit new milestone "<標題>" [--implements ADR-001]
nodit new task "<標題>" [--milestone MS-01] [--implements ADR-001] [--depends T-002]
```

不要用不帶 `--no` 的 `npx`：本地找不到時，npx 會從 npm 下載套件來執行，下載到的不一定是這個專案用的版本或套件。`nodit` 不可用時才手寫檔案，編號取該資料夾現有最大值 + 1。

### frontmatter

必填 `id`、`type`、`title`、`status`。

| type | status | 其他欄位 |
| --- | --- | --- |
| `adr` | `proposed` / `accepted` / `deprecated` / `superseded` | `date: YYYY-MM-DD` |
| `milestone` | `planned` / `active` / `done` | `due: YYYY-MM-DD` |
| `task` | `todo` / `doing` / `blocked` / `done` | `priority: low / medium / high`、`assignee` |

### 關聯（寫在來源端的 frontmatter）

- Task 或 Milestone 實作某個決策：`implements: [ADR-001]`
- Task 屬於某個 Milestone：`milestone: MS-01`（單一值）
- 依賴：`depends: [T-002]`（Task 對 Task、Milestone 對 Milestone）
- 新 ADR 取代舊 ADR：新 ADR 寫 `supersedes: [ADR-002]`，並把舊 ADR 的 `status` 改成 `superseded`（只改那一行）
- 其他關係：`relates: [ID]`

### 正文段落

- ADR：`## Context`、`## Decision`、`## Consequences`
- Milestone：`## Goal`
- Task：`## Description`

每個段落標題在同一份檔案只出現一次。其他自訂段落與 frontmatter 欄位會原樣保留。
<!-- nodit:end -->
