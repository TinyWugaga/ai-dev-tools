# ADR-0002：Rationale 以逐字引用連結規則

- 狀態：Accepted
- 日期：2026-10-04
- 來源：[ai-dev-tools-grill.md](ai-dev-tools-grill.md) #2、#7
- 依賴：ADR-0001

## 背景

本 project 的成功條件之一，是每條規則都能回答兩個問題：它因應哪一種 model 行為，以及是在哪個 model、哪一天觀察到的。這些 rationale 必須存放在部署檔之外，理由有二：

- chat surface 有字數上限，rationale 放進去會佔用額度。
- 對 model 而言，rationale 不是指令，只會干擾判讀。

因此需要一種連結方式，指出「部署檔裡的哪一段文字，對應哪一個 intent」。這個方式還必須滿足兩個限制：

- 不在部署檔中加入任何標記。手動貼上的 surface 會把標記一併貼上。
- 不需要 build 步驟（ADR-0001）。

## 決策

1. 每個 surface 有一份 `rationale/<surface-id>.yaml`，每條規則一筆記錄：

   ```yaml
   - intent: lang.zh-tw
     status: implemented        # implemented | not-needed | experimental | stale | unimplemented
     text: "<部署檔中的逐字原文>"
     observed: "無此規則時，<model> 在 X 情境會 Y"
     model: <model id>
     checked: 2026-10-04
     evidence: evals/<surface>/<intent>/runs/<id> | manual-tests/<surface>/<intent>.md | none
     revisit_when: "..."
     depends_on:
       - skill: token-preflight
         pinned: { claude-code-global: "sha256:...", claude-ai: manual }
   ```

2. lint 進行雙向比對：
   - 每筆記錄的 `text` 必須逐字出現在對應的部署檔中。
   - 部署檔中的每個規則段落，都必須被某一筆記錄引用。

   「規則段落」的切分方式（v1 實作，`scripts/lib/blocks.ts`）：
   - 每個清單項目，不論層級，都是一個段落，內容為去掉清單符號後的文字。
   - 連續的非清單文字行是一個段落；code fence 整段算一個段落。
   - 標題、分隔線、HTML 註解不算規則段落。
   - 比對時，段落內容只要是某筆紀錄 `text` 的子字串就算被引用。所以一筆紀錄可以逐字引用「父項目加上子項目」整塊文字。

3. 狀態約束：
   - `not-needed` 必須填寫 `observed` 和 `evidence`，用來證明 model 在沒有這條規則時已經表現正確。`not-needed` 的紀錄不可有 `text`。
   - 還沒有任何觀察紀錄的規則，`observed` 以 `unobserved:` 開頭並寫明原因，`model` 可以留空。這種紀錄只能是 `experimental`。
   - `unimplemented`：intent 適用但部署檔沒有對應規則，尚未決定要補上或判定為 `not-needed`。不可有 `text`，可以是 `unobserved`，`evidence` 可以是 `none`（2026-10-09 加入）。
   - `evidence: none` 時，`status` 只能是 `experimental` 或 `unimplemented`。
   - lint 輸出所有 `experimental`、`stale` 和 `unimplemented` 的記錄。

4. 依賴 skill 的記錄要填 `depends_on`，並記下蒐集 evidence 當時各 surface 上該 skill 的內容 hash。比對與降級規則見 ADR-0003。

## 後果

**正面**
- 部署檔保持乾淨，可以直接貼上，也不需要 build。
- 修改規則措辭時，必須同步修改 rationale，否則 lint 會失敗。這會迫使你記錄「為什麼改」。
- rationale 依 surface 分檔。某個 surface 的 model 更新時，只要逐條檢查那一份檔案。

**負面**
- 每次修改措辭都要改兩個地方。
- 逐字比對對空白和標點很敏感，可能出現格式差異造成的 lint 失敗，而不是語意差異。

## 替代方案

- **在部署檔內嵌 HTML 註解作為標記**：Claude Code 會剝除註解，但 Codex 是否剝除尚不確定。手動 surface 會把標記一併貼上。否決。
- **在原始檔中加標記，部署時再剝除**：需要 build 步驟，抵銷 ADR-0001 的好處。否決。

## 推翻條件

- 逐字比對的格式摩擦實際阻礙了迭代。此時改成「正規化空白和標點後再比對」，資料模型不變。
- 某個部署目標改用無法逐字引用的格式，例如 Codex 改為結構化設定檔。
