# Prompt audit — 2026-10-17

提案 diff：[`2026-10-17-prompt-audit.patch`](2026-10-17-prompt-audit.patch)（尚未套用；已在 scratch 複本上套用並通過 `npm run lint`）。

## 假設

- **範圍**：整個 repo 的 prompt surface。
  - 部署來源：`surfaces/claude-code/CLAUDE.md`、`surfaces/claude-ai/preferences.md`、`surfaces/codex/AGENTS.md`
  - Repo 層：`CLAUDE.md`、`AGENTS.md`
  - 跟著上面這些檔案走的規格檔：`intents.yaml`、`rationale/*.yaml`
  - **不在範圍內**：
    - `~/.claude/` 底下已部署的檔案，以及 `~/.claude/harness/maintenance.md`（都在 repo 外，沒有讀）
    - `.claude/settings*.json`（照指引規定不讀）
- **Target model**：
  - Claude Code 與 claude.ai 兩個 surface 以 Claude Opus 5.5 為準（依據 `surfaces.yaml:11,27,41`）。
  - `surfaces/codex/AGENTS.md`、`AGENTS.md` 和 ChatGPT surface 是 non-Anthropic surface（`surfaces.yaml:63,84` 標的是 `GPT-6.1 Sol`）。這幾個檔案只拿來比對「repo 事實與跨檔衝突」（Group 2），不套 Claude 的行為規則，diff 也不改它們。
- **出處（provenance）**：
  - 所有規則都在 2026-10-09 一批遷入，`git blame` 看不出原本是為了防哪個 model 的問題。
  - 對應的 rationale 也都是 `observed: unobserved`、`model: null`。
  - 因此判斷依據改為：repo 內部是否矛盾，以及 target model 的文件行為。

## 摘要

影響最大的兩點：

1. **`CLAUDE.md:3` 的 ADR 衝突處理跟規格相反。** 它寫「先指出衝突點再動手」，但 `intents.yaml:7` 的 `repo.orientation` 寫「不自行取捨」，Codex 版（`AGENTS.md:5`）也寫「停下來回報」。結果是：遇到需求和 ADR 衝突時，Claude Code 會講完衝突就直接選一邊做下去，Codex 則會停下來等你決定。
2. **`surfaces/claude-code/CLAUDE.md:107` 的 plan-mode 路由列跟同檔規則打架。** 它寫「多步驟／>3 檔 → 先進 plan mode」，同一檔第 35–36 行卻寫「偏好行動、需求清楚就直接執行」。另外，你已部署的 `~/.claude/CLAUDE.md` 已經把這一列改成「實作方向有未定案取捨才進 plan mode」，repo 卻還停在舊版。下次 deploy 會把你在線上改好的規則覆蓋回去。

數量：Group 1 有 1 項。Group 2 有 2 項高信心，另有 2 項只 flag。Group 3（tool definitions）與 Group 4（request code）不適用，因為 repo 裡沒有呼叫 API 的程式碼，也沒有 tool schema。

## Findings

### 1. ADR 衝突處理與 intent／Codex 版矛盾 — High

- **位置**：`CLAUDE.md:3`，以及 `rationale/claude-code-repo.yaml:4`
- **原文**：「需求和 ADR 衝突時，先指出衝突點再動手。」
- **對應的 pattern**：Group 2 — Instruction files that contradict each other
- **為什麼過時**：
  - 這條規則在 repo 裡有兩個依據，`CLAUDE.md:3` 跟兩者都不一致。
  - 依據一：`intents.yaml:7` 是 ADR-0001 定義的平台中立規格，寫的是「先提出，不自行取捨」。
  - 依據二：同一個 intent 在 `AGENTS.md:5` 被渲染成「停下來回報，不要自行選擇」。
  - Opus 5.5 會照字面執行「再動手」，所以講完衝突點就會繼續做。
- **動作**：`rewrite` 成「需求和 ADR 衝突時，先指出衝突點，等我決定後再動手。」rationale 的 `text` 也同步改。
- **方向假設**：以 intent 規格為準。這次修改讓規則變嚴，不是放寬。

### 2. plan-mode 路由列與「偏好行動」矛盾，且落後已部署版本 — High

- **位置**：
  - `surfaces/claude-code/CLAUDE.md:107`
  - `rationale/claude-code-global.yaml:389,401`
  - `intents.yaml:251`（`workflow.plan-first`）
- **原文**：「| 多步驟／會動到 >3 檔的任務 | 先進 plan mode 出方案，核准後再動手 |」
- **對應的 pattern**：
  - Group 2 — 跨檔或同檔矛盾。同一檔第 35–36 行「需求夠清楚就直接執行，不要反覆確認」。
  - Group 1b — "plan before acting"。
