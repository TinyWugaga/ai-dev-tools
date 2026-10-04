# ai-dev-tools（Codex 專用）

## 開始前

- 先讀 `docs/decisions/` 下與任務相關的 ADR。ADR 是設計依據；任務需求與 ADR 衝突時，停下來回報衝突點，不要自行選擇其中一方。

## 修改規則時

- 部署檔（`surfaces/**`、`CLAUDE.md`、`AGENTS.md`）中的規則文字被新增或修改時，在同一次變更內完成：
  1. 更新 `rationale/<surface-id>.yaml` 中對應紀錄的 `text`，與部署檔逐字相同。
  2. 把該紀錄的 `status` 設為 `experimental`。
- `AGENTS.md` 只給 Codex 讀，`CLAUDE.md` 只給 Claude Code 讀。不要建立 symlink、不要複製內容到另一個檔案，也不要在 `project_doc_fallback_filenames` 加入 `CLAUDE.md`。
- `surfaces.yaml` 中的平台事實（長度上限、載入行為）必須附 `source` 與 `checked`。沒有查到來源時填 `unknown`，不要從記憶填入數值。

## 禁止事項

- 不要寫入 `~/.claude`、`~/.codex`、`~/.agents` 底下的任何檔案。global 檔只能由使用者執行 deploy script 更新。

## 完成前

- 只要改動了 `intents.yaml`、`surfaces.yaml`、`deps.yaml`、`rationale/` 或任何部署檔，執行 `npm run lint`。指令回傳非 0 時，修正後重跑；仍失敗就回報錯誤內容，不要回報完成。
