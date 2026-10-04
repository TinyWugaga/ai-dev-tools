# Spike S2 結果：Codex cloud 讀取來源

執行日期：2026-10-05
步驟依據：[codex-verification-s1-s2.md](codex-verification-s1-s2.md) Part 3
介面：ChatGPT app 內的 Codex cloud 任務
model：GPT-6.1 Sol（輕度）。第一輪步驟 2 用的是 GPT-6 Astra，該輪已作廢。

## 結論

1. **一般 cloud 任務不會注入 repo 的 `AGENTS.md`**。任務的 cwd 是 `/workspace`，repo 被 clone 到 `/workspace/<repo>`，cwd 不在 repo 內，所以 repo 根目錄的 `AGENTS.md` 不在探索路徑上。
2. **cwd 在 repo 內時會注入**。環境 onboarding 的 setup 任務，回覆第一行就是 `CANARY-S2-REPO`，可見 model 會照做注入的 canary。
3. **ChatGPT Custom Instructions 傾向不套用到 cloud 任務**。在 Custom Instructions 加入 `CANARY-S2-GLOBAL` 之後，新任務既沒有照做，也沒有引用。第 2 點已證明同一個 model 會照做被注入的 canary，所以這是中等強度的證據。不過 model 也表示不能引用 hidden system 或 developer instructions，因此沒有引用不能證明沒注入。
4. **環境設定裡沒有 instructions 欄位**。環境設定頁的「指令碼」只有「安裝指令碼」和「啟動技能」。這兩項都沒有設定，output 也沒有引用到其他來源。

**判定**：依判定表「沒出現 `CANARY-S2-REPO`」→ 新增獨立的 surface `codex-cloud`，不併入 `codex-repo`。

## 經過

| 輪次 | 環境 | 結果 | 處置 |
|---|---|---|---|
| 1 | `ai-dev-tools`，只能選 `main` 分支 | 沒有 canary；`main` 上本來就沒有 `AGENTS.md` | 作廢。canary 放在 `spike/s2-codex-cloud` 分支，cloud 環境選不到 |
| 2 | 拋棄式 private repo `TinyWugaga/s2-canary`，`main` 只有 canary `AGENTS.md`（`9e37052`） | 見下 | 採用 |

### 第 2 輪觀察

- **步驟 2**：回覆寫「I haven't read any AGENTS.md files」，只引用了 `<environment_context>`。
- **診斷**：
  - `pwd` 回傳 `/workspace`。
  - `git log` 回傳 `not a git repository`。
  - `cat AGENTS.md` 回傳 `No such file or directory`。
- **進一步診斷**：
  - `/workspace` 底下有 `.agents/`、`.aws/`、`.codex/`、`.git/`，四個都是唯讀的空目錄，另外還有 `library-files/`、`scratch/`、`shared/`、`s2-canary/`。
  - `find` 只找到 `/workspace/s2-canary/AGENTS.md` 一個檔案。
  - `/workspace/s2-canary` 的最新 commit 是 `9e37052 spike: S2 canary`。
- **步驟 3**：回覆是「I can't quote internal system or developer instructions」，沒有出現 `CANARY-S2-GLOBAL`。
- **環境 onboarding 任務**：回覆第一行是 `CANARY-S2-REPO`。

### 推論：為什麼 cwd 在 `/workspace` 就讀不到

[查核 C3](codex-verification-result.md#c3-project-層探索) 確認，Codex 會從 cwd 往上找 `project_root_markers`（預設是 `.git`），再從找到的 root 往下讀到 cwd。

1. `/workspace/.git` 這個目錄存在，所以 Codex 會把 `/workspace` 當成 project root。這個目錄是空的，所以 git 指令不認它是 repo。
2. 探索範圍因此只有 `/workspace` 這一層，不會往下讀到 `/workspace/s2-canary/AGENTS.md`。

這個推論和觀察一致，但 cloud 端的 harness 是否用同一套 loader 沒有直接驗證。

## 對設計的影響

- `surfaces.yaml` 新增 `codex-cloud`，註記以下三點：
  - 一般任務不會自動載入 repo 的 `AGENTS.md`。
  - Custom Instructions 傾向不套用。
  - 環境設定沒有 instructions 欄位。
- `codex-repo` 的內容不要假設在 Codex cloud 上會生效。

## 未解項目

以下項目在第一次實際用 Codex cloud 跑本 repo 時再補測：

- 任務中途 `cd` 進 repo 之後，Codex 會不會載入 repo 的 `AGENTS.md`。CLI 是在 session 開始時一次載入，推測不會。
- `/workspace/.agents`、`/workspace/.codex` 的用途，以及有沒有辦法放入 instructions 或 skills。
- 只在一個 repo 時，有沒有辦法讓任務的 cwd 直接落在 repo 內。onboarding 任務做得到，但一般任務的設定方式未知。
