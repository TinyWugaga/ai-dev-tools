---
id: ADR-006
type: adr
title: 以 Nodit 卡片格式管理 ADR
status: accepted
date: 2026-10-23
relates: [ADR-0001, ADR-0005]
---

## Context

本 repo 導入 Nodit（v12.2.1，`nodit init` 產生 v2 template），用來把 ADR、Milestone、Task 畫成關聯圖。導入後出現三個衝突：

- **ADR 格式**：Nodit 會把 `docs/decisions/` 底下每個 `.md` 都當成卡片解析，卡片需要 frontmatter（`id`、`type`、`title`、`status`），也需要以 `id` 開頭的檔名。原本的 ADR 用 `0001-<slug>.md` 命名，狀態寫在正文的清單裡，所以在 Nodit 只能唯讀顯示。另外兩份非 ADR 文件（grill 決策集、codex-global 缺口分流）既沒有 frontmatter，檔名也沒有編號，會被標成 `id-missing` 錯誤。
- **檔案分離規則**：Nodit 在 `CLAUDE.md` 和 `AGENTS.md` 各寫入一段幾乎相同的 managed block（以 `<!-- nodit:start v2 -->`／`<!-- nodit:end -->` 標記，`nodit.config.json` 記錄它的 hash），違反 `repo.file-separation`「不複製內容到另一個檔案」。
- **issue key**：ADR-0005 的 decision key 限定 `ADR-` 加 4 位數字，而 `nodit new adr` 以 3 位數配發編號（下一張就是 `ADR-006`）。

查 Nodit 原始碼（2026-10-23，`dist-server/cli.mjs` 的 `ID_RULES`）確認，ADR id 的規則是 `^ADR-(\d{3,})$`，所以 4 位數的 `ADR-0001` 本身就是合法 id。

## Decision

1. **採用 Nodit 卡片格式。** `docs/decisions/` 只放 ADR 卡片：檔名 `<id>-<slug>.md`，frontmatter 依 Nodit 規定填寫，正文以 `## Context`、`## Decision`、`## Consequences` 為必備段落，其他自訂段落（替代方案、推翻條件等）保留。新 ADR 一律用 `nodit new adr` 建立，由它配發編號。
2. **既有 ADR 不重新編號。** `ADR-0001`～`ADR-0005` 保留原 id，只把檔名加上 `ADR-` 前綴、補上 frontmatter，並把背景／決策／後果三個段落改名為 Nodit 的段落名稱。原本的「依賴」改寫成 `relates`，因為 Nodit 的 ADR 只支援 `supersedes` 和 `relates`。這樣既有的 ID 引用和 ADR-0005 的 issue marker 都不用改。
3. **非 ADR 的決策文件移到 `docs/records/`。** `ai-dev-tools-grill.md` 與 `codex-global-gap-triage.md` 移過去，避免被 Nodit 當成無效卡片。
4. **issue key 放寬為 `^ADR-\d{3,}$`**，新舊位數的 ADR 都能同步。已存在的 issue 沿用原 key，不重跑。
5. **Nodit managed block 是 `repo.file-separation` 的例外。** 兩份檔案的 block 由 Nodit 產生和更新，不手動修改措辭；`CLAUDE.md`、`AGENTS.md` 的檔案分離規則加註這項例外。這兩段 block 仍是部署檔內容，所以依 ADR-0002 由 intent `repo.nodit-card-format` 的 rationale 紀錄逐字引用。

## Consequences

- ADR 可以在 Nodit 裡顯示和編輯，並能跟 Milestone、Task 建立關聯。
- 編號位數不一致：`ADR-0001`～`ADR-0005` 是 4 位數，`ADR-006` 起是 3 位數。Nodit 按數字排序，所以顯示順序不受影響；但檔名按字典序排序時，`ADR-0005` 仍會排在 `ADR-006` 前面，到 `ADR-010` 也不會錯位。
- Nodit 升級改寫 managed block 時，rationale 的 `text` 會跟部署檔不同步，lint 會失敗。這時要把新的 block 原文同步到 `rationale/claude-code-repo.yaml`、`rationale/codex-repo.yaml`，status 維持 `experimental`。
- `docs/records/` 是新資料夾，之後不屬於 ADR 的決策紀錄（設計訪談、分流紀錄）都放這裡。

## 推翻條件

- Nodit 改變 id 規則、不再接受 4 位數 id → 把 `ADR-0001`～`ADR-0005` 重新編號，並處理 ADR-0005 issue 的 marker。
- 不再使用 Nodit → 移除 managed block，以及 `repo.file-separation` 的例外。
