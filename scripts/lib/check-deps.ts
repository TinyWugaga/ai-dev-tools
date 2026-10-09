import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, parseDocument } from "yaml";
import { type Ctx, expandPath, hashDir, loadSurfaces } from "./context.ts";
import type { RationaleRecord } from "./lint.ts";

interface Deps {
  upstream?: string | null;
  install_paths?: Record<string, string[] | "manual">;
  skills?: { name: string }[];
}

export interface CheckDepsResult {
  lines: string[];
  problems: string[];
  staleTargets: { surface: string; index: number; intent: string }[];
}

const STALE_CANDIDATES = new Set(["implemented", "not-needed"]);

function upstreamDir(ctx: Ctx, upstream: string, name: string): string | "remote" {
  if (/^[a-z]+:\/\/|^git@/.test(upstream)) return "remote";
  const path = upstream.includes("{name}") ? upstream.replaceAll("{name}", name) : join(upstream, name);
  return expandPath(ctx, path);
}

function installed(ctx: Ctx, paths: string[], name: string): { path: string; hash: string }[] {
  return paths
    .map((p) => expandPath(ctx, p.replaceAll("{name}", name)))
    .filter((p) => existsSync(p) && statSync(p).isDirectory())
    .map((path) => ({ path, hash: hashDir(path) }));
}

export function checkDeps(ctx: Ctx): CheckDepsResult {
  const deps = (parse(readFileSync(join(ctx.root, "deps.yaml"), "utf8")) ?? {}) as Deps;
  const installPaths = deps.install_paths ?? {};
  const skills = (deps.skills ?? []).map((s) => s.name);
  const lines: string[] = [];
  const problems: string[] = [];
  const staleTargets: CheckDepsResult["staleTargets"] = [];
  const installedBy = new Map<string, Map<string, { path: string; hash: string }[]>>();

  if (!skills.length) lines.push("deps.yaml 沒有登記任何 skill");
  if (!deps.upstream) lines.push("deps.yaml 的 upstream 未設定，略過「已安裝 vs upstream」比對");

  for (const name of skills) {
    const bySurface = new Map<string, { path: string; hash: string }[]>();
    installedBy.set(name, bySurface);
    lines.push(`\n[${name}]`);
    const up = deps.upstream ? upstreamDir(ctx, deps.upstream, name) : undefined;
    const upHash = up && up !== "remote" && existsSync(up) ? hashDir(up) : undefined;
    if (up === "remote") lines.push("  upstream 是遠端位址，請 clone 到本機後在 upstream 填本機路徑");
    else if (up && !upHash) lines.push(`  upstream 找不到：${up}`);

    for (const [surface, paths] of Object.entries(installPaths)) {
      if (paths === "manual") {
        lines.push(`  ${surface}：手動核對，確認平台上的 ${name} 與 upstream 一致`);
        continue;
      }
      const found = installed(ctx, paths, name);
      bySurface.set(surface, found);
      if (!found.length) {
        lines.push(`  ${surface}：未安裝`);
        continue;
      }
      for (const f of found) {
        const vsUp = upHash ? (f.hash === upHash ? "與 upstream 相同" : "與 upstream 不同，需要更新") : "";
        lines.push(`  ${surface}：${f.path} ${f.hash.slice(0, 19)}… ${vsUp}`.trimEnd());
        if (upHash && f.hash !== upHash) problems.push(`${name} 在 ${surface}（${f.path}）與 upstream 不同，需要更新`);
      }
      if (new Set(found.map((f) => f.hash)).size > 1)
        problems.push(`${name} 在 ${surface} 有多個版本不同的安裝位置：${found.map((f) => f.path).join(", ")}`);
    }
    const hashes = new Set([...bySurface.values()].flat().map((f) => f.hash));
    if (hashes.size > 1) lines.push(`  注意：${name} 在各 surface 的安裝版本不一致`);
  }

  for (const surface of loadSurfaces(ctx)) {
    const file = join(ctx.root, "rationale", `${surface.id}.yaml`);
    if (!existsSync(file)) continue;
    const records = (parse(readFileSync(file, "utf8")) ?? []) as RationaleRecord[];
    records.forEach((record, index) => {
      for (const dep of record.depends_on ?? []) {
        const where = `${surface.id} / ${record.intent}（依賴 ${dep.skill}）`;
        const paths = installPaths[surface.id];
        if (paths === "manual") continue;
        if (!paths) {
          problems.push(`${where}：deps.yaml 沒有 ${surface.id} 的 install_paths`);
          continue;
        }
        const found = installedBy.get(dep.skill)?.get(surface.id) ?? installed(ctx, paths, dep.skill);
        if (!found.length) {
          if (record.status === "implemented") problems.push(`${where}：skill 未安裝，不得為 implemented（ADR-0003）`);
          continue;
        }
        const pinned = dep.pinned?.[surface.id];
        if (!pinned || pinned === "manual") {
          if (STALE_CANDIDATES.has(record.status)) problems.push(`${where}：${record.status} 但沒有 pinned hash`);
          continue;
        }
        if (!found.some((f) => f.hash === pinned) && STALE_CANDIDATES.has(record.status)) {
          problems.push(`${where}：已安裝版本與 pinned 不同，應標為 stale（ADR-0003）`);
          staleTargets.push({ surface: surface.id, index, intent: record.intent });
        }
      }
    });
  }
  return { lines, problems, staleTargets };
}

export function applyStale(ctx: Ctx, targets: CheckDepsResult["staleTargets"]): string[] {
  const changed: string[] = [];
  const bySurface = Map.groupBy(targets, (t) => t.surface);
  for (const [surface, items] of bySurface) {
    const file = join(ctx.root, "rationale", `${surface}.yaml`);
    const doc = parseDocument(readFileSync(file, "utf8"));
    for (const { index, intent } of items) {
      doc.setIn([index, "status"], "stale");
      changed.push(`${surface} / ${intent} → stale`);
    }
    writeFileSync(file, doc.toString({ lineWidth: 0 }));
  }
  return changed;
}
