import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse } from "yaml";
import { type Ctx, writeAtomic } from "./context.ts";

export interface GhResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}
export type Gh = (args: string[]) => GhResult;

export interface IssueResult {
  code: number;
  url?: string;
  log: string[];
}

interface Config {
  repo: string;
  project: { owner: string; number: number };
  labels: Record<Kind, string>;
}

type Kind = "decision" | "task";

const KEY_PATTERNS: Record<Kind, RegExp> = {
  decision: /^ADR-\d{4}$/,
  task: /^task-\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/,
};
const USAGE = "用法：npm run issue -- <decision|task> --key <key> --title <標題> --body-file <檔案>";

export function defaultGh(ctx: Ctx): Gh {
  const bin = ctx.env.AI_DEV_TOOLS_GH ?? "gh";
  return (args) => {
    const r = spawnSync(bin, args, { cwd: ctx.root, encoding: "utf8", timeout: 120_000 });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
  };
}

export const marker = (kind: Kind, key: string) => `<!-- ai-dev-tools:issue-sync:${kind}:${key} -->`;

function loadConfig(root: string): Config | string {
  const file = join(root, "github.yaml");
  if (!existsSync(file)) return "找不到 github.yaml";
  const c = parse(readFileSync(file, "utf8")) as Partial<Config> | null;
  if (!c || typeof c.repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(c.repo)) return "github.yaml: repo 必須是 owner/name";
  if (typeof c.project?.owner !== "string" || !Number.isInteger(c.project?.number) || c.project.number <= 0)
    return "github.yaml: project 必須有 owner 與正整數 number";
  if (typeof c.labels?.decision !== "string" || typeof c.labels?.task !== "string")
    return "github.yaml: labels 必須有 decision 與 task";
  return c as Config;
}

const ghError = (r: GhResult) => (r.error ? r.error.message : r.stderr.trim() || `exit ${r.status}`);
const scopeHint = (r: GhResult) => (/scope/i.test(r.stderr) ? ["缺少 scope 時由使用者執行：gh auth refresh -s project"] : []);

