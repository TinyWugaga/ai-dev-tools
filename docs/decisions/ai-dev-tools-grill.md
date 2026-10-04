# ai-dev-tools 決策集（grill 收斂版）

日期：2026-10-04
性質：pre-ADR 決策集。標 **[ADR]** 的項目已展開為正式 ADR：[0001](0001-intent-spec-and-per-surface-files.md)、[0002](0002-rationale-records-quote-rule-text.md)、[0003](0003-eval-gates-status-not-deploy.md)、[0004](0004-copy-deploy-with-drift-detection.md)。

## 範圍與非目標

**範圍**

- 管理跨 AI 平台協作規範：Claude 與 ChatGPT/Codex 的 global instruction，以及本 repo 自用的 local instruction（`CLAUDE.md`、`AGENTS.md`）。
- 每條規則可追溯「因應哪個 model 行為而設」，並有可重跑、可對照（有規則 vs 無規則）的驗證紀錄。
- 手動 surface（claude.ai preferences、ChatGPT Custom Instructions）提供可貼上的全文、手動測試條件與範本，由使用者自行更新與測試。

**非目標**

- 不提供其他 repo 的 local instruction 範本或同步。
- v1 不管理 skill 本體（只以依賴方式引用，見 #7）。
- 不做跨平台一致性 eval、不做每次修改全量回歸、不做 skill trigger eval。
- 不沿用舊 project 的「數值判斷與量測」規範體系。
- 不追求跨平台措辭一致。

## 硬約束

- 一人維護。
- 目標 surface：claude.ai user preferences、Claude Code（`~/.claude/CLAUDE.md`、repo `CLAUDE.md`）、ChatGPT Custom Instructions、Codex CLI/IDE（`~/.codex/AGENTS.md`、repo `AGENTS.md`）、Codex cloud。
- 部署：可用 script（copy 到 `~/.claude`、`~/.codex`）；兩個 chat surface 只能手動貼上。
- 現行 global preferences 在 project 完成前不更動；舊 project 淘汰。
- skill 有 upstream 原始碼位置（位置待實作時設定）。

## 成功條件

1. 每條部署中的規則都能回答「為什麼這樣寫」：對應的 intent、觀察到的 model 行為、觀察時的 model 與日期。
2. 規則的效果有可重跑的對照紀錄（有規則 vs 無規則），或明確標示尚未驗證（`experimental`）。
3. 新增或修改規則不被 eval 阻擋；eval 成本有硬上限。
4. 部署到各 surface 的內容可對回 repo revision；repo 外的改動不會被靜默覆蓋或靜默併入。

## 決策帳本

| # | 決策點 | 狀態 | 結論 |
|---|--------|------|------|
| 1 | 分層模型 **[ADR]** | ✅ | intent spec（平台中立、不部署）＋各 surface 獨立完整部署檔；切分單位為 surface |
| 2 | Rationale 資料模型 **[ADR]** | ✅ | `rationale/<surface>.yaml` 逐字引用規則原文，lint 雙向比對；`not-needed` 需 evidence；`evidence: none` 只能是 `experimental` |
| 7 | Skills 是否進 v1 | ✅ | 不管理本體；`depends_on` + `pinned` hash；更新流程含 `check-deps`；skill 化是升級路徑 |
| 3 | Eval 範圍與成本上限 **[ADR]** | ✅ | eval 只把關 status 標籤，不擋部署；單位 intent×surface；leave-one-out；硬上限 18 次（自動）/ 4 次（手動） |
| 5 | 目錄佈局與 surface 對應 | ✅ | 7 個 surface ID（S2 後新增 `codex-cloud`，`channel: none`）；`surfaces.yaml` 部署目標為清單；repo 根 `CLAUDE.md`/`AGENTS.md` 為實體檔 |
| 6 | 部署機制 **[ADR]** | ✅ | copy ＋ drift 偵測 ＋ 首次備份；手動 surface 以 `--confirm` 記錄 |
| 4 | Eval 執行機制 | ✅ | 隔離＋同層注入（否則標 proxy）；assertion 優先、LLM judge 限二元題；case/run 格式固定 |
| S1 | Eval 隔離可行性 | ✅ 2026-10-05 | 4 組皆 `native`；Codex 需同時隔離 `HOME`；model 需明確指定；以引用判定載入（[S1-result](../spikes/S1-result.md)） |
| S2 | Codex cloud 讀取來源 | ✅ 2026-10-05 | 一般任務不載入 repo `AGENTS.md`；Custom Instructions 傾向不套用 → 新增 `codex-cloud`（[S2-result](../spikes/S2-result.md)） |

