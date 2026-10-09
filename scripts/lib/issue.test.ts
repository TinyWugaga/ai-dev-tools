import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import { stringify } from "yaml";
import type { Ctx } from "./context.ts";
import { type Gh, type GhResult, marker, syncIssue } from "./issue.ts";

const REPO = "o/r";
const PROJECT = ["5", "--owner", "o"];
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ok = (stdout = ""): GhResult => ({ status: 0, stdout, stderr: "" });
const bad = (stderr: string): GhResult => ({ status: 1, stdout: "", stderr });
const issueUrl = (n: number) => `https://github.com/${REPO}/issues/${n}`;
const restIssue = (n: number, body: string, extra: Record<string, unknown> = {}) => ({
  number: n,
  url: `https://api.github.com/repos/${REPO}/issues/${n}`,
  html_url: issueUrl(n),
  state: "open",
  title: `t${n}`,
  body,
  ...extra,
});

function setup() {
  const base = mkdtempSync(join(tmpdir(), "issue-"));
  dirs.push(base);
  const root = join(base, "repo");
  mkdirSync(root);
  writeFileSync(
    join(root, "github.yaml"),
    stringify({ repo: REPO, project: { owner: "o", number: 5 }, labels: { decision: "decision", task: "task" } }),
  );
  const bodyFile = join(base, "body.md");
  writeFileSync(bodyFile, "ADR 內容\n");
  const ctx: Ctx = {
    root,
    home: join(base, "home"),
    env: {},
    statePath: join(base, "state", "state.json"),
    now: () => new Date("2026-10-09T00:00:00Z"),
  };
  const stateDir = dirname(ctx.statePath);
  return { ctx, bodyFile, stateDir, mapPath: join(stateDir, "issue-sync.json"), lockPath: join(stateDir, "issue-sync.lock") };
}

type Handler = (args: string[]) => GhResult | undefined;

