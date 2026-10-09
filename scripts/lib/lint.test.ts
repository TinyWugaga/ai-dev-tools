import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { stringify } from "yaml";
import { splitRuleBlocks } from "./blocks.ts";
import { lint, type RationaleRecord } from "./lint.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const INTENTS = [
  { id: "a", goal: "A", kinds: ["agentic"], scopes: ["repo"] },
  { id: "b", goal: "B", kinds: ["agentic"], scopes: ["repo"] },
];
const SURFACES = [
  {
    id: "repo",
    kind: "agentic",
    scope: "repo",
    channel: "in-repo",
    files: ["RULES.md"],
    model: "m",
    limit: { value: 1000, unit: "bytes", source: "test", checked: "2026-10-04" },
  },
  { id: "cloud", kind: "agentic", scope: "repo", channel: "none" },
];
const record = (intent: string, text: string, extra: Partial<RationaleRecord> = {}) => ({
  intent,
  status: "experimental",
  text,
  observed: "unobserved: test",
  model: null,
  checked: "2026-10-04",
  evidence: "none",
  revisit_when: "never",
  ...extra,
});

function fixture(opts: { rules?: string; records?: unknown[]; surfaces?: unknown[]; files?: Record<string, string> } = {}) {
  const root = mkdtempSync(join(tmpdir(), "lint-"));
  dirs.push(root);
  const files: Record<string, string> = {
    "intents.yaml": stringify(INTENTS),
    "surfaces.yaml": stringify(opts.surfaces ?? SURFACES),
    "deps.yaml": stringify({ skills: [{ name: "s" }] }),
    "RULES.md": opts.rules ?? "# T\n\n- rule A\n- rule B\n",
    "rationale/repo.yaml": stringify(opts.records ?? [record("a", "rule A"), record("b", "rule B")]),
    ...opts.files,
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const hasError = (root: string, pattern: RegExp) => lint(root).errors.some((e) => pattern.test(e));

describe("lint", () => {
  it("passes a consistent fixture and skips channel none", () => {
    const result = lint(fixture());
    assert.deepEqual(result.errors, []);
    assert.equal(result.pending.length, 2);
  });

  it("rejects text that is not verbatim in the deploy file", () => {
    assert.ok(hasError(fixture({ records: [record("a", "rule A!"), record("b", "rule B")] }), /未逐字出現/));
  });

  it("rejects a paragraph not quoted by any record", () => {
    assert.ok(hasError(fixture({ rules: "- rule A\n- rule B\n- rule C\n" }), /未被 rationale 引用：「rule C」/));
  });

  it("requires a record for every applicable intent", () => {
    assert.ok(hasError(fixture({ rules: "- rule A\n", records: [record("a", "rule A")] }), /缺少 intent b/));
  });

  it("requires evidence and an observation for implemented", () => {
    const records = [record("a", "rule A", { status: "implemented" }), record("b", "rule B")];
    const root = fixture({ records });
    assert.ok(hasError(root, /implemented 必須有 evidence/));
    assert.ok(hasError(root, /implemented 不可為 unobserved/));
  });

  it("allows evidence none only on experimental", () => {
    const records = [record("a", "rule A", { status: "stale", observed: "x", model: "m" }), record("b", "rule B")];
    assert.ok(hasError(fixture({ records }), /stale 必須有 evidence/));
  });

  it("checks that the evidence path exists", () => {
    const extra = { status: "implemented" as const, observed: "x", model: "m", evidence: "evals/missing.json" };
    assert.ok(hasError(fixture({ records: [record("a", "rule A", extra), record("b", "rule B")] }), /evidence 路徑不存在/));
  });

  it("forbids text on not-needed records", () => {
    const extra = { status: "not-needed" as const, observed: "x", model: "m", evidence: "e.json" };
    const root = fixture({
      rules: "- rule B\n",
      records: [record("a", "rule A", extra), record("b", "rule B")],
      files: { "e.json": "{}" },
    });
    assert.ok(hasError(root, /not-needed 不可有 text/));
  });

  it("rejects unknown skills in depends_on", () => {
    const records = [record("a", "rule A", { depends_on: [{ skill: "x" }] }), record("b", "rule B")];
    assert.ok(hasError(fixture({ records }), /skill 未登記/));
  });

  it("errors when over an enforced limit and warns when enforce is warn", () => {
    const tight = structuredClone(SURFACES);
    tight[0].limit = { value: 5, unit: "bytes", source: "t", checked: "2026-10-04" };
    assert.ok(hasError(fixture({ surfaces: tight }), /超過上限/));
    tight[0].limit = { ...tight[0].limit!, enforce: "warn" } as typeof tight[0]["limit"];
    const result = lint(fixture({ surfaces: tight }));
    assert.ok(!result.errors.some((e) => /超過上限/.test(e)));
    assert.ok(result.warnings.some((w) => /超過上限/.test(w)));
  });

  it("downgrades missing intent records to warnings while migration is pending", () => {
    const pending = structuredClone(SURFACES).map((s) => (s.id === "repo" ? { ...s, migration: "pending" } : s));
    const result = lint(fixture({ surfaces: pending, rules: "- rule A\n", records: [record("a", "rule A")] }));
    assert.ok(!result.errors.some((e) => /缺少 intent b/.test(e)));
    assert.ok(result.warnings.some((w) => /缺少 intent b/.test(w)));
  });

  it("rejects intents that do not apply to the surface", () => {
    const intents = [...INTENTS, { id: "c", goal: "C", kinds: ["chat"], scopes: ["global"] }];
    const records = [record("a", "rule A"), record("b", "rule B"), record("c", "rule A")];
    assert.ok(hasError(fixture({ records, files: { "intents.yaml": stringify(intents) } }), /intent 不適用/));
  });
});

describe("splitRuleBlocks", () => {
  it("splits list items at every depth, skips headings and comments, keeps fences whole", () => {
    const md = [
      "# Title",
      "<!-- note",
      "still note -->",
      "- parent",
      "  1. child one",
      "  2. child two",
      "",
      "Para line 1",
      "line 2",
      "",
      "```sh",
      "npm run lint",
      "```",
      "---",
    ].join("\n");
    assert.deepEqual(splitRuleBlocks(md), [
      "parent",
      "child one",
      "child two",
      "Para line 1\nline 2",
      "```sh\nnpm run lint\n```",
    ]);
  });

  it("treats a parent with verbatim nested items as one quotable record", () => {
    const md = "- step:\n  1. one\n  2. two\n";
    const quoted = "step:\n  1. one\n  2. two";
    assert.ok(md.includes(quoted));
    assert.ok(splitRuleBlocks(md).every((b) => quoted.includes(b)));
  });
});
