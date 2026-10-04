# Codex 查核結果（Part 1）

查閱日期：2026-10-04
對應清單：[codex-verification-s1-s2.md](codex-verification-s1-s2.md) Part 1
本機環境：`codex-cli 0.153.4`（macOS）

**來源縮寫**：
- **[Doc-AGENTS]**：<https://learn.chatgpt.com/docs/agent-configuration/agents-md>。原網址 `developers.openai.com/codex/guides/agents-md` 已 308 轉址到這裡。
- **[Doc-Custom]**：<https://learn.chatgpt.com/docs/customization/overview>。原網址 `developers.openai.com/codex/concepts/customization` 已 308 轉址到這裡。
- **[Src]**：[openai/codex](https://github.com/openai/codex) `main` @ `afb436df`（2026-10-04）。
- **[Help-CI]**：<https://help.openai.com/en/articles/8096356-chatgpt-custom-instructions>
- **[Help-CLI]**：本機 `codex exec --help`、`codex login --help`（0.153.4）

`surfaces.yaml` 尚未建立，下表「回寫值」等建立時直接填入。

## 總覽

| # | 狀態 | 結論摘要 |
|---|---|---|
| C1 | ✅ 已查證 | override 優先，只取第一個非空檔 |
| C2 | ✅ 已查證 | 有 `CODEX_HOME`；但 user skills 另讀 `~/.agents/skills`，不受它影響 |
| C3 | ✅ 已查證 | git root → cwd，每層最多一檔；fallback 預設為空 |
| C4 | ✅ 已查證（文件與原始碼不一致） | 32 KiB，最後一個檔會被**截斷**；global 檔不計入 |
| C5 | ✅ 已查證 | 沒有 import / include |
| C6 | ✅ 已實測（2026-10-05） | 本機 local project chat、手機 ChatGPT app 遠端連線都生效；Codex cloud 不讀本機 global 檔 |
| C7 | ✅ 已實測（2026-10-05） | UI 儲存會改寫 `~/.codex/AGENTS.md` |
| C8 | ✅ 已查證 | 支援 `SKILL.md`，路徑見下 |
| C9 | ⚠️ 部分 | Plus 方案 5,000 字元；是否套用 Codex cloud 未知，交給 S2 |
| C10 | ✅ 已查證 | flag 見下 |
| C11 | ✅ 已查證 | 可從 human output 標頭或 session 檔取得，但都是「設定的 model」 |
| C12 | ✅ 靜態查證 | loader 不處理 HTML 註解，原文注入 |
| C13 | ✅ 靜態查證（CLI） | CLI 會跟隨 symlink；app 覆寫行為未知 |

## 必查

### C1 global 檔載入規則

**結論**：先讀 `$CODEX_HOME/AGENTS.override.md`，不存在或內容 trim 後為空，才讀 `AGENTS.md`。只取第一個非空檔，兩者不會合併。
**來源**：[Doc-AGENTS] 原文寫明「Codex uses only the first non-empty file at this level」。[Src] `codex-rs/codex-home/src/instructions/mod.rs` 的 `load_from_codex_home`，依序檢查 `[AGENTS.override.md, AGENTS.md]`。
**對應動作**：已寫入 ADR-0004 §5。`deploy codex-global` 遇到非空的 `~/.codex/AGENTS.override.md` 時要發出警告，因為部署的 `AGENTS.md` 會整份失效。本機目前沒有 override 檔。

### C2 `CODEX_HOME`

**結論**：有，預設 `~/.codex`。`codex exec` 另有 `--ignore-user-config`，作用是不讀 `$CODEX_HOME/config.toml`，但認證仍取自 `CODEX_HOME`。
**來源**：[Doc-AGENTS]、[Help-CLI]。
**S1 隔離漏洞**：user 層 skill 除了 `$CODEX_HOME/skills`，也會讀 `~/.agents/skills`。後者用的是 `dirs::home_dir()`，不受 `CODEX_HOME` 影響（[Src] `codex-rs/ext/skills/src/host_roots.rs`）。
**對應動作**：S1 Codex 端採用 Method A。若 `~/.agents/skills` 存在，eval 會讀到真實 skill 的 metadata。需要完全隔離時，eval runner 要連 `HOME` 一起指到暫存目錄。

### C3 project 層探索

**結論**：
- 探索範圍：從 cwd 往上找 `project_root_markers`（預設 `[".git"]`），再從 root 往下走到 cwd。不會越過 root；沒找到 marker 時，只看 cwd。
- 每層檔名順序：`AGENTS.override.md` → `AGENTS.md` → `project_doc_fallback_filenames`。每層最多取一檔。
- 串接：由 root 往 cwd 串接，以空行分隔。越接近 cwd 的檔排在越後面，因此優先。
- 例外：若 project 在 config 中被明確標為 `trust_level = "untrusted"`，就完全不讀 project 層。未設定時照常讀取。

**來源**：[Doc-AGENTS]；[Src] `codex-rs/core/src/agents_md.rs`、`codex-rs/config/src/config_toml.rs`（`ProjectConfig::is_untrusted`）。
**fallback 狀態**：`project_doc_fallback_filenames` 預設為空。本機 `~/.codex/config.toml` 沒有設定這個 key，也沒有設定 `project_root_markers`，因此 Codex 不會讀 `CLAUDE.md`。
**對應動作**：在 README 註明「不要在 `project_doc_fallback_filenames` 加入 `CLAUDE.md`」，原理同 ADR-0004 §5 的 `claude-md-and-agents-md`。

### C4 大小上限

**結論**：`project_doc_max_bytes` 預設 32 KiB（32,768 bytes），只計算 project 層。global 檔不計入，原始碼中也沒有看到 global 檔的上限。
**文件與原始碼不一致**：
- [Doc-AGENTS] 說達到上限就「停止加入檔案」。
- [Src] 的實際行為是：最後一個放不下的檔案會被**截斷**到剩餘 bytes 後照樣注入（`data.truncate(remaining)`），只寫一筆 `tracing::warn`，使用者看不到。

**來源**：[Src] `codex-rs/config/src/config_toml.rs:75`（`DEFAULT_PROJECT_DOC_MAX_BYTES = 32 * 1024`）、`codex-rs/core/src/agents_md.rs` 的 `read_agents_md`。
**回寫值**：
- `codex-repo`：上限 32,768 bytes，計算的是同一路徑上所有 project 檔的**合計**。
- `codex-global`：無上限（依 [Src]）。

**對應動作**：超過上限時會靜默截斷，因此 `deploy` / `status` 對 `codex-repo` 要做 bytes 檢查，接近上限就發出警告。

### C5 import / include

**結論**：沒有。loader 直接讀取原文並串接，[Doc-AGENTS] 也沒有提到相關機制。
**來源**：[Doc-AGENTS]；[Src] `agents_md.rs`、`codex-home/src/instructions/mod.rs`。
**對應動作**：只記錄，不改決策。已更新 ADR-0001 替代方案中「尚未查證」的字樣。

### C6 #27705 狀態

**結論**：[openai/codex#27705](https://github.com/openai/codex/issues/27705) 仍是 OPEN，標籤為 `bug`、`app`、`config`，最後更新於 2026-09-08。後續留言補充了兩點：
- 有人回報只發生在 Codex Desktop 的 remote project。
- 也有人回報是既有對話沒有重新載入，未必是完全沒注入。

CLI 端的 [Src] 會把 global 檔和 project 檔一起載入，兩者不互斥。
**實測**（2026-10-05，Codex app，canary 法）：
- 本機 local project 的新對話：canary 有出現，代表 `codex-global` 在 app 的 local project chat 生效，#27705 沒有在本機重現。
- Codex cloud 環境：canary 沒有出現。這是預期結果，因為 cloud 跑在遠端容器，本來就沒有你本機的 `~/.codex`。這不等於 #27705 留言說的 Desktop remote project。
- 手機 ChatGPT app 遠端連線到電腦上的 Codex：canary 有出現。執行端仍是本機，所以會讀到本機的 `~/.codex/AGENTS.md`。
- #27705 留言說的 Desktop remote project：不確定是否就是上面的手機遠端連線情境，未另外確認。

**對應動作**：`surfaces.yaml` 的 `codex-global` 標記為「CLI、app local project 生效；Codex cloud 不適用」。#27705 在本機和手機遠端連線都沒有重現，降為低風險，不阻擋開工。cloud 端到底讀哪些來源，交給 S2 判定。

### C7 Codex app Custom instructions 的寫入位置

**結論**：會寫入。2026-10-05 實測：在 Settings → Personalization → Custom instructions 修改並儲存後，`~/.codex/AGENTS.md` 的修改時間和 hash 都改變；在 UI 復原後，hash 回到原值。
**對應動作**：Personalization UI 和 `~/.codex/AGENTS.md` 是同一個載入點，不需要新增 surface。ADR-0004 的 drift 偵測必須保留，已把 ADR-0004 背景中「未經查證」改為已實測。

### C8 skills

**結論**：支援，格式為 `SKILL.md` 加 frontmatter `name`、`description`，可選子目錄 `scripts/`、`references/`、`assets/`。採 progressive disclosure：先只載入 metadata，被選用時才讀完整的 `SKILL.md`。
**搜尋路徑**：
- user 層：`$CODEX_HOME/skills`、`~/.agents/skills`
- repo 層：project root 到 cwd 之間各層的 `.agents/skills`，以及 `.codex/skills`
- 另有 system、admin 層

**來源**：[Doc-Custom]；[Src] `codex-rs/ext/skills/src/host_roots.rs`、`loader/mod.rs`（`SKILLS_FILENAME = "SKILL.md"`）。
**對應動作**：`deps.yaml` 的 Codex 端加入 `~/.agents/skills/<name>/SKILL.md` 與 `$CODEX_HOME/skills/<name>/SKILL.md`。frontmatter 欄位和 Claude Code skill 一致，可以共用同一份檔案，但部署位置不同。

### C9 ChatGPT Custom Instructions

**結論**：
- 字數上限：Free 和 Go 方案 1,500 字元；Plus、Pro、Enterprise、Business、Education 方案 5,000 字元。
- 欄位：help 頁的 Web 操作步驟只提到一個「Custom Instructions field」。
- 生效時機：「applied immediately across all chats」。
- 是否套用到 Codex cloud：help 頁沒有提到，仍然未知。

**來源**：[Help-CI]。WebFetch 會被回 403，改用瀏覽器讀取。
**回寫值**：`chatgpt` 的上限設為 5,000 字元（使用者為 Plus 方案，2026-10-05 確認）。
**對應動作**：是否套用到 Codex cloud 由 S2 步驟 3 實測。C6 在 cloud 沒看到本機 global canary，但那次測的是本機檔案，不是 ChatGPT Custom Instructions，所以不能代替 S2 步驟 3。

### C10 `codex exec` 非互動參數

| 用途 | flag |
|---|---|
| 指定 model | `-m, --model <MODEL>` |
| 最後訊息寫入檔案 | `-o, --output-last-message <FILE>` |
| JSON 輸出 | `--json`（stdout JSONL 事件）；`--output-schema <FILE>` 可約束最終回覆格式 |
| sandbox | `-s, --sandbox read-only\|workspace-write\|danger-full-access` |
| approval | `codex exec` 沒有 `--ask-for-approval`；可用 `--approve-for-me`，或 `-c approval_policy=...` |
| 略過 git 檢查 | `--skip-git-repo-check` |
| 不寫 session 檔 | `--ephemeral` |
| 不讀 user config | `--ignore-user-config`（認證仍取自 `CODEX_HOME`） |
| 工作目錄 | `-C, --cd <DIR>` |

**來源**：[Help-CLI]。
**S1 佔位符替換**：`<SKIP_GIT_CHECK_FLAG?>` 在 X-2 不需要，因為 cwd 已經執行過 `git init`。`<OUTPUT_FLAG>` 換成 `-o`。建議另外加上 `-s read-only --ephemeral`，避免 eval 在 `CODEX_HOME` 留下 session 檔。

### C11 實際 model id

**結論**：有兩個取得來源。
- human output（非 `--json` 模式）的開頭會印出 `model: <id>`，取自 `session_configured_event.model`。
- 若沒有加 `--ephemeral`，session 檔 `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` 中，每個 `turn_context` 都有 `"model"` 欄位。本機現有 session 檔已確認有這個欄位。

`--json` 的 JSONL 事件**沒有** model 欄位。
**限制**：兩個來源記錄的都是 client 設定或請求的 model，不保證是 server 實際服務的 model。
**對應動作**：run 紀錄取 human output 的 `model:` 標頭，並註明「client 設定值」。若同時要 `--json`，就另外以 `-c model=...` 明確指定 model，並把指定值寫進 run 紀錄。

## 選查

### C12 HTML 註解

**結論**：loader 不處理 HTML 註解，只有 global 檔會做 `trim()`，其餘內容原文注入（[Src] 兩個 loader 中都沒有 `<!--` 處理）。只做了靜態查證，沒有實測。不影響決策。

### C13 symlink

**結論**：CLI 的 global 檔用 `tokio::fs::metadata` 判斷，這個呼叫會跟隨 symlink；project 層同樣檢查 `is_file`。所以 symlink 指向檔案時，CLI 會正常讀取。只做了靜態查證。
**未知**：Codex app 從 Personalization 寫入時，會覆寫 symlink 本身，還是寫入 symlink 指向的檔案。
**對應動作**：ADR-0004 的推翻條件中，Codex 這一半在 CLI 端已滿足。但 Cowork 端的條件不變，因此決策不變。

## 手動驗證紀錄

| 項目 | 日期 | 結果 |
|---|---|---|
| C6 | 2026-10-05 | local project chat、手機 ChatGPT app 遠端連線都出現 canary；Codex cloud 未出現 |
| C7 | 2026-10-05 | UI 儲存後檔案 hash 改變，復原後回到原值 |
| C9 | 2026-10-05 | 方案為 Plus，上限 5,000 字元；是否套用 Codex cloud 留待 S2 步驟 3 |