function stubGh(pages: unknown[][] = [[]], override: Handler = () => undefined) {
  const calls: string[][] = [];
  let next = 100;
  const gh: Gh = (args) => {
    calls.push(args);
    const o = override(args);
    if (o) return o;
    const cmd = args.slice(0, 2).join(" ");
    if (cmd === "repo view") return ok('{"name":"r"}');
    if (cmd === "label list") return ok('[{"name":"decision"},{"name":"task"}]');
    if (cmd === "project view") return ok("{}");
    if (args[0] === "api") return ok(JSON.stringify(pages));
    if (cmd === "issue create") return ok(`${issueUrl(next++)}\n`);
    if (cmd === "project item-add") return ok("");
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  const named = (sub: string) => calls.filter((c) => c.slice(0, 2).join(" ") === sub);
  return { gh, calls, named };
}

const argv = (bodyFile: string, key = "ADR-0005", title = "ADR-0005 標題", kind = "decision") => [
  kind,
  "--key",
  key,
  "--title",
  title,
  "--body-file",
  bodyFile,
];

describe("syncIssue", () => {
  it("建立新 issue、附 marker、存 mapping、加入 Project", () => {
    const { ctx, bodyFile, mapPath, lockPath } = setup();
    let createdBody = "";
    const s = stubGh([[]], (args) => {
      if (args[1] === "create") createdBody = readFileSync(args[args.indexOf("--body-file") + 1], "utf8");
      return undefined;
    });
    const r = syncIssue(ctx, s.gh, argv(bodyFile));
    assert.equal(r.code, 0, r.log.join("\n"));
    assert.equal(r.url, issueUrl(100));
    assert.ok(createdBody.includes(marker("decision", "ADR-0005")));
    assert.deepEqual(JSON.parse(readFileSync(mapPath, "utf8")), { "decision:ADR-0005": issueUrl(100) });
    assert.deepEqual(s.named("project item-add")[0], ["project", "item-add", ...PROJECT, "--url", issueUrl(100)]);
    assert.ok(r.log[0].includes("decision:ADR-0005"));
    assert.equal(existsSync(lockPath), false);
  });

  it("每個呼叫都明確指定目標", () => {
    const { ctx, bodyFile } = setup();
    const s = stubGh();
    syncIssue(ctx, s.gh, argv(bodyFile));
    for (const c of s.calls) {
      if (c[0] === "api") {
        assert.deepEqual(c.slice(1, 3), ["--hostname", "github.com"]);
        assert.ok(c.at(-1)!.startsWith(`repos/${REPO}/issues?`));
      } else if (c[0] === "project") {
        assert.deepEqual(c.slice(2, 5), PROJECT);
      } else if (c[0] === "repo") {
        assert.equal(c[2], REPO);
      } else {
        assert.equal(c[c.indexOf("--repo") + 1], REPO, c.join(" "));
      }
    }
  });

  it("參數或設定無效時不呼叫 gh", () => {
    const { ctx, bodyFile } = setup();
    for (const args of [
      argv(bodyFile, "ADR-5"),
      argv(bodyFile, "task-2026-10-09-x", "t", "decision"),
      argv(bodyFile, "ADR-0005", " "),
      argv(join(bodyFile, "missing")),
      ["other", "--key", "ADR-0005"],
    ]) {
      const s = stubGh();
      assert.equal(syncIssue(ctx, s.gh, args).code, 1);
      assert.equal(s.calls.length, 0, args.join(" "));
    }
    writeFileSync(join(ctx.root, "github.yaml"), stringify({ repo: "bad" }));
    const s = stubGh();
    assert.equal(syncIssue(ctx, s.gh, argv(bodyFile)).code, 1);
    assert.equal(s.calls.length, 0);
  });

  it("preflight 或查詢失敗時不 create", () => {
    for (const failing of ["repo view", "label list", "project view", "api"]) {
      const { ctx, bodyFile, lockPath } = setup();
      const s = stubGh([[]], (args) =>
        args.slice(0, 2).join(" ") === failing || args[0] === failing ? bad("boom") : undefined,
      );
      const r = syncIssue(ctx, s.gh, argv(bodyFile));
      assert.equal(r.code, 1);
      assert.equal(s.named("issue create").length, 0, failing);
      assert.equal(existsSync(lockPath), false);
    }
  });

  it("label 不存在時停止並提示自行建立", () => {
    const { ctx, bodyFile } = setup();
    const s = stubGh([[]], (args) => (args[1] === "list" ? ok('[{"name":"task"}]') : undefined));
    const r = syncIssue(ctx, s.gh, argv(bodyFile));
    assert.equal(r.code, 1);
    assert.ok(r.log.some((l) => l.includes("gh label create decision")));
    assert.equal(s.named("issue create").length, 0);
  });

  it("只有缺 scope 時才提示 refresh", () => {
    const { ctx, bodyFile } = setup();
    const scope = stubGh([[]], (args) =>
      args[1] === "view" && args[0] === "project" ? bad("missing required scopes [read:project]") : undefined,
    );
    assert.ok(syncIssue(ctx, scope.gh, argv(bodyFile)).log.some((l) => l.includes("gh auth refresh -s project")));
    const other = stubGh([[]], (args) => (args[1] === "view" && args[0] === "project" ? bad("not found") : undefined));
    assert.ok(!syncIssue(ctx, other.gh, argv(bodyFile)).log.some((l) => l.includes("refresh")));
  });

  it("以 marker 比對：跨分頁攤平、濾掉 PR、key 相同標題不同時重用並存 html_url", () => {
    const { ctx, bodyFile, mapPath } = setup();
    const mark = marker("decision", "ADR-0005");
    const pages = [
      [restIssue(1, "x"), restIssue(2, `pr\n${mark}`, { pull_request: { url: "u" } })],
      [restIssue(3, `舊標題\n\n${mark}\n`)],
    ];
    const s = stubGh(pages);
    const r = syncIssue(ctx, s.gh, argv(bodyFile, "ADR-0005", "新標題"));
    assert.equal(r.code, 0, r.log.join("\n"));
    assert.equal(r.url, issueUrl(3));
    assert.equal(s.named("issue create").length, 0);
    assert.equal(JSON.parse(readFileSync(mapPath, "utf8"))["decision:ADR-0005"], issueUrl(3));
  });

  it("標題相同但 key 不同時建立新 issue", () => {
    const { ctx, bodyFile } = setup();
    const s = stubGh([[restIssue(1, marker("decision", "ADR-0004"), { title: "同標題" })]]);
    const r = syncIssue(ctx, s.gh, argv(bodyFile, "ADR-0005", "同標題"));
    assert.equal(r.code, 0);
    assert.equal(s.named("issue create").length, 1);
  });

  it("同 key 多筆時報錯；已關閉時不寫入", () => {
    const mark = marker("decision", "ADR-0005");
    for (const pages of [
      [[restIssue(1, mark)], [restIssue(2, mark)]],
      [[restIssue(1, mark, { state: "closed" })]],
    ]) {
      const { ctx, bodyFile, mapPath } = setup();
      const s = stubGh(pages);
      assert.equal(syncIssue(ctx, s.gh, argv(bodyFile)).code, 1);
      assert.equal(s.named("issue create").length, 0);
      assert.equal(s.named("project item-add").length, 0);
      assert.equal(existsSync(mapPath), false);
    }
  });

  it("item-add 失敗為部分成功；重跑時靠 mapping 只補 item-add", () => {
    const { ctx, bodyFile } = setup();
    const first = stubGh([[]], (args) => (args[1] === "item-add" ? bad("network") : undefined));
    const r1 = syncIssue(ctx, first.gh, argv(bodyFile));
    assert.equal(r1.code, 1);
    assert.equal(r1.url, issueUrl(100));
    assert.ok(r1.log.some((l) => l.includes("尚未加入 Project")));

    const body = `ADR 內容\n\n${marker("decision", "ADR-0005")}\n`;
    const second = stubGh([[]], (args) =>
      args[0] === "issue" && args[1] === "view" ? ok(JSON.stringify({ url: issueUrl(100), body, state: "OPEN" })) : undefined,
    );
    const r2 = syncIssue(ctx, second.gh, argv(bodyFile));
    assert.equal(r2.code, 0, r2.log.join("\n"));
    assert.equal(second.named("issue create").length, 0);
    assert.equal(second.calls.filter((c) => c[0] === "api").length, 0);
    assert.equal(second.named("project item-add").length, 1);
  });

  it("mapping 指向已關閉或 marker 不符的 issue 時報錯不寫入", () => {
    for (const issue of [
      { url: issueUrl(7), body: marker("decision", "ADR-0005"), state: "CLOSED" },
      { url: issueUrl(7), body: marker("decision", "ADR-0006"), state: "OPEN" },
    ]) {
      const { ctx, bodyFile, mapPath } = setup();
      mkdirSync(dirname(mapPath), { recursive: true });
      writeFileSync(mapPath, JSON.stringify({ "decision:ADR-0005": issueUrl(7) }));
      const s = stubGh([[]], (args) => (args[1] === "view" && args[0] === "issue" ? ok(JSON.stringify(issue)) : undefined));
      assert.equal(syncIssue(ctx, s.gh, argv(bodyFile)).code, 1);
      assert.equal(s.named("issue create").length, 0);
      assert.equal(s.named("project item-add").length, 0);
    }
  });

  it("mapping 寫入失敗時仍回傳 URL 並停止", () => {
    const { ctx, bodyFile, mapPath, lockPath } = setup();
    const s = stubGh([[]], (args) => {
      if (args[1] === "create") mkdirSync(join(mapPath, "block"), { recursive: true });
      return undefined;
    });
    const r = syncIssue(ctx, s.gh, argv(bodyFile));
    assert.equal(r.code, 1);
    assert.equal(r.url, issueUrl(100));
    assert.ok(r.log.some((l) => l.includes("復原紀錄未保存")));
    assert.equal(s.named("project item-add").length, 0);
    assert.equal(existsSync(lockPath), false);
  });

  it("create 結果不明時停止，不重試", () => {
    const { ctx, bodyFile } = setup();
    const s = stubGh([[]], (args) =>
      args[1] === "create" ? { status: null, stdout: "", stderr: "", error: new Error("ETIMEDOUT") } : undefined,
    );
    const r = syncIssue(ctx, s.gh, argv(bodyFile));
    assert.equal(r.code, 1);
    assert.equal(s.named("issue create").length, 1);
    assert.ok(r.log.some((l) => l.includes("結果不明")));
  });

  it("lock 已存在時不呼叫 gh，也不動既有 lock", () => {
    const { ctx, bodyFile, lockPath } = setup();
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, '{"pid":1,"at":"x"}');
    const s = stubGh();
    const r = syncIssue(ctx, s.gh, argv(bodyFile));
    assert.equal(r.code, 1);
    assert.equal(s.calls.length, 0);
    assert.equal(readFileSync(lockPath, "utf8"), '{"pid":1,"at":"x"}');
    assert.ok(r.log.some((l) => l.includes(lockPath)));
  });
});

