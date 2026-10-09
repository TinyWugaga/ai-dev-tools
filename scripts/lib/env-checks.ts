import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { type Ctx, expandPath } from "./context.ts";
import type { Surface } from "./lint.ts";

export function environmentWarnings(ctx: Ctx, surfaces: Surface[]): string[] {
  const warnings: string[] = [];
  const managed = new Set(surfaces.flatMap((s) => (s.targets ?? []).map((t) => expandPath(ctx, t))));

  const rulesDir = join(ctx.home, ".claude", "rules");
  if (existsSync(rulesDir)) {
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const full = join(d, n);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    const unmanaged = walk(rulesDir).filter((f) => f.endsWith(".md") && !managed.has(f));
    if (unmanaged.length)
      warnings.push(
        `~/.claude/rules/ 中有 ${unmanaged.length} 個不是本 repo 管理的檔案，可能與部署的規則衝突：${unmanaged.join(", ")}`,
      );
  }

  const codexHome = expandPath(ctx, "$CODEX_HOME");
  const override = join(codexHome, "AGENTS.override.md");
  if (existsSync(override) && readFileSync(override, "utf8").trim())
    warnings.push(`${override} 存在且非空：Codex 會優先讀它，部署的 AGENTS.md 整份失效（C1）`);

  const config = join(codexHome, "config.toml");
  if (existsSync(config) && /project_doc_fallback_filenames\s*=\s*\[[^\]]*CLAUDE\.md/s.test(readFileSync(config, "utf8")))
    warnings.push(`${config} 的 project_doc_fallback_filenames 包含 CLAUDE.md：Codex 可能讀入 Claude 專用檔（C3）`);

  return warnings;
}
