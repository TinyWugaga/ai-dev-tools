# Codex 查核清單與 Spike S1／S2 執行步驟

建立日期：2026-10-04
相關文件：[ADR-0002](../decisions/0002-rationale-records-quote-rule-text.md)、[ADR-0003](../decisions/0003-eval-gates-status-not-deploy.md)、[ADR-0004](../decisions/0004-copy-deploy-with-drift-detection.md)

建議依「Codex 查核 → S1 → S2」的順序進行。C1～C5 和 C10 的結果，會直接決定 S1 Codex 端的指令怎麼寫。

---

## Part 1：Codex 查核清單

**背景**：決策階段的 Codex 資訊全部來自二手資料，因為 `developers.openai.com` 被 cloud 環境的 proxy 擋住。請在本機開啟官方文件逐項核對，必要時也查 `codex --help` 和 [openai/codex](https://github.com/openai/codex) repo。

**記錄方式**：每項都填「結論、來源 URL、查閱日期」。查完後回寫到 `surfaces.yaml`，影響決策的項目則同步修改對應的 ADR。

**參考來源**：
- 官方文件：<https://developers.openai.com/codex/guides/agents-md>、<https://developers.openai.com/codex/concepts/customization>
- 已知 issue：[openai/codex#27705](https://github.com/openai/codex/issues/27705)

### 必查（v1 開工前）

| # | 查核事項 | 目前的二手說法 | 影響範圍 | 結果與對應動作 |
|---|---|---|---|---|
| C1 | global 檔的載入規則：`~/.codex/AGENTS.override.md` 與 `AGENTS.md` 的優先順序；是否只取第一個非空檔 | override 優先，只取第一個非空檔 | `codex-global` 的部署目標（ADR-0004） | 若 override 優先，`deploy` 要額外檢查 `AGENTS.override.md` 是否存在，存在就發出警告，原理同 `~/.claude/rules/` 的檢查 |
| C2 | 有沒有 `CODEX_HOME` 這類可以改變 home 目錄的環境變數 | `CODEX_HOME` 預設是 `~/.codex` | S1 Codex 端的隔離方式 | 有 → S1 Codex 端用 Method A。沒有 → S1 Codex 端只能走 proxy 或手動測試 |
| C3 | project 層的探索範圍：從 git root 走到 cwd、每層讀哪些檔名、串接順序、fallback 檔名的設定方式 | 從 git root 走到 cwd，越接近 cwd 越優先 | `codex-repo`；repo 根目錄的 `AGENTS.md` | 若會讀到 `CLAUDE.md` 這類 fallback 檔名，必須確認 fallback 設定沒有啟用，否則會讀進 Claude 專用的檔案 |
| C4 | 大小上限（例如 `project_doc_max_bytes`）的預設值，以及超過上限時是截斷還是略過 | 未知 | `surfaces.yaml` 中 `codex-global`、`codex-repo` 的長度上限 | 把上限和來源寫入 `surfaces.yaml` |
| C5 | 有沒有 import 或 include 機制 | 沒找到 | ADR-0001 的推翻條件 | 有的話，記錄下來就好，不改決策。ADR-0001 選擇「不使用 import」並不是因為 Codex 缺少這個功能 |
| C6 | global `AGENTS.md` 在 Codex app 的 project chat 是否會被注入，也就是 #27705 的狀態 | issue 回報 global 檔沒有被注入 | `codex-global` 在 Codex app 是否真的生效 | 仍未修復 → `surfaces.yaml` 的 `codex-global` 加註「Codex app project chat 不生效」，在 Codex app 上的 eval 和手動測試改用 CLI |
| C7 | Codex app 的 Settings → Personalization → Custom instructions 是否直接寫入 `~/.codex/AGENTS.md` | 是 | ADR-0004 的 drift 來源 | 若是，代表 drift 偵測必須保留，不需要改設計。若否，就把 UI 設定視為另一個載入點，評估是否新增 surface |
| C8 | Codex 是否支援 skills；支援的話，路徑在哪裡、格式是否與 `SKILL.md` 相容 | 未知 | `check-deps` 的 Codex 端（ADR-0002 `depends_on`） | 支援 → 在 `deps.yaml` 加入 Codex 的路徑。不支援 → 依賴 skill 的規則在 Codex surface 一律不能標 `implemented` |
| C9 | ChatGPT Custom Instructions 有幾個欄位、各自的字數上限；這些設定是否也套用到 Codex cloud | 付費帳號上限 5,000 字元（2026-07 調高）；是否套用到 Codex cloud 未知 | `surfaces.yaml` 中 `chatgpt` 的上限；S2 | 把上限寫入 `surfaces.yaml`。若會套用到 Codex cloud，S2 要加做 global canary（見 S2 步驟 3） |
| C10 | `codex exec` 的非互動參數：指定 model、輸出最後訊息到檔案、JSON 輸出、sandbox 與 approval 設定、略過 git 檢查 | 未知 | S1 指令和 eval runner | 把查到的 flag 填回 S1 步驟 C-3 的佔位符 |
| C11 | 如何取得一次執行實際使用的 model id，例如從 output、log 或 session 檔 | 未知 | rationale 的 `model` 欄位、run 紀錄 | 若取不到，run 紀錄改記「CLI 版本 + 設定檔中的 model」，並在紀錄中註明這個 model id 是推定值 |

### 選查（不阻擋開工）

| # | 查核事項 | 影響範圍 |
|---|---|---|
| C12 | Codex 是否會把 `AGENTS.md` 中的 HTML 註解剝除後才注入 | 僅供參考。ADR-0002 已決定不使用標記 |
| C13 | `~/.codex/AGENTS.md` 是 symlink 時，Codex 會怎麼處理 | ADR-0004 的推翻條件 |

---

## Part 2：Spike S1：eval 隔離

### 目標

驗證 `claude -p` 和 `codex exec` 能否滿足下面兩個條件：
1. 讀到暫存目錄中的部署檔。注入層級要和真實使用時相同：global 檔放在 user 層，repo 檔放在 project 層。
2. 不讀寫真實的 `~/.claude`、`~/.codex`。

- 時間盒：1 小時。
- 執行時機：實作 eval runner 之前。

### 準備

- 關閉所有正在執行的 Claude Code 和 Codex session，避免它們寫入 home 目錄，干擾「真實目錄有沒有被寫入」的判斷。
- 以下指令適用於 macOS 和 Linux 的 bash 或 zsh。

```bash
export S1=$(mktemp -d)
touch "$S1/marker"          # 時間戳基準：之後比對有沒有檔案比這個更新
echo "$S1"
```

### Claude Code

**C-1 認證**

改用新的 `CLAUDE_CONFIG_DIR` 之後，CLI 可能讀不到原本的登入狀態。所以先產生一個長效 token，放進環境變數：

```bash
claude setup-token          # 產生 token，會印在終端機上，不會自動儲存
read -rs CLAUDE_CODE_OAUTH_TOKEN && export CLAUDE_CODE_OAUTH_TOKEN   # 貼上 token；-s 讓輸入不顯示
```

token 不要寫進任何檔案，也不要 commit。

**C-2 Method A：global 層注入**

把部署檔放在暫存設定目錄的 `CLAUDE.md`，透過 `CLAUDE_CONFIG_DIR` 讓 CLI 把它當成 user 層讀取。

```bash
mkdir -p "$S1/claude-cfg" "$S1/claude-cwd"
cat > "$S1/claude-cfg/CLAUDE.md" <<'EOF'
Begin every response with the exact line: CANARY-S1-CLAUDE-GLOBAL
EOF

cd "$S1/claude-cwd" && \
CLAUDE_CONFIG_DIR="$S1/claude-cfg" \
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 \
claude -p --no-session-persistence --output-format json \
  "Quote verbatim the first line of every instruction file (CLAUDE.md or similar) you were given, with its path if known. Then say hi." \
  > "$S1/claude-global.json"
```

**C-3 Method B：project 層注入**

把部署檔放在 cwd 的 `CLAUDE.md`，再用 `--setting-sources project` 排除 user 層。user 層同樣指向一個空的暫存目錄，作為雙重保險。

```bash
mkdir -p "$S1/claude-repo" "$S1/claude-cfg-empty"
cat > "$S1/claude-repo/CLAUDE.md" <<'EOF'
Begin every response with the exact line: CANARY-S1-CLAUDE-REPO
EOF

cd "$S1/claude-repo" && \
CLAUDE_CONFIG_DIR="$S1/claude-cfg-empty" \
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 \
claude -p --no-session-persistence --setting-sources project --output-format json \
  "Quote verbatim the first line of every instruction file you were given, with its path if known. Then say hi." \
  > "$S1/claude-repo.json"
```

**C-4 對照組：確認真實 global 沒有混進來**

使用空的設定目錄、cwd 中也沒有 `CLAUDE.md`。預期結果是：不出現任何 canary，也引用不到你真實 `~/.claude/CLAUDE.md` 的內容。

```bash
mkdir -p "$S1/claude-empty-cwd"
cd "$S1/claude-empty-cwd" && \
CLAUDE_CONFIG_DIR="$S1/claude-cfg-empty" \
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 \
claude -p --no-session-persistence --output-format json \
  "Quote verbatim the first line of every instruction file you were given. If none, say NONE." \
  > "$S1/claude-control.json"
```

### Codex

flag 已依 C10 查核結果（codex-cli 0.153.4）填入。注意 `~/.agents/skills` 不受 `CODEX_HOME` 隔離，見 [C2](codex-verification-result.md#c2-codex_home)。

**X-1 認證**

改用新的 `CODEX_HOME` 之後，需要讓 Codex 能在暫存目錄中完成認證。實際方式依 `codex login --help` 為準，二選一：
- 在暫存的 `CODEX_HOME` 下重新登入一次。
- 使用 API key 環境變數。

不要把真實 `~/.codex` 裡的認證檔複製到暫存目錄。若真的非複製不可，實驗結束後立即刪除暫存目錄。

**X-2 Method A：global 層注入**

```bash
mkdir -p "$S1/codex-home" "$S1/codex-cwd"
cat > "$S1/codex-home/AGENTS.md" <<'EOF'
Begin every response with the exact line: CANARY-S1-CODEX-GLOBAL
EOF
cd "$S1/codex-cwd" && git init -q

CODEX_HOME="$S1/codex-home" codex exec -s read-only --ephemeral -o "$S1/codex-global.txt" \
  "Quote verbatim the first line of every AGENTS.md you were given, with its path if known. Then say hi."
```

**X-3 Method B：project 層注入**

```bash
mkdir -p "$S1/codex-repo" "$S1/codex-home-empty"
cd "$S1/codex-repo" && git init -q
cat > AGENTS.md <<'EOF'
Begin every response with the exact line: CANARY-S1-CODEX-REPO
EOF

CODEX_HOME="$S1/codex-home-empty" codex exec -s read-only --ephemeral -o "$S1/codex-repo.txt" \
  "Quote verbatim the first line of every AGENTS.md you were given, with its path if known. Then say hi."
```

**X-4 對照組**

使用空的 `CODEX_HOME`，cwd 是一個空的 git repo。預期結果是：不出現任何 canary，也引用不到真實 `~/.codex/AGENTS.md` 的內容。

### 檢查

```bash
# 1. 各 output 是否出現對應的 canary
grep -l "CANARY-S1" "$S1"/*.json "$S1"/*.txt

# 2. 真實 home 有沒有被寫入（應該沒有輸出）
find ~/.claude ~/.codex -newer "$S1/marker" -type f 2>/dev/null
find ~ -maxdepth 1 -newer "$S1/marker" -type f 2>/dev/null   # 例如 ~/.claude.json

# 3. 結束後清理（含暫存的認證）
rm -rf "$S1"; unset CLAUDE_CODE_OAUTH_TOKEN
```

檢查 2 必須沒有任何輸出。如果有輸出，先確認寫入的檔案是不是其他程式造成的，再判定隔離是否失敗。

### 判定（每個工具 × 每個層級各判一次）

| 結果 | 判定 | 後續處理 |
|---|---|---|
| 出現對應的 canary，對照組乾淨，真實 home 沒有被寫入 | `native` | eval runner 採用這個方法 |
| 只有改用 `--append-system-prompt-file` 這類 system prompt 注入時才出現 canary | `proxy` | 該 surface 的 run 一律標記為 proxy；要升級成 `implemented`，必須附上手動測試佐證（ADR-0003） |
| 出現 canary，但對照組也引用到真實的 global 內容 | 隔離失敗 | 改試其他隔離方法；仍然失敗的話，該 surface 只做手動測試 |
| 真實 home 被寫入 | 隔離失敗 | 同上，並先確認寫入了哪些內容，判斷是否需要復原 |

### 結果記錄

把結果寫到 `docs/spikes/S1-result.md`。每列包含：工具、版本（`claude -v`、`codex --version`）、方法、canary 是否出現、對照組是否乾淨、home 是否被寫入、判定。

---

## Part 3：Spike S2：Codex cloud 讀取來源

### 目標

確認 Codex cloud 會讀取哪些 instruction 來源。

- 時間盒：30 分鐘。
- 執行時機：在 Codex cloud 首次實際使用本 repo 之前。

### 步驟

1. **建立實驗分支**，避免動到主線：

   ```bash
   git checkout -b spike/s2-codex-cloud
   cat > AGENTS.md <<'EOF'
   Begin every response with the exact line: CANARY-S2-REPO
   EOF
   git add AGENTS.md && git commit -m "spike: S2 canary" && git push -u origin spike/s2-codex-cloud
   ```

   如果 repo 裡已經有正式的 `AGENTS.md`，改成把 canary 加在檔案最前面，不要整份覆蓋。

2. **送出任務**：在 Codex cloud 選擇本 repo 和 `spike/s2-codex-cloud` 分支，送出以下 prompt：

   ```
   Do not modify any files. Quote verbatim the first line of every instruction source you were given (AGENTS.md, custom instructions, environment instructions), with its origin if known. Then say hi.
   ```

3. **（C9 結果為「會套用」時才做）global canary**：
   - 暫時在 ChatGPT 或 Codex 的 Custom instructions 最前面加一行 `Begin every response with the exact line: CANARY-S2-GLOBAL`。
   - 做之前先把原本的內容複製保存下來。
   - 重做步驟 2。
   - 做完立即還原原本的內容。

4. **清理**：

   ```bash
   git checkout - && git push origin --delete spike/s2-codex-cloud && git branch -D spike/s2-codex-cloud
   ```

   刪除遠端分支是不可逆操作，執行前先確認分支名稱正確。

### 判定

| 觀察 | 後續處理 |
|---|---|
| 只出現 `CANARY-S2-REPO` | 假設成立，Codex cloud 併入 `codex-repo` |
| 另外出現 `CANARY-S2-GLOBAL` | Codex cloud 會讀 Custom instructions，在 `surfaces.yaml` 註記 `chatgpt` 的內容也作用於 Codex cloud，評估是否需要分開撰寫 |
| 沒出現 `CANARY-S2-REPO` | 新增獨立的 surface `codex-cloud`，並查出它實際讀取的來源 |
| 引用到其他來源，例如環境設定中的 instructions | 新增 surface，或把該來源列入 drift 偵測範圍 |

### 結果記錄

把結果寫到 `docs/spikes/S2-result.md`。內容包含：日期、Codex cloud 介面上顯示的 model、步驟 2 和步驟 3 的 output 摘錄、判定。
