# ai-dev-tools

這個 repo 管理 Claude 與 ChatGPT/Codex 的協作規範，涵蓋各平台的 global instruction，以及本 repo 自用的 `CLAUDE.md` 和 `AGENTS.md`。

所有 surface 共用同一份 intent 清單，但各自維護一份措辭；每條規則都附有 rationale，記錄它因應哪個 model 行為而寫。設計決策見 [`docs/decisions/`](docs/decisions/)。

## 結構

| 路徑 | 用途 |
|---|---|
| `intents.yaml` | 平台中立的意圖清單，不部署 |
| `surfaces.yaml` | surface 清單：部署方式、model、長度上限（附來源） |
| `surfaces/` | global surface 的部署檔 |
| `CLAUDE.md`、`AGENTS.md` | 本 repo 自用的部署檔（surface：`claude-code-repo`、`codex-repo`） |
| `rationale/<surface>.yaml` | 每條規則的逐字原文、狀態、觀察紀錄與 evidence |
| `deps.yaml` | 規則依賴的 skill 與安裝路徑 |
| `docs/spikes/` | 查核與實驗紀錄 |

## 指令

需要 Node.js 22.18 以上版本，可以直接執行 TypeScript。

```sh
npm install
npm run lint   # 檢查 intent、rationale 與部署檔是否一致，以及長度是否超過上限
npm test       # lint 本身的測試
```

`deploy`、`status`、`check-deps` 尚未實作。

## 注意事項

- **不要把 Claude Code 的 Project instructions 設為 `claude-md-and-agents-md`。** 這個設定會讓 Claude 同時讀入給 Codex 用的 `AGENTS.md`。
- **不要在 `~/.codex/config.toml` 的 `project_doc_fallback_filenames` 加入 `CLAUDE.md`。** 這會讓 Codex 讀入給 Claude 用的檔案。
- **`~/.codex/AGENTS.override.md` 存在且非空時，部署的 `~/.codex/AGENTS.md` 會整份失效。**
