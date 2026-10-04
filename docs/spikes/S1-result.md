# Spike S1 結果：eval 隔離

執行日期：2026-10-05
步驟依據：[codex-verification-s1-s2.md](codex-verification-s1-s2.md) Part 2

**版本與 model**：
- Claude Code `2.1.263`，`modelUsage` 為 `claude-sonnet-5`，另有 `claude-haiku-4-5-20251001` 負責輔助呼叫。
- codex-cli `0.153.4`，human output 標頭為 `model: gpt-6-astra`。

## 結果

| 工具 | 方法 | canary／載入 | 對照組 | 真實 home 被寫入 | 判定 |
|---|---|---|---|---|---|
| Claude Code | A：`CLAUDE_CONFIG_DIR` 下的 `CLAUDE.md`（user 層） | ✅ 出現 canary，引用到暫存路徑 | ✅ 回覆 `NONE` | 否 | `native` |
| Claude Code | B：cwd `CLAUDE.md` + `--setting-sources project` | ✅ 有載入，引用到檔案路徑與首行；⚠️ 拒絕照做 canary，見附註 1 | ✅ | 否 | `native` |
| Codex | A：`CODEX_HOME` 下的 `AGENTS.md` | ✅ 出現 canary | ✅ 沒有 AGENTS.md；⚠️ skills 外洩，見附註 2 | 否 | `native`（需同時隔離 `HOME`） |
| Codex | B：git repo 根目錄的 `AGENTS.md` | ✅ 出現 canary，引用到路徑 | 同上 | 否 | `native`（需同時隔離 `HOME`） |

## 附註

### 1. Claude 把 canary 指令判定為 prompt injection

Method B 的回覆有引用 `CLAUDE.md` 的路徑和首行，代表檔案確實載入了。但 Claude 明確表示：要求在回覆開頭印固定字串，是典型的 prompt injection 手法，所以不照做。Method A 的同一句 canary 則有照做。

**影響**：eval 不能用「有沒有照做 canary」來判斷檔案是否載入，要用「能否引用檔案內容與路徑」。規則本身的 eval 測的是真實規則，不受這個問題影響。

### 2. Codex 的 skills 不受 `CODEX_HOME` 隔離

**現象**：三組 Codex 測試，包含對照組，都列出了 `~/.agents/skills` 下的 6 個 skill：`better-icons`、`dispatch`、`find-skills`、`grill-me`、`judgment`、`token-preflight`。這驗證了[查核 C2](codex-verification-result.md#c2-codex_home) 從原始碼推得的漏洞。

**補測**：對照組加上 `HOME="$S1/fakehome"` 再跑一次。這次只剩 5 個 Codex 內建的 system skill：`imagegen`、`openai-docs`、`plugin-creator`、`skill-creator`、`skill-installer`。AGENTS.md 一樣沒有載入。

**影響**：eval runner 跑 Codex 時，要同時指定 `CODEX_HOME` 和 `HOME`。

### 3. model 會回到預設值

暫存的 `CODEX_HOME` 裡沒有 `config.toml`，所以 Codex 用的是預設 model `gpt-6-astra`，不是你本機 config 裡設定的那個。Claude 這邊也一樣，暫存的 `CLAUDE_CONFIG_DIR` 不會帶入你的 model 設定。

**影響**：eval runner 必須明確指定 model。Claude 用 `--model`，Codex 用 `-m`，並把指定值寫進 run 紀錄。

### 4. home 寫入的判斷方式

執行時 Codex app 和一個 Claude Code session 都在跑，所以沒有照原步驟用 `-newer marker` 判斷，那樣一定會掃出雜訊。改用以下兩步：

1. 在 `~/.claude`、`~/.codex`、`~/.agents`、`~/.claude.json` 中，找出比 marker 新、且內容包含暫存目錄名稱或 `CANARY-S1` 的檔案。
2. 對 marker 之後更新的檔案逐一追查來源。

追查結果：
- 唯一命中的是主控 session 自己的 `~/.claude/file-history/<session-id>/`，可以排除。
- `~/.claude/sessions/<pid>.json` 屬於主控 session。
- `~/.codex/tmp/arg0/` 的 lock 寫入時間是腳本開頭執行 `codex --version` 的那一秒。那次呼叫沒有設定 `CODEX_HOME`，是腳本自身造成的，不是測試寫入。測試是在 2 分鐘後才執行的。

**結論**：6 組測試都沒有寫入真實 home。

## 對 eval runner 的要求

由以上結果整理出三點：

1. **Claude**：
   - user 層：`CLAUDE_CONFIG_DIR=<tmp>`，部署檔放在 `<tmp>/CLAUDE.md`。
   - project 層：用 `--setting-sources project`。
   - 共同參數：`--no-session-persistence`、`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`、`--model <id>`。
   - 認證：使用 `CLAUDE_CODE_OAUTH_TOKEN`，從 `claude setup-token` 產生。
2. **Codex**：
   - 環境變數：同時設定 `CODEX_HOME=<tmp>` 和 `HOME=<tmp-home>`。
   - 參數：`-s read-only --ephemeral -m <id> -o <file>`。
   - 認證：在暫存的 `CODEX_HOME` 內執行 `codex login`。預設寫入 `auth.json`，可以在暫存目錄之間複製。
3. **判定載入的方式**：用「引用檔案內容與路徑」，不要用 canary 是否照做。
