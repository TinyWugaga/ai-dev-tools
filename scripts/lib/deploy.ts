import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Ctx,
  expandPath,
  git,
  loadState,
  loadSurfaces,
  readSource,
  saveState,
  sha256,
  timestamp,
  uncommitted,
  writeAtomic,
} from "./context.ts";
import { environmentWarnings } from "./env-checks.ts";
import { lint, measure, type Surface } from "./lint.ts";

export interface DeployOptions {
  confirm?: boolean;
  pull?: boolean;
  overwrite?: boolean;
}

export interface DeployResult {
  ok: boolean;
  lines: string[];
}

function diff(a: string, b: string, labelA: string, labelB: string): string {
  const r = spawnSync("diff", ["-u", "--label", labelA, "--label", labelB, a, b], { encoding: "utf8" });
  return r.error ? "（無法執行 diff）" : r.stdout;
}

function limitLine(surface: Surface, content: string): string {
  const limit = surface.limit;
  if (!limit || limit.unit === "unknown" || limit.unit === "none") return `長度：上限 ${limit?.unit ?? "未設定"}`;
  return `長度：${measure(content, limit.unit)}/${limit.value} ${limit.unit}`;
}

export function deploy(ctx: Ctx, id: string, opts: DeployOptions = {}): DeployResult {
  const lines: string[] = [];
  const fail = (msg: string): DeployResult => ({ ok: false, lines: [...lines, `拒絕部署：${msg}`] });

  const surfaces = loadSurfaces(ctx);
  const surface = surfaces.find((s) => s.id === id);
  if (!surface) return fail(`surface 不存在：${id}（可用：${surfaces.map((s) => s.id).join(", ")}）`);
  if (surface.channel === "none") return { ok: true, lines: [`${id}：channel 為 none，沒有可部署的管道`] };
  if (surface.migration === "pending")
    return fail(`${id} 仍在遷移中（surfaces.yaml 的 migration: pending），內容補齊並移除旗標後才能部署`);
  if (surface.channel === "in-repo") return { ok: true, lines: [`${id}：repo 內的實體檔，不需要 deploy`] };

  const lintErrors = lint(ctx.root).errors;
  if (lintErrors.length) return fail(`lint 有 ${lintErrors.length} 個錯誤，先執行 npm run lint 修正`);

  const files = surface.files!;
  const sources = files.map((_, i) => readSource(ctx, surface, i));
  if (!sources.join("").trim()) return fail(`部署檔為空（${files.join(", ")}），不會用空檔覆蓋目標`);

  const dirty = uncommitted(ctx, files);
  const revision = git(ctx, ["rev-parse", "HEAD"]).out || "unknown";
  const state = loadState(ctx);
  const entry = (state.surfaces[id] ??= {});

  for (const w of environmentWarnings(ctx, surfaces)) lines.push(`警告：${w}`);

  if (surface.channel === "manual") {
    const content = sources.join("\n");
    if (!opts.confirm) {
      if (dirty.length) lines.push(`注意：${dirty.join(", ")} 尚未 commit，貼上後無法 --confirm`);
      lines.push(limitLine(surface, content), "----- 以下為貼上內容 -----", content, "----- 結束 -----");
      lines.push(`貼上後執行：npm run deploy -- ${id} --confirm`);
      return { ok: true, lines };
    }
    if (dirty.length) return fail(`${dirty.join(", ")} 尚未 commit，部署必須對應到一個 revision`);
    entry.manual = { hash: sha256(content), revision, at: ctx.now().toISOString() };
    saveState(ctx, state);
    lines.push(`${id}：已記錄手動部署（${revision.slice(0, 7)}）`);
    return { ok: true, lines };
  }

  if (dirty.length) return fail(`${dirty.join(", ")} 尚未 commit，部署必須對應到一個 revision`);
  const targets = surface.targets!.map((t) => expandPath(ctx, t));
  const records = (entry.targets ??= {});

  for (const target of targets) {
    if (existsSync(target) && lstatSync(target).isSymbolicLink())
      return fail(`${target} 是 symlink；copy 會寫入它指向的檔案。請先移除 symlink`);
  }

  const drifted = targets
    .map((target, i) => ({ target, i }))
    .filter(({ target }) => records[target] && existsSync(target) && sha256(readFileSync(target)) !== records[target].hash);

  if (opts.pull) {
    if (!drifted.length) return { ok: true, lines: [...lines, `${id}：沒有 drift，不需要 pull`] };
    for (const { target, i } of drifted) {
      const content = readFileSync(target, "utf8");
      writeAtomic(join(ctx.root, files[i]), content);
      records[target] = { ...records[target], hash: sha256(content) };
      lines.push(`已把 ${target} 的外部修改拉回 ${files[i]}`);
    }
    saveState(ctx, state);
    lines.push("接著：更新對應 rationale 的 text 與 status，執行 npm run lint，commit 後再 deploy");
    return { ok: true, lines };
  }

  if (drifted.length && !opts.overwrite) {
    for (const { target, i } of drifted) {
      lines.push(`drift：${target} 在上次部署後被修改`, diff(target, join(ctx.root, files[i]), target, files[i]));
    }
    return fail(`有 drift。選擇 --pull（拉回 repo）或 --overwrite（捨棄外部修改，會先備份）`);
  }

  for (const [i, target] of targets.entries()) {
    const content = sources[i];
    const exists = existsSync(target);
    const firstDeploy = !records[target];
    const isDrift = drifted.some((d) => d.target === target);
    if (exists && (firstDeploy || isDrift)) {
      const backup = `${target}.bak-${timestamp(ctx)}`;
      copyFileSync(target, backup);
      lines.push(`已備份 ${target} → ${backup}`);
    }
    if (exists && readFileSync(target, "utf8") === content) {
      lines.push(`${target}：內容相同，未改寫`);
    } else {
      writeAtomic(target, content);
      lines.push(`已部署 ${files[i]} → ${target}`);
    }
    records[target] = { hash: sha256(content), revision, at: ctx.now().toISOString() };
  }
  saveState(ctx, state);
  lines.push(limitLine(surface, sources.join("\n")), `${id}：部署完成（${revision.slice(0, 7)}）`);
  return { ok: true, lines };
}
