# ADR-0004：以 copy 部署並偵測 drift

- 狀態：Accepted
- 日期：2026-10-04
- 來源：[ai-dev-tools-grill.md](ai-dev-tools-grill.md) #5、#6
- 依賴：ADR-0001

## 背景

部署目標分成兩類。

**自動目標**：`~/.claude/CLAUDE.md`、`~/.codex/AGENTS.md`。

**手動目標**：claude.ai preferences、ChatGPT Custom Instructions。

除了本 repo，還有其他來源會直接寫入自動目標：

- Codex app 的 Custom instructions UI 會寫入 `~/.codex/AGENTS.md`（2026-10-05 實測，見[查核 C7](../spikes/codex-verification-result.md#c7-codex-app-custom-instructions-的寫入位置)）。
- Claude Code 可能被要求「記住」某件事，因而寫入 `~/.claude/CLAUDE.md`。

已查證的事實（[code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)，查閱於 2026-10-04）：在 Cowork session 中，如果 `~/.claude/CLAUDE.md` 本身是 symlink，Claude Code 會略過它，而且不會提示。

## 決策

### 1. 自動目標用 copy，不用 symlink

`deploy <surface>` 的流程：

1. 讀取 repo 外 state 檔中記錄的「上次部署內容 hash」。
2. 比對目標檔目前的 hash：
   - **一致**：覆蓋目標檔，更新 state。
   - **不一致**：停止部署並顯示 diff，由你選擇：
     - `pull`：把外部修改拉回 repo，並補寫 rationale。
     - `overwrite`：捨棄外部修改。
3. **首次部署**：如果目標檔已經存在，一律先備份為 `*.bak-<timestamp>` 再覆蓋。這個步驟沒有開關可以關閉。

### 2. 手動目標

1. `deploy <surface>` 輸出可直接貼上的全文，並顯示目前字數與上限的對照。上限取自 `surfaces.yaml`。
2. 你貼上後，執行 `deploy <surface> --confirm`，記錄這次的 hash 和時間。
3. script 無法驗證你是否真的貼上，所以 `status` 會把這類目標標示為「手動確認」。

### 3. `status`

列出每個 surface 屬於以下哪種狀態：
- 已同步
- repo 有變更但尚未部署
- 目標檔被外部修改（drift）
- 手動確認

### 4. 執行時機

`deploy` 只在你手動執行時才會寫入 `~`。不掛 hook，也不自動執行。

### 5. 附帶檢查

- **`~/.claude/rules/`**：如果裡面有不是本 repo 管理的檔案，列出警告。依官方文件，user rule 與其他規則衝突時，Claude 可能任選一條遵守。
- **`~/.codex/AGENTS.override.md`**：如果這個檔案存在且非空，就發出警告。Codex 在 global 層只會取第一個非空檔，並且優先讀 override，所以部署的 `AGENTS.md` 會整份失效（[查核 C1](../spikes/codex-verification-result.md#c1-global-檔載入規則)，查閱於 2026-10-04）。
- **repo 根目錄的 `CLAUDE.md` 與 `AGENTS.md`**：兩者都是實體檔，不需要 deploy。repo 的 `CLAUDE.md` 和 README 要註明「不要使用 `claude-md-and-agents-md` 設定」。原因：Claude Code 在預設設定下，只要有 `CLAUDE.md` 就不會讀 `AGENTS.md`；改用這個設定後，會同時讀入給 Codex 用的 `AGENTS.md`。

### 6. 預留拆分空間

`surfaces.yaml` 中部署目標的格式是清單（`files: [...]`），預留日後把 `claude-code-global` 拆到 `~/.claude/rules/` 的空間。滿足以下任一條件時拆分：
- `claude-code-global` 超過 200 行。這是官方建議的單檔上限。
- 出現只適用於特定檔案類型的 intent。

## 後果

**正面**
- 每次部署都對應到一個 git revision，rationale 的 `checked` 欄位和 eval run 都能指出當時實際生效的版本。
- 外部寫入不會被靜默覆蓋，也不會靜默混進 repo。
- 避開 Cowork 對 symlink 的靜默失效。
- 覆蓋 global 檔之前一定有備份。

**負面**
- 改完 repo 必須記得執行 `deploy`，否則 repo 與實際生效的內容不一致。
- 手動目標是否真的部署，只能依賴你執行 `--confirm`。

## 替代方案

- **symlink**：改完即時生效，外部修改也會直接出現在 `git diff`。但在 Cowork 下會靜默失效，而 Codex 處理 symlink 的行為未經查證。否決。

## 推翻條件

- `status` 反覆顯示「repo 有變更但尚未部署」，表示 repo 與部署長期不同步。此時加上 git post-commit 提醒，只提醒、不自動部署。
- Cowork 不再略過 symlink，且確認 Codex 能正確處理 symlink。此時可以重新評估 symlink，但第 1 節中「部署對應到 revision」這個理由仍然成立。
