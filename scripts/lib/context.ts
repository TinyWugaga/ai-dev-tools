import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { Surface } from "./lint.ts";

export interface Ctx {
  root: string;
  home: string;
  env: NodeJS.ProcessEnv;
  statePath: string;
  now: () => Date;
}

export function defaultCtx(): Ctx {
  const env = process.env;
  const home = homedir();
  const stateDir = env.XDG_STATE_HOME ?? join(home, ".local", "state");
  return {
    root: resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."),
    home,
    env,
    statePath: env.AI_DEV_TOOLS_STATE ?? join(stateDir, "ai-dev-tools", "state.json"),
    now: () => new Date(),
  };
}

export function expandPath(ctx: Ctx, path: string): string {
  const codexHome = ctx.env.CODEX_HOME ?? join(ctx.home, ".codex");
  return path
    .replace(/^\$CODEX_HOME(?=\/|$)/, codexHome)
    .replace(/^~(?=\/|$)/, ctx.home);
}

export function sha256(data: string | Buffer): string {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

export function hashDir(dir: string): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(dir);
  const hash = createHash("sha256");
  for (const f of files) {
    hash.update(relative(dir, f)).update("\0").update(readFileSync(f)).update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function loadSurfaces(ctx: Ctx): Surface[] {
  return parse(readFileSync(join(ctx.root, "surfaces.yaml"), "utf8")) as Surface[];
}

export function readSource(ctx: Ctx, surface: Surface, index: number): string {
  return readFileSync(join(ctx.root, surface.files![index]), "utf8");
}

export function git(ctx: Ctx, args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("git", ["-C", ctx.root, ...args], { encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}

export function uncommitted(ctx: Ctx, files: string[]): string[] {
  const r = git(ctx, ["status", "--porcelain", "--", ...files]);
  if (!r.ok) return files;
  return r.out ? r.out.split("\n").map((l) => l.slice(3)) : [];
}

export function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

export interface TargetState {
  hash: string;
  revision: string;
  at: string;
}

export interface State {
  version: 1;
  surfaces: Record<string, { targets?: Record<string, TargetState>; manual?: TargetState }>;
}

export function loadState(ctx: Ctx): State {
  if (!existsSync(ctx.statePath)) return { version: 1, surfaces: {} };
  return JSON.parse(readFileSync(ctx.statePath, "utf8")) as State;
}

export function saveState(ctx: Ctx, state: State): void {
  writeAtomic(ctx.statePath, `${JSON.stringify(state, null, 2)}\n`);
}

export function timestamp(ctx: Ctx): string {
  return ctx.now().toISOString().replace(/[:.]/g, "-");
}
