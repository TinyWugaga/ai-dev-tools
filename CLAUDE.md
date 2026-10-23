# ai-dev-tools（Claude Code 專用）

- 修改前先讀 `docs/decisions/` 中與任務相關的 ADR，以 ADR 作為設計依據。需求和 ADR 衝突時，先指出衝突點，等我決定後再動手。
- 修改 `surfaces/`、`CLAUDE.md` 或 `AGENTS.md` 中的規則文字時，在同一次變更內更新 `rationale/<surface-id>.yaml` 對應紀錄的 `text`，讓兩邊逐字相同，並把 `status` 設為 `experimental`。
- 不要直接寫入 `~/.claude`、`~/.codex`、`~/.agents`。global 檔只透過 deploy script 更新，而且由使用者自己執行。
- 本檔只給 Claude Code 讀，`AGENTS.md` 只給 Codex 讀。不要用 import、symlink 或複製讓兩者共用內容。Nodit 管理的 `<!-- nodit:start -->` 區塊除外（ADR-006）。
- 改動 `intents.yaml`、`surfaces.yaml`、`deps.yaml`、`rationale/` 或任何部署檔之後，執行 `npm run lint`。lint 失敗時不要回報完成。
- `surfaces.yaml` 中的平台事實（長度上限、載入行為）必須附 `source` 與 `checked`。查不到就填 `unknown`，不要憑記憶填數值。
- ADR 狀態成為 Accepted 時，或我核准一份具體 plan 後，執行 `npm run issue -- <decision|task> --key <ADR 的 id|task-YYYY-MM-DD-slug> --title "<標題>" --body-file <檔案>`，不需要先問我，完成後回報 issue 連結。decision 的 body 放 ADR 路徑與決策摘要；task 的 body 放 plan 摘要和 checklist；兩者都連到當下已存在的對方 issue。task key 在第一次核准時產生（同一天內 slug 不可重複），記在 plan 檔，重跑時沿用同一個 key。這是常設授權，只涵蓋在 `TinyWugaga/ai-dev-tools` 建 issue 並加入 Project 5，不包括建 label、編輯、關閉、reopen 或刪除。script 回傳非 0 時回報輸出，不要改用其他方式建立；原因排除後可以重跑同一指令。

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

### Claude Code skills

建立卡片時使用 `/nodit-adr`、`/nodit-milestone`、`/nodit-task`。
<!-- nodit:end -->
