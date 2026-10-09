# ADR-0005：決策與 plan 同步為 GitHub issue

- 狀態：Accepted
- 日期：2026-10-09
- 依賴：ADR-0001、ADR-0002

## 背景

決策目前只存在 `docs/decisions/`，任務規劃只存在對話或 plan 檔中，沒有一個地方可以追蹤「哪些決策已定、哪些任務在進行」。使用者要求在決策定案或規劃任務時，同步在 GitHub Project（[TinyWugaga/projects/5](https://github.com/users/TinyWugaga/projects/5)）新增 issue。

建立 issue 屬於外部服務寫入。global 規則要求「未經明確要求不修改外部服務」，所以需要一份範圍明確的常設授權。

## 決策

### 1. 觸發點

| kind | 觸發 | key | body |
|---|---|---|---|
| `decision` | ADR 狀態成為 Accepted（包括新建時就是 Accepted 的 ADR）；Proposed 草稿不觸發 | `ADR-NNNN` | ADR 路徑與決策摘要 |
| `task` | 使用者核准一份具體 plan；直接要求執行、沒有核准 plan 時不觸發 | `task-<核准日>-<slug>` | plan 摘要與 checklist |

說明：
- 不會為了建 issue 而多要求一次 plan 確認。
- 同一件工作同時有 ADR 和 plan 時，建兩張 issue：decision 記錄決策，task 追蹤執行。
- 第一版不更新 issue body，所以由後建立的那一張負責連結到已存在的另一張，不會為了等對方而延後建立。

### 2. 常設授權

授權寫在 `CLAUDE.md`、`AGENTS.md` 的規則文字本身，不只寫在 ADR。範圍如下：
- **允許**：在 `TinyWugaga/ai-dev-tools` 建立 issue，並加入 user project 5。不需事先詢問，完成後回報連結。
- **不允許**：建立 label、編輯、關閉、reopen、刪除 issue。label 由使用者事先建立。

### 3. 由 `npm run issue` 執行，不在規則裡寫 gh 指令

規則只寫觸發點與參數。去重、驗證、部分成功的復原，都由 `scripts/lib/issue.ts` 處理。原因是這些邏輯靠 agent 遵守措辭很難穩定做對，放在 script 裡才能用測試驗證，兩個 surface 也能共用同一套行為。

script 的關鍵設計：
- **Identity 是 key，不是標題**：body 末尾附上 `<!-- ai-dev-tools:issue-sync:<kind>:<key> -->`。改標題不影響去重；不同 plan 的標題相同也不會誤用同一張 issue。
- **不依賴 search API**：用 `gh api --paginate --slurp repos/<repo>/issues?state=all` 列出全部 issue，再精確比對 marker。本 repo 規模小，完整性比查詢效率重要。
- **復原紀錄**：state 目錄的 `issue-sync.json` 記錄 key → `html_url`。重跑時先用 `gh issue view` 核對紀錄中的 issue：repo、marker 和 open 狀態都要符合。
- **鎖定目標**：`github.yaml` 明寫 repo 與 Project，gh 指令一律帶 `--repo`。`gh api` 沒有 `--repo`，改用明確 endpoint 並帶 `--hostname github.com`。
- **唯讀 preflight**：寫入前先跑 `repo view`、`label list`、`project view`，提前攔下缺 scope 這類已知問題。讀取通過不保證寫入成功，所以仍保留部分成功流程：issue 已建立但沒加進 Project 時，回傳 URL 並 exit 1，重跑時只補做 item-add。
- **不重試 create**：create 失敗或結果不明時停止。重跑會先比對 marker，所以不會重複建立。
- **lock**：`issue-sync.lock` 只保護共用同一 state 目錄的程序，lock 已存在時報錯退出、不動既有 lock。

## 後果

**正面**
- 每個 Accepted ADR 和每份核准的 plan，都在 Project 中有一張可追蹤的 issue。
- 重跑安全，失敗時有明確的復原路徑。

**負面與限制**
- 規則仰賴 agent 遵守，不是機械保證；agent 忘了跑就會漏同步。
- 只同步「建立」這個事件。ADR 修改或 plan checklist 進度不會回寫到 issue。
- 不保證跨主機只建立一次：兩台機器同時執行仍可能各自建立。
- task key 要靠 agent 記錄下來；key 遺失後重跑會建立新的 issue。

## 外部事實

`project` scope 需求、`gh api` 的 `--paginate`／`--slurp`／`--hostname`、REST issue 的 `html_url` 與 `pull_request` 欄位，查證來源如下：
- [gh project item-add](https://cli.github.com/manual/gh_project_item-add)
- [gh api](https://cli.github.com/manual/gh_api)
- [gh auth refresh](https://cli.github.com/manual/gh_auth_refresh)
- [REST: List repository issues](https://docs.github.com/en/rest/issues/issues#list-repository-issues)

以上於 2026-10-09 查閱；`--slurp` 另以本機 `gh 2.96.0` 的 `gh api --help` 確認。item-add 對同一個 issue 重複呼叫時，會成功（exit 0），而且 Project 中不會出現重複 item。2026-10-09 以 ADR-0005 對應的 [issue #1](https://github.com/TinyWugaga/ai-dev-tools/issues/1) 實測：同一個 key 跑兩次，issue 數與 Project item 數都維持 1。

## 推翻條件

- issue 噪音明顯超過追蹤價值。例如使用者長期不看 Project，或頻繁手動關閉自動建立的 issue。
- 維持 ADR 和 issue 兩邊一致的成本變高，需要改成以 workflow 自動同步，或改成只用其中一邊。