---

## #1 分層模型 [ADR-0001]

**結論**
- `intents.yaml`：平台中立的意圖清單（ID、目標、`applies_to`），不部署。
- 每個 surface 一份完整、手寫、措辭針對該 model 調整的部署檔；每條規則對應一個 intent ID。
- 某 surface 不需要某 intent 時明確標 `not-needed`，不允許「未提及」。
- 平台切分單位是 surface（非 vendor）。目前無「跨平台逐字一致」的例外。

**理由**
- 舊 project 失敗的根源是共用措辭；本方案共用意圖、不共用措辭。
- rationale 有固定掛點（intent × surface）。
- 意圖漂移可用 lint 機械檢查，不需 eval。
- 部署檔為完整檔，不需 build。
- 同 vendor 的 chat 與 agentic harness 在內容需求與長度限制上差異大，因此以 surface 切分。

**否決方案**
- 共用 core＋overlay：core 仍是跨 model 共用措辭，且 Codex 端可能需要 build/concat。
- 各 surface 完全獨立、無 intent 清單：意圖漂移無法偵測。

**推翻條件**
- intent 數量與 surface 數量使重複措辭的維護成本明顯超過收益（例如單一 intent 修改平均需要同步 4 個以上檔案，且反覆漏改）。
- 出現必須跨平台逐字一致的規則類別：此時加入「intent 附 canonical 措辭＋lint 檢查逐字一致」的例外，不推翻整體。

## #2 Rationale 資料模型 [ADR-0002]

**結論**
- `rationale/<surface-id>.yaml`，每筆記錄如下：

  ```yaml
  - intent: lang.zh-tw
    status: implemented        # implemented | not-needed | experimental | stale
    text: "<部署檔中的逐字原文>"
    observed: "無此規則時，<model> 在 X 情境會 Y"
    model: <model id>
    checked: 2026-10-04
    evidence: evals/runs/<id> | manual-tests/<id> | none
    revisit_when: "..."
    depends_on: []             # 見 #7
  ```

- lint 雙向比對：
  - 每筆 `text` 必須逐字存在於部署檔。
  - 部署檔中每個規則段落必須被某筆記錄引用。
- `not-needed` 必須填 `observed` 與 `evidence`。
- `evidence: none` 時 `status` 只能是 `experimental`；lint 列出所有 `experimental`。

**理由**
- rationale 不能進部署檔：會吃掉 chat surface 的字數上限，對 model 也只是噪音。
- 逐字引用不需在部署檔放標記、也不需 build。
- 改措辭必須同步改 rationale，正好強制記錄「為什麼改」。
- 依 surface 分檔：model 更新時，以 surface 為單位整批檢查。

**否決方案**
- 部署檔內嵌 HTML 註解標記：Codex 是否剝除未知；手動貼上的 surface 會把標記一起貼入。
- 原始檔帶標記、部署時剝除：需要 build，抵銷 #1 的好處。

**推翻條件**
- 逐字比對造成的摩擦實際阻礙了措辭迭代（例如常因空白或標點不同而 lint 失敗）：改為正規化後比對，不改資料模型。
- 部署檔格式必須包含無法逐字引用的結構（例如 Codex 改用非 Markdown 設定檔）。

## #7 Skills 是否進 v1

**結論**
- v1 不管理 skill 本體，也不做 trigger eval。
- 規則若依賴 skill，在 rationale 記錄 `depends_on`，並記錄蒐集 evidence 當時各 surface 的內容 hash：

  ```yaml
  depends_on:
    - skill: token-preflight
      pinned:
        claude-code-global: sha256:...
        claude-ai: manual
  ```

