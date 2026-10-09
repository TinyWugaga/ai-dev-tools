# ADR-0001：Intent spec 與各 surface 獨立部署檔

- 狀態：Accepted
- 日期：2026-10-04
- 來源：[ai-dev-tools-grill.md](ai-dev-tools-grill.md) #1

## 背景

前一個 project 以 `AGENTS.md` 作為唯一真相來源，`CLAUDE.md` 只寫 `@AGENTS.md`，各平台共用同一份措辭。實際使用後發現，不同 model 對同一句指令的反應不同，但這個架構沒有地方可以針對個別 model 調整措辭，只能整份一起改。

本 project 要管的 surface 共 7 個，涵蓋兩個 vendor：

| | chat | agentic（global） | agentic（repo） | agentic（cloud） |
|---|---|---|---|---|
| Claude | claude.ai preferences | Claude Code | Claude Code | — |
| OpenAI | ChatGPT Custom Instructions | Codex | Codex | Codex cloud |

Codex cloud 原本假設會讀 repo 的 `AGENTS.md`，因此併在 `codex-repo` 底下。[S2](../spikes/S2-result.md) 實測後推翻了這個假設：一般 cloud 任務的 cwd 不在 repo 內，不會載入 repo 的 `AGENTS.md`；ChatGPT Custom Instructions 也傾向不套用。所以 Codex cloud 拆成獨立的 surface，而且目前**沒有可以部署 instruction 的管道**。

ChatGPT Custom Instructions 與 `~/.codex/AGENTS.md` 雙向同步（2026-10-09 使用者實測）：在任一邊修改，另一邊都會跟著更新。兩者實際上是同一份資料，所以 `chatgpt` 改成 `channel: none`，內容只由 `codex-global` 維護。這份檔案同時供 ChatGPT 對話與 Codex agent 讀取，因此不能放只對 agent 有意義的規則，長度也受 ChatGPT 的 5,000 字元上限限制。

各 surface 在載入方式、長度限制和內容需求上都不一樣。例如 chat 不需要 git 相關規則，而 chat 類 surface 有字數上限。

## 決策

1. **`intents.yaml` 是平台中立的意圖清單，不部署。** 每個 intent 包含：
   - `id`
   - `goal`：要 model 做到什麼
   - `kinds`：`chat` 和／或 `agentic`
   - `scopes`：`global` 和／或 `repo`

   surface 的 `kind` 與 `scope` 同時落在 intent 的 `kinds` 與 `scopes` 內，這個 intent 就適用於該 surface。原本只有 `applies_to`（chat／agentic）一個維度，建 v1 骨架時發現「只適用於本 repo 維護」的 intent 不該套用到 global surface，所以補上 `scopes`。
2. **每個 surface 有一份完整、手寫的部署檔。** 措辭針對該 surface 的 model 與 harness 調整。不使用 build、concat 或 import 來組合內容。
3. **intent 與 surface 的每一種組合都必須有明確狀態**，記錄在 rationale 中（見 ADR-0002）：
   - 已實作：`implemented` 或 `experimental`
   - 明確不實作：`not-needed`
   - 尚未實作、也還沒決定：`unimplemented`。intent 適用於這個 surface，但部署檔裡目前沒有對應規則（2026-10-09 加入）。例如遷移時只有 Claude Code 全域檔有 dispatch、plan mode 等規則，Codex/ChatGPT 共用檔沒有。這類紀錄會出現在 lint 的待驗清單，直到補上規則或改成 `not-needed`。

   例外：`surfaces.yaml` 標為 `channel: none` 的 surface（目前是 `codex-cloud` 和 `chatgpt`）沒有載入管道，不列入這項完整性檢查。

   遷移期例外：`surfaces.yaml` 標為 `migration: pending` 的 surface，現行內容還沒遷入本 repo。缺少的 intent 紀錄由 lint 降為警告，這類 surface 也一律拒絕 deploy。內容遷入、補齊紀錄後移除這個旗標，就恢復原本的嚴格檢查。這個旗標只用於遷移，不能用來長期跳過檢查（2026-10-09 加入，原因是四個 global 來源無法一次取得）。

   不允許「未提及」。lint 負責檢查這項完整性。
4. **平台的切分單位是 surface，不是 vendor。**

## 後果

**正面**
- 共用的是意圖，不是措辭。每個 model 的措辭可以各自調整，不會互相牽動。
- 「為什麼這樣寫」有固定的掛點：intent × surface。
- 意圖漂移靠 lint 就能機械化檢查，不需要跑 eval。舉例：新增一個 intent 時，lint 會列出還沒有標狀態的 surface。
- 部署檔就是最終的檔案，所見即所得。

**負面**
- 同一個 intent 會在多份檔案裡用不同措辭重複出現。修改一個 intent 時，可能要同步改最多 6 份檔案（`codex-cloud` 沒有部署檔）。
- 「什麼該算成一個 intent」需要判斷。切得太細，管理成本會上升；切得太粗，rationale 就失去精確性。

## 替代方案

- **共用 core 加平台 overlay**：core 仍然是跨 model 共用措辭，等於把問題縮小，但沒有消除。Codex 沒有 import 機制（[查核 C5](../spikes/codex-verification-result.md#c5-import--include)，查閱於 2026-10-04），因此需要 build 步驟。另外，每條規則都要判斷該放 core 還是 overlay。否決。
- **各 surface 完全獨立，沒有 intent 清單**：意圖漂移無法偵測。在一人維護的情況下，改了一份忘了另一份是可預期的失誤。否決。

## 推翻條件

- 重複措辭的同步成本長期明顯超過收益。具體判斷標準：單一 intent 的修改平均需要同步 4 份以上的檔案，而且反覆出現漏改。
- 出現必須跨平台逐字一致的規則類別。這種情況不推翻整體架構，只加一個例外：該 intent 附上 canonical 措辭，由 lint 檢查各檔是否逐字一致。