describe("issue CLI", () => {
  it("部分成功時 exit 1、stdout 只有 URL、stderr 有階段訊息", () => {
    const { bodyFile, stateDir } = setup();
    const fake = join(stateDir, "..", "fake-gh.mjs");
    writeFileSync(
      fake,
      `#!/usr/bin/env node
const a = process.argv.slice(2), cmd = a.slice(0, 2).join(" ");
const out = (s) => process.stdout.write(s);
if (cmd === "repo view") out('{"name":"x"}');
else if (cmd === "label list") out('[{"name":"decision"},{"name":"task"}]');
else if (cmd === "project view") out("{}");
else if (a[0] === "api") out("[[]]");
else if (cmd === "issue create") out("https://github.com/TinyWugaga/ai-dev-tools/issues/42\\n");
else { process.stderr.write("missing required scopes [project]"); process.exit(1); }
`,
    );
    chmodSync(fake, 0o755);
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const r = spawnSync(process.execPath, [join(root, "scripts", "issue.ts"), ...argv(bodyFile)], {
      encoding: "utf8",
      env: { ...process.env, AI_DEV_TOOLS_GH: fake, AI_DEV_TOOLS_STATE: join(stateDir, "state.json") },
    });
    assert.equal(r.status, 1, r.stderr);
    assert.equal(r.stdout, "https://github.com/TinyWugaga/ai-dev-tools/issues/42\n");
    assert.match(r.stderr, /尚未加入 Project/);
    assert.match(r.stderr, /gh auth refresh -s project/);
    assert.match(r.stderr, /decision:ADR-0005/);
  });
});