- **為什麼過時**：
  - 用檔案數量和步驟數量當觸發條件，太容易成立。Opus 5.5 本來就會自己規劃；每碰到多檔任務就進 plan mode，會造成過度規劃，也會打斷你「偏好行動」的設定。
  - 你已部署的全域檔已經換成「需求已清楚，但實作方向有未定案的取捨（架構、範圍、相容性），選錯需重做」，repo 這份是舊文字。
- **動作**：`rewrite`，路由列改成已部署版本的文字，`intents.yaml` 的 goal 也照同樣語意改寫。
- **附註**：
  - 已部署版本在「對話對象」段還多一句「任務有多個步驟或涉及多個檔案，本身不構成進 plan mode 的理由。」這一句屬於另一個 intent 紀錄。diff 沒有補這句，因為改寫路由列就已經消除矛盾。要讓 repo 跟線上完全一致，需要另外把這句遷入。
  - 這是跨檔衝突修正，照指引只提案、不自動套用。

### 3. `tone.direct` 是一串沒有出處的輸出風格禁令 — Medium

- **位置**：
  - `surfaces/claude-code/CLAUDE.md:13`
  - `surfaces/claude-ai/preferences.md:7`
  - 對應的 rationale
- **原文**：「直接、不客套。不要開場寒暄、不要結尾總結「我做了什麼」、不要過度道歉。」
- **對應的 pattern**：Group 1e — Prohibition clusters（列舉要避免的口頭禪，又沒有出處）
- **為什麼過時**：
  - 三條禁令描述的都是輸出風格，不是業務限制；rationale 記錄 `evidence: none`。
  - 指引建議改成一行正面描述。理由是：列舉某個 model 不會犯的毛病，反而可能把它往那個方向錨定。
  - 同檔第 11–12、14 行已經從正面講了長度與精簡度，這一條改寫後不會漏掉原本的意圖。
- **動作**：`rewrite` 成「直接、不客套:第一句就進入正題,答完即停;只在真的出錯時道歉。」
- **不改的部分**：Codex／ChatGPT surface 不在 Claude target 範圍內，維持原文；`intents.yaml:59` 的 goal 是語意描述，不需要改。

### 4. Cowork 匯入段要求先讀 `AGENTS.md`，和 repo 的檔案分工衝突 — Flag

- **位置**：`surfaces/claude-ai/preferences.md:75` 對上 `CLAUDE.md:6`、`intents.yaml:22`
- **原文**：「專案規範以預設資料夾下的 `AGENTS.md` 內容為優先，如 `AGENTS.md` 未存在則讀取 `CLAUDE.md`…」
- **問題**：
  - 如果 Cowork 以本 repo 當預設資料夾，Claude 會優先讀 Codex 專用的 `AGENTS.md`，裡面還有 `project_doc_fallback_filenames` 這類 Codex 才懂的設定。這跟「`AGENTS.md` 只給 Codex 讀」的分工相反。
  - 這一行把四層條件塞進同一句，也違反同一檔第 19 行「條件、例外與但書跟主張分開講」。
- **為什麼只 flag**：兩邊管的是不同 agent，而且 Cowork 匯入段是刻意保留的使用者設定。要由你決定：
  - Cowork 改成先讀 `CLAUDE.md`；或
  - 接受這個例外，並寫進 ADR。

### 5. `harness/maintenance.md` 兩處路徑寫法不一致 — Flag（Low）

- **位置**：`surfaces/claude-code/CLAUDE.md:4` 寫 `harness/maintenance.md`（相對路徑），同檔第 106 行寫 `~/.claude/harness/maintenance.md`。
- **說明**：路徑在 repo 外，沒有去確認檔案存不存在。`deps.yaml` 也沒有把它列為依賴，lint 抓不到它失效的情況。建議兩處統一寫成絕對路徑，或者把它加進 `deps.yaml`。

## 檢查過、決定保留的項目

- **「門檻:超過 50 行的產出一律落檔」（`:18`）**：決定的是內容放對話還是放檔案，屬於格式路由，不是字數上限，不會壓縮推理空間。
- **「過程中只在有重要發現或改變方向時回報」（`:65`）**：已經講清楚什麼時候該回報，正是指引推薦的寫法，不算 update suppressor。
- **觸發段與路由表的重複**：兩邊內容一致，屬於能正常運作的重複（keep list 第 8 條）。
- **安全與限制段的禁令**：都對應實際的限制（不可逆操作、外部狀態、密鑰），保留。
