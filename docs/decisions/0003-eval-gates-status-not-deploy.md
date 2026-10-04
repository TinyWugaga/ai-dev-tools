# ADR-0003：Eval 只把關狀態標籤，不阻擋部署

- 狀態：Accepted
- 日期：2026-10-04
- 來源：[ai-dev-tools-grill.md](ai-dev-tools-grill.md) #3、#4、#7
- 依賴：ADR-0002

## 背景

前一個 project 把 eval 當成部署關卡，而且 eval 範圍過大：每個 skill 要準備 4 類 fixture，並在每個平台各跑一次，另外還有一整套數值量測規範。結果是每新增或修改一條規則，都要付出整套測試的成本，迭代因此停擺。

本 project 仍然需要「可重跑、可對照有規則與無規則」的紀錄，但驗證成本不能阻擋迭代。

## 決策

### 1. 角色

- eval 永遠不阻擋部署。新增或修改的規則直接部署，狀態為 `experimental`。
- 只有在把狀態升級為 `implemented` 或 `not-needed` 時，才需要 eval 或手動測試。
- 以下情況會自動降級。被降級的規則仍留在部署檔中，只是列入 lint 的待驗清單：

  | 觸發 | 新狀態 |
  |---|---|
  | 措辭改動（ADR-0002 的 lint 偵測到） | `experimental` |
  | 該 surface 的 model 更換 | `stale` |
  | `check-deps` 發現依賴的 skill 內容與 `pinned` 不符 | `stale` |
  | 依賴的 skill 在該 surface 未安裝 | 不得為 `implemented` |

### 2. 單位與對照

- 一次 eval 只涵蓋一個 intent × 一個 surface。
- 對照組採 leave-one-out：完整部署檔減去該規則的原文（取自 rationale 的 `text`），而不是空白檔。

### 3. 上限（target 值）

| | 自動 surface | 手動 surface |
|---|---|---|
| prompts | ≤ 3 | ≤ 2 |
| 每組重跑次數 | 3 | 1 |
| 組數 | 2 | 2 |
| 總次數上限 | 18 | 4 |

可以超過上限，但必須在 rationale 中寫明理由。lint 會列出所有超限的項目，供事後檢討。

### 4. 通過條件

- `implemented`：有規則組 3 次中至少 2 次達標，且結果優於無規則組。
- `not-needed`：無規則組 3 次全部達標。
- 手動 surface：1 次對 1 次。evidence 標記為 `strength: manual`，與自動 evidence 分開解讀。

### 5. 判定方式

- 優先使用 assertion：由 script 讀取 output，以 exit 0 或 1 表示結果。
- 無法寫成 assertion 時，才使用 LLM judge，限制如下：
  - 只回答二元問題，不打分數。
  - judge 使用的 model 固定寫在 config 中。
  - judge prompt 存放在 case 檔，並納入版控。
  - judge 的呼叫次數不計入第 3 節的上限。

### 6. 執行隔離

- eval 一律在暫存 workspace 中執行，不得讀寫真實的 `~/.claude` 和 `~/.codex`。
- 部署檔必須以和該 surface 相同的層級注入，例如 global surface 就注入到 user 層。
- 若無法同層注入，run 紀錄標記為 `injection: proxy`。proxy evidence 要升級成 `implemented`，必須另外附上至少 1 次手動測試佐證。
- 具體的隔離方式由 spike S1 決定。

### 7. 格式

```yaml
# evals/<surface>/<intent>/case.yaml
prompts: [...]
fixture: fixtures/xxx     # 選填
check:
  type: assertion | judge
  script: check.sh
  question: "..."
```

- run 紀錄存為 `evals/<surface>/<intent>/runs/<date>-<short-hash>.json`。
- 內容包含：部署檔 hash、model id、CLI 版本、注入方式，以及每次執行的原始 output 和判定結果。
- run 紀錄全部 commit。

### 8. Model 更新

- 該 surface 的所有規則標記為 `stale`。
- 依 intent 優先序逐步補驗，不設期限。
- `experimental` 規則的數量和存在時間不設限制。

### 9. 明確不做

- 跨平台一致性 eval
- 每次修改都跑全量回歸
- skill trigger eval
- 舊 project 的數值量測規範體系

## 後果

**正面**
- 迭代速度不受 eval 成本影響。
- 每次 eval 的成本有明確上限，最多 18 次執行。
- leave-one-out 量到的是規則在真實 context 中的邊際貢獻。
- 「未驗證」以明確的狀態呈現，不會被誤認為已驗證。

**負面**
- 未驗證的規則可能長期留在部署檔中。
- leave-one-out 假設規則之間大致獨立。若兩條規則互相補強，移除其中一條時，可能低估它的貢獻。
- 3 次重跑的統計意義有限，只能看出明顯差異。
- LLM judge 仍有偏差，二元題只能降低偏差，無法消除。

## 替代方案

- **eval 作為部署關卡**：重複前一個 project 的失敗模式。否決。
- **只做手動觀察紀錄**：無法重跑，不符合成功條件。否決。
- **只用 assertion 判定**：溝通風格類的 intent 無法寫成 assertion，自動 eval 的涵蓋範圍會過小。否決。
- **全部人工判定**：重現前一個 project 的成本問題。否決。
- **限制 `experimental` 的數量或天數**：會重新製造測試壓力。暫不採用，見推翻條件。

## 推翻條件

- `experimental` 規則超過部署規則總數的一半，且持續 3 個月以上，或你已無法判斷哪些規則有效。此時討論是否加上數量或天數上限。
- 18 次的上限反覆不足以下結論，例如結果在 1/3 與 2/3 之間擺盪。此時調整重跑次數，架構不變。
- 人工抽查 judge 判定，10 筆中有 3 筆以上不一致。此時該類 intent 改走手動測試。
- spike S1 的結果顯示某個 surface 無法隔離。此時該 surface 只走手動測試。