export function syncIssue(ctx: Ctx, gh: Gh, argv: string[]): IssueResult {
  const log: string[] = [];

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { key: { type: "string" }, title: { type: "string" }, "body-file": { type: "string" } },
      allowPositionals: true,
    });
  } catch (e) {
    return { code: 1, log: [(e as Error).message, USAGE] };
  }
  const [kind] = parsed.positionals as [Kind?];
  const { key, title } = parsed.values;
  log.push(`key：${kind ?? "?"}:${key ?? "?"}`);
  if (kind !== "decision" && kind !== "task") return { code: 1, log: [...log, USAGE] };
  if (!key || !KEY_PATTERNS[kind].test(key))
    return { code: 1, log: [...log, `key 格式不符：${kind} 需符合 ${KEY_PATTERNS[kind]}`] };
  if (!title?.trim()) return { code: 1, log: [...log, "title 不可為空"] };
  if (!parsed.values["body-file"]) return { code: 1, log: [...log, "缺少 --body-file"] };
  const bodyFile = resolve(process.cwd(), parsed.values["body-file"]);
  let body: string;
  try {
    body = readFileSync(bodyFile, "utf8");
  } catch {
    return { code: 1, log: [...log, `body-file 無法讀取：${bodyFile}`] };
  }
  const config = loadConfig(ctx.root);
  if (typeof config === "string") return { code: 1, log: [...log, config] };

  const stateDir = dirname(ctx.statePath);
  const lockPath = join(stateDir, "issue-sync.lock");
  const mapPath = join(stateDir, "issue-sync.json");
  mkdirSync(stateDir, { recursive: true });
  try {
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, JSON.stringify({ pid: process.pid, at: ctx.now().toISOString() }));
    closeSync(fd);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const holder = readFileSync(lockPath, "utf8");
    return {
      code: 1,
      log: [...log, `另一個同步正在執行：${lockPath}（${holder}）`, "確認該 pid 已不在執行後，手動刪除這個 lock 再重跑"],
    };
  }

  let tmp: string | undefined;
  try {
    const { repo, project } = config;
    const mapKey = `${kind}:${key}`;
    const mark = marker(kind, key);
    const urlPattern = new RegExp(`^https://github\\.com/${repo.replace(/[.]/g, "\\.")}/issues/\\d+$`);
    const stop = (stage: string, r: GhResult) => ({ code: 1, log: [...log, `${stage}失敗：${ghError(r)}`, ...scopeHint(r)] });

    const repoView = gh(["repo", "view", repo, "--json", "name"]);
    if (repoView.status !== 0) return stop("preflight（repo view）", repoView);
    const labels = gh(["label", "list", "--repo", repo, "--json", "name", "--limit", "200"]);
    if (labels.status !== 0) return stop("preflight（label list）", labels);
    const label = config.labels[kind];
    if (!(JSON.parse(labels.stdout) as { name: string }[]).some((l) => l.name === label))
      return { code: 1, log: [...log, `label「${label}」不存在，請先自行建立：gh label create ${label} --repo ${repo}`] };
    const projectView = gh(["project", "view", String(project.number), "--owner", project.owner, "--format", "json"]);
    if (projectView.status !== 0) return stop("preflight（project view）", projectView);

    const map = existsSync(mapPath) ? (JSON.parse(readFileSync(mapPath, "utf8")) as Record<string, string>) : {};
    let url: string | undefined = map[mapKey];
    if (url) {
      if (!urlPattern.test(url)) return { code: 1, log: [...log, `復原紀錄的 URL 不屬於 ${repo}：${url}`] };
      const view = gh(["issue", "view", url, "--repo", repo, "--json", "url,body,state"]);
      if (view.status !== 0) return stop("復原紀錄核對", view);
      const issue = JSON.parse(view.stdout) as { url: string; body: string; state: string };
      if (issue.url !== url || !issue.body.includes(mark))
        return { code: 1, log: [...log, `復原紀錄指向的 issue 與 key 不符：${url}，請人工核對 ${mapPath}`] };
      if (issue.state.toLowerCase() !== "open")
        return { code: 1, log: [...log, `對應的 issue 已關閉：${url}，不自動 reopen`] };
      log.push(`沿用復原紀錄：${url}`);
    } else {
      const list = gh(["api", "--hostname", "github.com", "--paginate", "--slurp", `repos/${repo}/issues?state=all&per_page=100`]);
      if (list.status !== 0) return stop("查詢既有 issue", list);
      const issues = (JSON.parse(list.stdout) as Record<string, unknown>[][])
        .flat()
        .filter((i) => !i.pull_request && typeof i.body === "string" && i.body.includes(mark));
      if (issues.length > 1)
        return { code: 1, log: [...log, `同一個 key 對到多筆 issue：${issues.map((i) => i.html_url).join(", ")}`] };
      if (issues.length === 1) {
        const found = issues[0];
        if (found.state !== "open") return { code: 1, log: [...log, `對應的 issue 已關閉：${found.html_url}，不自動 reopen`] };
        url = String(found.html_url);
        if (!urlPattern.test(url)) return { code: 1, log: [...log, `查到的 issue URL 不屬於 ${repo}：${url}`] };
        log.push(`重用既有 issue：${url}`);
      } else {
        tmp = mkdtempSync(join(tmpdir(), "issue-sync-"));
        const tmpBody = join(tmp, "body.md");
        writeFileSync(tmpBody, `${body.trimEnd()}\n\n${mark}\n`);
        const created = gh(["issue", "create", "--repo", repo, "--title", title, "--body-file", tmpBody, "--label", label]);
        if (created.status !== 0 || created.error)
          return {
            code: 1,
            log: [
              ...log,
              `issue create 失敗或結果不明：${ghError(created)}`,
              "請先核對 repo 是否已出現含此 key 的 issue；重跑同一指令會先比對 marker，不會重複建立",
            ],
          };
        url = created.stdout.trim().split("\n").pop()!.trim();
        if (!urlPattern.test(url)) return { code: 1, url, log: [...log, `issue create 回傳的 URL 不符預期：${url}，請人工核對`] };
        log.push(`已建立 issue：${url}`);
      }
      try {
        writeAtomic(mapPath, `${JSON.stringify({ ...map, [mapKey]: url }, null, 2)}\n`);
      } catch (e) {
        return { code: 1, url, log: [...log, `issue 已建立／重用，復原紀錄未保存（${(e as Error).message}），尚未加入 Project`] };
      }
    }

    const added = gh(["project", "item-add", String(project.number), "--owner", project.owner, "--url", url]);
    if (added.status !== 0)
      return {
        code: 1,
        url,
        log: [...log, `issue 已建立／重用，尚未加入 Project：${ghError(added)}`, ...scopeHint(added), "原因排除後重跑同一指令"],
      };
    return { code: 0, url, log: [...log, `已加入 Project ${project.owner}/${project.number}`] };
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    rmSync(lockPath, { force: true });
  }
}
