# ai-dev-tools（Claude Code 專用）

- 修改前先讀 `docs/decisions/` 中與任務相關的 ADR，以 ADR 作為設計依據。需求和 ADR 衝突時，先指出衝突點再動手。
- 修改 `surfaces/`、`CLAUDE.md` 或 `AGENTS.md` 中的規則文字時，在同一次變更內更新 `rationale/<surface-id>.yaml` 對應紀錄的 `text`，讓兩邊逐字相同，並把 `status` 設為 `experimental`。
- 不要直接寫入 `~/.claude`、`~/.codex`、`~/.agents`。global 檔只透過 deploy script 更新，而且由使用者自己執行。
- 本檔只給 Claude Code 讀，`AGENTS.md` 只給 Codex 讀。不要用 import、symlink 或複製讓兩者共用內容。
- 改動 `intents.yaml`、`surfaces.yaml`、`deps.yaml`、`rationale/` 或任何部署檔之後，執行 `npm run lint`。lint 失敗時不要回報完成。
- `surfaces.yaml` 中的平台事實（長度上限、載入行為）必須附 `source` 與 `checked`。查不到就填 `unknown`，不要憑記憶填數值。
- ADR 狀態成為 Accepted 時，或我核准一份具體 plan 後，執行 `npm run issue -- <decision|task> --key <ADR-NNNN|task-YYYY-MM-DD-slug> --title "<標題>" --body-file <檔案>`，不需要先問我，完成後回報 issue 連結。decision 的 body 放 ADR 路徑與決策摘要；task 的 body 放 plan 摘要和 checklist；兩者都連到當下已存在的對方 issue。task key 在第一次核准時產生（同一天內 slug 不可重複），記在 plan 檔，重跑時沿用同一個 key。這是常設授權，只涵蓋在 `TinyWugaga/ai-dev-tools` 建 issue 並加入 Project 5，不包括建 label、編輯、關閉、reopen 或刪除。script 回傳非 0 時回報輸出，不要改用其他方式建立；原因排除後可以重跑同一指令。