- 只有在 surface 確實可載入該 skill 時，相關規則才能是 `implemented`。
- 更新流程含 `check-deps`，做兩組比對：
  - **已安裝 vs upstream**：列出各 surface 需要更新的 skill。
  - **已安裝 vs pinned**：若不一致，依賴它的規則標為 `stale`。
  - 另外：未安裝的 skill 會使依賴它的規則不能是 `implemented`；跨 surface 版本不一致時列出差異。
  - CLI surface 由 script 計算 hash；claude.ai 產出手動核對清單。
  - Codex 的 skill 路徑：`$CODEX_HOME/skills/<name>/` 與 `~/.agents/skills/<name>/`，格式與 Claude Code 的 `SKILL.md` 相容（[C8](../spikes/codex-verification-result.md#c8-skills)）。
- skill 是升級路徑：某 intent 在某 surface 以規則文字實作，evidence 顯示仍失敗，且失敗原因是「規則過長或只在特定任務需要」時，才針對該 surface 開啟 skill 化討論。

**理由**
- 目前沒有證據顯示需要 skill。
- skill 的 eval（trigger 測試）是舊 project 成本爆量的主因之一。

**否決方案**
- v1 全面納入 skill：一開始就要建 trigger eval，範圍翻倍。
- 只納入 Claude 端 skill：範圍不對稱，仍需建 trigger eval。

**推翻條件**
- 出現兩個以上 intent 符合上述升級條件。
- Codex 與 Claude 的 skill 機制確認可共用同一套 trigger eval。

## #3 Eval 範圍與成本上限 [ADR-0003]

**結論**
- eval 只把關 status 標籤，**永不阻擋部署**。
  - 新增或修改的規則直接部署，狀態為 `experimental`。
  - 升級為 `implemented` 或 `not-needed` 時才需要 eval。
- 以下情況自動降級（規則留在部署檔，只是列入 lint 待驗清單）：
  - 措辭改動 → `experimental`
  - surface 的 model 更換 → `stale`
  - 依賴的 skill 變動 → `stale`
- 單位：一個 intent × 一個 surface。
- 對照組採 leave-one-out：完整部署檔減去該規則原文。
- 上限（target 值）：

  | | 自動 surface | 手動 surface |
  |---|---|---|
  | prompts | ≤ 3 | ≤ 2 |
  | 每組重跑次數 | 3 | 1 |
  | 組數 | 2 | 2 |
  | 總次數上限 | 18 | 4 |

- 通過條件：
  - `implemented`：有規則組 3 次中 ≥ 2 次達標，且優於無規則組。
  - `not-needed`：無規則組 3 次全部達標。
  - 手動 surface：1 次 vs 1 次，evidence 標 `strength: manual`。
- 允許超出上限，但需在 rationale 寫明理由；lint 列出所有超標項目。
- model 更新：該 surface 全部規則標為 `stale`，依優先序逐步補驗，不設期限。
- `experimental` 規則的數量與存在時間不設限制。

**理由**
- 舊 project 的 eval 是部署關卡，導致 eval 成本直接變成迭代成本。
- leave-one-out 量的是規則在真實 context 中的邊際貢獻。
- 規則原文已存在 rationale，移除可以機械化完成。

**否決方案**
- eval 作為部署關卡：重蹈覆轍。
- 只做手動觀察紀錄：不可重跑，不滿足成功條件 2。
- 對 `experimental` 設數量或天數上限：會重新製造測試壓力。

**推翻條件**
- `experimental` 長期累積到你無法判斷哪些規則真的有效（例如超過部署規則總數的一半，且持續 3 個月以上）：此時再討論加上限。
- 18 次的上限反覆不足以得出結論（例如結果在 1/3 與 2/3 之間擺盪）：調整重跑次數，不改架構。

## #5 目錄佈局與 surface 對應

**結論**

```
intents.yaml
surfaces.yaml                 # id、部署目標 files: [...]、deploy 方式、字數上限（含來源與查閱日期）
surfaces/
  claude-ai/preferences.md          # 手動
  claude-code/CLAUDE.md             # → ~/.claude/CLAUDE.md
  chatgpt/custom-instructions.md    # 手動
  codex/AGENTS.md                   # → ~/.codex/AGENTS.md
CLAUDE.md                     # surface: claude-code-repo
AGENTS.md                     # surface: codex-repo
rationale/<surface-id>.yaml
evals/<surface-id>/<intent-id>/
manual-tests/<surface-id>/<intent-id>.md
deps.yaml
scripts/
docs/decisions/
```

- surface ID：`claude-ai`、`claude-code-global`、`claude-code-repo`、`chatgpt`、`codex-global`、`codex-repo`、`codex-cloud`。
- `codex-cloud`：依 S2 結果獨立成 surface，標 `channel: none`。目前沒有可部署的管道，不建部署檔，也不列入 intent 完整性檢查。重新評估的條件：第一次用 Codex cloud 跑本 repo 時，補測 S2 的未解項目。只要其中一項找到可載入 instruction 的管道，就把 `channel` 改成該管道，並開始建立部署檔。
- 已回寫的查核值：`chatgpt` 上限 5,000 字元（Plus 方案）；`codex-repo` 上限 32,768 bytes（project 層合計，超過會被靜默截斷）；`codex-global` 無上限；`codex-global` 在 Codex CLI 與 app 的 local project 生效，不適用於 Codex cloud。
- repo 根目錄的 `CLAUDE.md`、`AGENTS.md` 為實體檔，不用 symlink（Claude Code 的 Edit 工具拒絕透過 symlink 寫入）。
- 字數上限記在 `surfaces.yaml`；查不到上限者填 `unknown`，lint 只警告、不失敗。
- 部署目標使用清單格式，保留日後拆分到 `~/.claude/rules/` 的空間。
  - 拆分觸發條件：`claude-code-global` 超過 200 行，或出現只適用於特定檔案類型的 intent。
- `deploy` 時檢查 `~/.claude/rules/` 是否有非本 repo 管理的檔案，有就列出警告。
- repo `CLAUDE.md` 與 README 明寫：不要使用 `claude-md-and-agents-md` 設定，否則 Claude 會同時讀入 Codex 用的 `AGENTS.md`。

**理由**
- 已查證：Claude Code 預設在 `CLAUDE.md` 存在時不讀 `AGENTS.md`，因此 repo 根目錄可並存兩份內容不同的檔案。
- 來源：[code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)，查閱於 2026-10-04。

**否決方案**
- 本題由 #1～#3 收斂為唯一可行方向，沒有實質的替代方案。

**推翻條件**
- S2 的未解項目找到 Codex cloud 的載入管道：把 `codex-cloud` 從 `channel: none` 改為該管道。
- Claude Code 的預設 Project instructions 行為改變。
- Codex 支援 import 機制。

## #6 部署機制 [ADR-0004]

**結論**
- 自動 surface 使用 copy。
- 部署 state（最後一次部署的內容 hash）存放在 repo 之外。
- 每次 `deploy` 前比對目標檔目前的 hash：
  - 一致 → 直接覆蓋。
  - 不一致 → 停下來顯示 diff，由你選 `pull`（拉回 repo 並補 rationale）或 `overwrite`。
- 首次部署時，若目標檔已存在，一律先備份成 `*.bak-<timestamp>`，此行為不設開關。
- `status` 列出各 surface 的狀態：未部署變更、drift、手動確認。
- 手動 surface：
  1. `deploy <id>` 輸出可直接貼上的全文，並顯示字數與上限的比較。
  2. 貼上後執行 `deploy <id> --confirm`，記錄 hash 與時間。
- `deploy` 只在你手動執行時寫入 `~`，不掛 hook，也不自動執行。

**理由**
- 已查證：Cowork session 會略過本身是 symlink 的 `~/.claude/CLAUDE.md`，屬於無聲失效。
- 明確的部署動作使生效版本可對回 git revision。
- drift 偵測保留了 symlink 的優點（外部修改可見），同時多一道人工確認。

**否決方案**
- symlink：Cowork 下無聲失效；Codex 對 symlink 的行為未查證。

**推翻條件**
- 實際使用中經常忘記 `deploy`，導致 repo 與部署長期不同步（`status` 反覆顯示未部署變更）：考慮加上 git post-commit 提醒（只提醒，不自動部署）。

## #4 Eval 執行機制

**結論**

**4a 隔離原則**
- eval 一律在暫存 workspace 執行，不得讀寫真實的 `~/.claude`、`~/.codex`。
- 部署檔以和該 surface 相同的層級注入。
- 無法同層注入時，run 紀錄標 `injection: proxy`；proxy evidence 要升級為 `implemented`，需另附至少 1 次手動測試佐證。
- 具體做法已依 S1 結果寫入 [ADR-0003 §6](0003-eval-gates-status-not-deploy.md)。

**4b 判定方式**
- 優先使用 assertion（script 讀 output，exit 0/1）。
- 無法寫成 assertion 時才用 LLM judge，限制如下：
  - 只回答二元問題，不打分數。
  - judge 的 model 固定在 config 中。
  - judge 的 prompt 存在 case 檔，並進版控。
  - judge 的呼叫次數不計入 #3 的上限。

**4c 格式**

```yaml
# evals/<surface>/<intent>/case.yaml
prompts: [...]            # ≤3
fixture: fixtures/xxx     # 選填
check:
  type: assertion | judge
  script: check.sh
  question: "..."
```

- run 紀錄存為 `runs/<date>-<short-hash>.json`，內容包含：部署檔 hash、model id、CLI 版本、注入方式、每次的原始 output 與判定結果。
- run 紀錄全部 commit。

**理由**
- intent 有大量溝通風格類項目，只用 assertion 會使自動 eval 幾乎無用。
- 限定二元題後，judge 從評分者降級為檢查者，偏差可接受。

**否決方案**
- 只用 assertion：自動 eval 涵蓋範圍過小。
- 全部人工判定：重現舊 project 的成本問題。

**推翻條件**
- judge 的判定與你人工抽查的不一致率偏高（例如抽查 10 筆中有 3 筆以上不一致）：該類 intent 改走手動測試。

---

## 實作時決定（可逆項）

- script 語言、指令命名、CLI 介面。
- 檔名細節、YAML 欄位命名（語意以上述為準）。
- 版本號格式。
- skill upstream 的實際位置（寫入 `deps.yaml`）。
- judge 使用的 model。
- 舊 project 要撈回哪些內容（逐條判斷，進入時一律是 `experimental`）。
- repo 自用 `CLAUDE.md`、`AGENTS.md` 的內容，以及各條規則的實際措辭。
- intent 的優先序（決定 `stale` 補驗的順序）。

## Spike（已完成）

| ID | 問題 | 最小驗證動作 | 時間盒／截止 | 結果 → 選項 |
|---|---|---|---|---|
| S1 | eval 能否隔離且同層注入 | 在暫存目錄放入帶 canary（`CANARY-42`）的部署檔，分別以 `claude -p`、`codex exec` 搭配候選隔離方式（Claude：`--setting-sources` 或 `CLAUDE_CONFIG_DIR`；Codex：`CODEX_HOME`，皆未查證）各跑一次；確認 output 出現 canary，且真實 `~` 底下無檔案被讀寫 | 1 小時；實作 eval runner 前完成 | 同層成功 → `native`；只能 proxy → 標 `proxy`，`implemented` 需加手動佐證；無法隔離 → 該 surface 只走手動測試 |
| S2 | Codex cloud 讀哪些 instruction | 在本 repo `AGENTS.md` 放 canary，從 Codex cloud 送出任務 | 30 分鐘；Codex cloud 首次部署前完成 | 有讀到且無其他來源 → 併入 `codex-repo`；否則新增 surface |

兩者已於 2026-10-05 完成，結果見上方決策帳本。S2 留下的未解項目列在 [S2-result](../spikes/S2-result.md)，在第一次用 Codex cloud 跑本 repo 時補測。

## 遷移（已確認，2026-10-04）

**v1 完成的定義**
- `lint`、`deploy`、`status`、`check-deps` 可運作。
- S1 已完成。
- 6 個有載入管道的 surface 都有部署檔（`codex-cloud` 為 `channel: none`，除外），且每個 intent 在每個 surface 都有狀態（`implemented`、`not-needed` 或 `experimental` 其中之一）。

**遷移步驟**
1. 達成上述定義後，才把現行的 claude.ai preferences 與 Claude Code／Codex global 檔遷入本 repo。
2. 遷入的規則一律從 `experimental` 開始。
3. 首次 `deploy` 前自動備份現行檔案（#6）。

**舊 project**
- 淘汰，不做自動轉換。

## 仍存在的風險與假設

- **Codex 文件與原始碼不一致**：Codex 的載入規則已於 2026-10-04 依官方文件與原始碼完成查核（[C1～C13](../spikes/codex-verification-result.md)）。但 C4 的截斷行為，文件和原始碼的描述不同，目前以原始碼為準。Codex 升級後，C1、C3、C4、C8 需要重查。
- **claude.ai preferences 字數上限未確認**：沒有官方數字，`surfaces.yaml` 填 `unknown`。
- **Codex cloud 沒有 instruction 管道**：`codex-cloud` 目前無法部署任何規則，在 Codex cloud 上的任務不受本 repo 規範約束。
- **LLM judge 的偏差**：只能降低，無法消除。依賴 #4 的推翻條件抽查。
- **leave-one-out 的限制**：假設規則之間大致獨立。若兩條規則互相補強，單獨移除一條可能低估它的貢獻。
- **手動 surface 的 evidence 較弱**：1 次對 1 次的比較統計意義低，所以標為 `strength: manual`，和自動 evidence 分開解讀。
- **一人維護的 `deploy` 紀律**：copy 模式依賴你記得執行 `deploy`。目前以 `status` 緩解；若不足，依 #6 的推翻條件處理。
