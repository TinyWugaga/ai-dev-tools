import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { parse, stringify } from "yaml";
import { applyStale, checkDeps } from "./check-deps.ts";
import { type Ctx, hashDir } from "./context.ts";
import { deploy } from "./deploy.ts";
import { status } from "./status.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const RULE = "rule one";
const record = (extra: Record<string, unknown> = {}) => ({
  intent: "g",
  status: "experimental",
  text: RULE,
  observed: "unobserved: test",
  model: null,
  checked: "2026-10-04",
  evidence: "none",
  revisit_when: "never",
  ...extra,
});

function run(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

function setup(opts: { rules?: string; deps?: object; records?: object[] } = {}) {
  const base = mkdtempSync(join(tmpdir(), "ops-"));
  dirs.push(base);
  const root = join(base, "repo");
  const home = join(base, "home");
  mkdirSync(home, { recursive: true });
  const limit = { value: 1000, unit: "bytes", source: "t", checked: "2026-10-04" };
  const files: Record<string, string> = {
    "intents.yaml": stringify([{ id: "g", goal: "G", kinds: ["agentic", "chat"], scopes: ["global"] }]),
    "surfaces.yaml": stringify([
      { id: "cli", kind: "agentic", scope: "global", channel: "copy", files: ["surfaces/cli.md"], targets: ["~/.tool/RULES.md"], model: "m", limit },
      { id: "chat", kind: "chat", scope: "global", channel: "manual", files: ["surfaces/chat.md"], model: "m", limit },
      { id: "cloud", kind: "agentic", scope: "repo", channel: "none" },
    ]),
    "deps.yaml": stringify(opts.deps ?? { upstream: null, install_paths: {}, skills: [] }),
    "surfaces/cli.md": opts.rules ?? `- ${RULE}\n`,
    "surfaces/chat.md": `- ${RULE}\n`,
    "rationale/cli.yaml": stringify(opts.records ?? [record()]),
    "rationale/chat.yaml": stringify([record()]),
  };
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  run(root, "init", "-q");
  run(root, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A");
  run(root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  const ctx: Ctx = {
    root,
    home,
    env: {},
    statePath: join(base, "state", "state.json"),
    now: () => new Date("2026-10-04T00:00:00Z"),
  };
  const target = join(home, ".tool", "RULES.md");
  const commit = (path: string, content: string) => {
    writeFileSync(join(root, path), content);
    run(root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qam", "change");
  };
  return { ctx, root, home, target, commit };
}

const statusOf = (ctx: Ctx, surface: string) => status(ctx).rows.find((r) => r.surface === surface)!.status;

describe("deploy (copy)", () => {
  it("deploys to a missing target and reports synced", () => {
    const { ctx, target } = setup();
    assert.equal(statusOf(ctx, "cli"), "never-deployed");
    const r = deploy(ctx, "cli");
    assert.ok(r.ok, r.lines.join("\n"));
    assert.equal(readFileSync(target, "utf8"), `- ${RULE}\n`);
    assert.equal(statusOf(ctx, "cli"), "synced");
  });

  it("backs up an existing target on first deploy", () => {
    const { ctx, target } = setup();
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "old global rules\n");
    assert.equal(statusOf(ctx, "cli"), "unmanaged");
    assert.ok(deploy(ctx, "cli").ok);
    const backups = readdirSync(dirname(target)).filter((f) => f.includes(".bak-"));
    assert.equal(backups.length, 1);
    assert.equal(readFileSync(join(dirname(target), backups[0]), "utf8"), "old global rules\n");
  });

  it("refuses uncommitted sources, empty files and lint failures", () => {
    const a = setup();
    writeFileSync(join(a.root, "surfaces/cli.md"), `- ${RULE}\n\n`);
    assert.match(deploy(a.ctx, "cli").lines.at(-1)!, /尚未 commit/);

    const b = setup({ rules: "\n", records: [] });
    assert.ok(!deploy(b.ctx, "cli").ok);

    const c = setup({ rules: `- ${RULE}\n- unquoted\n` });
    assert.match(deploy(c.ctx, "cli").lines.at(-1)!, /lint 有/);
    assert.ok(!existsSync(c.target));
  });

  it("refuses a symlinked target", () => {
    const { ctx, target, home } = setup();
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(join(home, "elsewhere.md"), "x");
    symlinkSync(join(home, "elsewhere.md"), target);
    assert.match(deploy(ctx, "cli").lines.at(-1)!, /symlink/);
    assert.equal(readFileSync(join(home, "elsewhere.md"), "utf8"), "x");
  });

  it("detects drift, refuses by default, and overwrites with a backup", () => {
    const { ctx, target } = setup();
    deploy(ctx, "cli");
    writeFileSync(target, "edited by app\n");
    assert.equal(statusOf(ctx, "cli"), "drift");
    const refused = deploy(ctx, "cli");
    assert.ok(!refused.ok);
    assert.ok(refused.lines.some((l) => l.includes("edited by app")));
    assert.equal(readFileSync(target, "utf8"), "edited by app\n");

    assert.ok(deploy(ctx, "cli", { overwrite: true }).ok);
    assert.equal(readFileSync(target, "utf8"), `- ${RULE}\n`);
    assert.ok(readdirSync(dirname(target)).some((f) => f.includes(".bak-")));
    assert.equal(statusOf(ctx, "cli"), "synced");
  });

  it("pulls drift back into the repo", () => {
    const { ctx, target, root } = setup();
    deploy(ctx, "cli");
    writeFileSync(target, "edited by app\n");
    assert.ok(deploy(ctx, "cli", { pull: true }).ok);
    assert.equal(readFileSync(join(root, "surfaces/cli.md"), "utf8"), "edited by app\n");
    assert.notEqual(statusOf(ctx, "cli"), "drift");
  });

  it("reports pending deploy after a committed source change", () => {
    const { ctx, commit } = setup();
    assert.ok(deploy(ctx, "cli").ok);
    commit("rationale/cli.yaml", stringify([record({ text: "rule" })]));
    commit("surfaces/cli.md", `- rule v2\n`);
    assert.equal(statusOf(ctx, "cli"), "pending-deploy");
  });
});

describe("deploy (manual)", () => {
  it("prints content, records on --confirm, and flags later changes", () => {
    const { ctx, commit } = setup();
    const printed = deploy(ctx, "chat");
    assert.ok(printed.lines.some((l) => l.includes(RULE)));
    assert.equal(statusOf(ctx, "chat"), "manual-never");
    assert.ok(deploy(ctx, "chat", { confirm: true }).ok);
    assert.equal(statusOf(ctx, "chat"), "manual-confirmed");
    commit("rationale/chat.yaml", stringify([record({ text: "rule" })]));
    commit("surfaces/chat.md", `- ${RULE} v2\n`);
    assert.equal(statusOf(ctx, "chat"), "pending-deploy");
  });

  it("does nothing for channel none", () => {
    const { ctx } = setup();
    assert.ok(deploy(ctx, "cloud").ok);
    assert.equal(statusOf(ctx, "cloud"), "no-channel");
  });
});

describe("environment warnings", () => {
  it("warns on a non-empty AGENTS.override.md and unmanaged rules", () => {
    const { ctx, home } = setup();
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "AGENTS.override.md"), "x");
    mkdirSync(join(home, ".claude", "rules"), { recursive: true });
    writeFileSync(join(home, ".claude", "rules", "a.md"), "x");
    writeFileSync(join(home, ".codex", "config.toml"), 'project_doc_fallback_filenames = ["CLAUDE.md"]\n');
    const { warnings } = status(ctx);
    assert.ok(warnings.some((w) => w.includes("AGENTS.override.md")));
    assert.ok(warnings.some((w) => w.includes(".claude/rules")));
    assert.ok(warnings.some((w) => w.includes("project_doc_fallback_filenames")));
  });
});

describe("check-deps", () => {
  function withSkill(pinnedMatches: boolean) {
    const s = setup({
      deps: { upstream: "~/upstream", install_paths: { cli: ["~/.tool/skills/{name}"], chat: "manual" }, skills: [{ name: "sk" }] },
    });
    const installed = join(s.home, ".tool", "skills", "sk");
    const upstream = join(s.home, "upstream", "sk");
    for (const [dir, body] of [[installed, "v1"], [upstream, "v2"]]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), body);
    }
    const pinned = pinnedMatches ? hashDir(installed) : "sha256:old";
    writeFileSync(join(s.root, "evidence.json"), "{}");
    writeFileSync(
      join(s.root, "rationale/cli.yaml"),
      `# keep this comment\n${stringify([
        record({ status: "implemented", observed: "o", model: "m", evidence: "evidence.json", depends_on: [{ skill: "sk", pinned: { cli: pinned } }] }),
      ])}`,
    );
    return s;
  }

  it("reports upstream differences and pinned mismatches, and applies stale", () => {
    const { ctx, root } = withSkill(false);
    const r = checkDeps(ctx);
    assert.ok(r.problems.some((p) => p.includes("與 upstream 不同")));
    assert.ok(r.problems.some((p) => p.includes("應標為 stale")));
    assert.equal(r.staleTargets.length, 1);
    applyStale(ctx, r.staleTargets);
    const text = readFileSync(join(root, "rationale/cli.yaml"), "utf8");
    assert.ok(text.startsWith("# keep this comment"));
    assert.equal((parse(text) as { status: string }[])[0].status, "stale");
  });

  it("does not flag a matching pin", () => {
    const { ctx } = withSkill(true);
    assert.equal(checkDeps(ctx).staleTargets.length, 0);
  });

  it("flags implemented records whose skill is not installed", () => {
    const { ctx, home } = withSkill(true);
    rmSync(join(home, ".tool", "skills"), { recursive: true });
    assert.ok(checkDeps(ctx).problems.some((p) => p.includes("不得為 implemented")));
  });
});
