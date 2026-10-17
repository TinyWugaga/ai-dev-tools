import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { splitRuleBlocks } from "./blocks.ts";

export type Kind = "chat" | "agentic";
export type Scope = "global" | "repo";
export type Channel = "copy" | "manual" | "in-repo" | "none";
export type Status = "implemented" | "not-needed" | "experimental" | "stale" | "unimplemented";

export interface Intent {
  id: string;
  goal: string;
  kinds: Kind[];
  scopes: Scope[];
}

export interface Limit {
  value: number | null;
  unit: "chars" | "bytes" | "lines" | "unknown" | "none";
  enforce?: "error" | "warn";
  source: string;
  checked: string;
}

export interface Surface {
  id: string;
  kind: Kind;
  scope: Scope;
  channel: Channel;
  files?: string[];
  targets?: string[];
  model?: string | null;
  limit?: Limit;
  notes?: string;
  migration?: "pending";
}

export interface RationaleRecord {
  intent: string;
  status: Status;
  text?: string;
  observed: string;
  model?: string | null;
  checked: string;
  evidence: string;
  revisit_when: string;
  depends_on?: { skill: string; pinned?: Record<string, string> }[];
}

export interface LintResult {
  errors: string[];
  warnings: string[];
  pending: string[];
}

const KINDS = ["chat", "agentic"];
const SCOPES = ["global", "repo"];
const CHANNELS = ["copy", "manual", "in-repo", "none"];
const STATUSES = ["implemented", "not-needed", "experimental", "stale", "unimplemented"];
const TENTATIVE = ["experimental", "unimplemented"];
const UNITS = ["chars", "bytes", "lines", "unknown", "none"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UNOBSERVED = /^unobserved\b/;
const NEAR_LIMIT = 0.9;

function readYaml<T>(root: string, path: string, result: LintResult): T | undefined {
  const full = join(root, path);
  if (!existsSync(full)) {
    result.errors.push(`${path}: 檔案不存在`);
    return undefined;
  }
  try {
    return parse(readFileSync(full, "utf8")) as T;
  } catch (e) {
    result.errors.push(`${path}: YAML 解析失敗：${(e as Error).message}`);
    return undefined;
  }
}

export function measure(content: string, unit: Limit["unit"]): number {
  if (unit === "chars") return [...content].length;
  if (unit === "bytes") return Buffer.byteLength(content, "utf8");
  if (unit === "lines") return content === "" ? 0 : content.replace(/\n$/, "").split("\n").length;
  return 0;
}

function checkIntents(intents: Intent[], result: LintResult): Map<string, Intent> {
  const byId = new Map<string, Intent>();
  for (const [i, intent] of intents.entries()) {
    const where = `intents.yaml[${i}]`;
    if (!intent?.id) {
      result.errors.push(`${where}: 缺少 id`);
      continue;
    }
    if (byId.has(intent.id)) result.errors.push(`${where}: id 重複：${intent.id}`);
    if (!intent.goal) result.errors.push(`${where} (${intent.id}): 缺少 goal`);
    if (!Array.isArray(intent.kinds) || !intent.kinds.length || intent.kinds.some((k) => !KINDS.includes(k)))
      result.errors.push(`${where} (${intent.id}): kinds 必須是 ${KINDS.join("/")} 的非空清單`);
    if (!Array.isArray(intent.scopes) || !intent.scopes.length || intent.scopes.some((s) => !SCOPES.includes(s)))
      result.errors.push(`${where} (${intent.id}): scopes 必須是 ${SCOPES.join("/")} 的非空清單`);
    byId.set(intent.id, intent);
  }
  return byId;
}

function checkSurface(root: string, surface: Surface, result: LintResult): string | undefined {
  const where = `surfaces.yaml (${surface.id})`;
  if (!KINDS.includes(surface.kind)) result.errors.push(`${where}: kind 無效`);
  if (!SCOPES.includes(surface.scope)) result.errors.push(`${where}: scope 無效`);
  if (!CHANNELS.includes(surface.channel)) {
    result.errors.push(`${where}: channel 無效`);
    return undefined;
  }
  if (surface.migration !== undefined && surface.migration !== "pending")
    result.errors.push(`${where}: migration 只能是 pending 或不填`);
  if (surface.migration === "pending")
    result.warnings.push(`${where}: 遷移中（migration: pending），缺少的 intent 紀錄只列為警告，且不可 deploy`);
  if (surface.channel === "none") return undefined;

  if (!surface.files?.length) {
    result.errors.push(`${where}: channel 為 ${surface.channel} 時必須有 files`);
    return undefined;
  }
  if (surface.channel === "copy" && surface.targets?.length !== surface.files.length)
    result.errors.push(`${where}: channel 為 copy 時，targets 數量必須與 files 相同`);
  if ((surface.channel === "copy" || surface.channel === "in-repo") && !surface.model)
    result.warnings.push(`${where}: 尚未設定 model，eval runner 無法指定 model（ADR-0003 §6）`);

  const missing = surface.files.filter((f) => !existsSync(join(root, f)));
  for (const f of missing) result.errors.push(`${where}: 部署檔不存在：${f}`);
  if (missing.length) return undefined;

  const content = surface.files.map((f) => readFileSync(join(root, f), "utf8")).join("\n");
  if (!content.trim()) result.warnings.push(`${where}: 部署檔為空`);

  const limit = surface.limit;
  if (!limit) {
    result.errors.push(`${where}: 缺少 limit（未知請填 unit: unknown）`);
  } else if (!UNITS.includes(limit.unit)) {
    result.errors.push(`${where}: limit.unit 無效`);
  } else if (limit.unit === "unknown") {
    result.warnings.push(`${where}: 長度上限未知，無法檢查`);
  } else if (limit.unit !== "none") {
    if (!limit.source || !DATE.test(String(limit.checked ?? "")))
      result.errors.push(`${where}: limit 必須附 source 與 checked（YYYY-MM-DD）`);
    const size = measure(content, limit.unit);
    const max = Number(limit.value);
    const label = `${where}: ${size}/${max} ${limit.unit}`;
    if (size > max) (limit.enforce === "warn" ? result.warnings : result.errors).push(`${label}，超過上限`);
    else if (size > max * NEAR_LIMIT) result.warnings.push(`${label}，接近上限`);
  }
  return content;
}

function checkRecord(
  root: string,
  file: string,
  index: number,
  record: RationaleRecord,
  surface: Surface,
  intents: Map<string, Intent>,
  surfaceIds: Set<string>,
  skills: Set<string>,
  result: LintResult,
): void {
  const where = `${file}[${index}] (${record?.intent ?? "?"})`;
  const err = (msg: string) => result.errors.push(`${where}: ${msg}`);
  const intent = intents.get(record?.intent);
  if (!intent) return err("intent 不存在於 intents.yaml");
  if (!intent.kinds.includes(surface.kind) || !intent.scopes.includes(surface.scope))
    err(`intent 不適用於此 surface（kind=${surface.kind}, scope=${surface.scope}）`);
  if (!STATUSES.includes(record.status)) return err(`status 無效：${record.status}`);
  for (const field of ["observed", "evidence", "revisit_when"] as const)
    if (!record[field]) err(`缺少 ${field}`);
  if (!DATE.test(String(record.checked ?? ""))) err("checked 必須是 YYYY-MM-DD");

  const unobserved = UNOBSERVED.test(record.observed ?? "");
  const hasEvidence = record.evidence && record.evidence !== "none";

  if (record.status === "not-needed" || record.status === "unimplemented") {
    if (record.text) err(`${record.status} 不可有 text（規則不應出現在部署檔）`);
  } else if (!record.text?.trim()) {
    err("缺少 text（部署檔中的逐字原文）");
  }
  if (!TENTATIVE.includes(record.status)) {
    if (!hasEvidence) err(`${record.status} 必須有 evidence；evidence 為 none 時只能是 experimental 或 unimplemented（ADR-0002）`);
    if (unobserved) err(`${record.status} 不可為 unobserved；unobserved 只能是 experimental 或 unimplemented（ADR-0002）`);
  }
  if (!record.model && !unobserved) err("缺少 model（觀察時的 model）");
  if (hasEvidence && !existsSync(join(root, record.evidence))) err(`evidence 路徑不存在：${record.evidence}`);

  for (const dep of record.depends_on ?? []) {
    if (!skills.has(dep.skill)) err(`depends_on 的 skill 未登記於 deps.yaml：${dep.skill}`);
    for (const key of Object.keys(dep.pinned ?? {}))
      if (!surfaceIds.has(key)) err(`depends_on.pinned 的 surface 不存在：${key}`);
  }

  if (record.status !== "implemented" && record.status !== "not-needed")
    result.pending.push(`${surface.id} / ${record.intent}: ${record.status}`);
}

export function lint(root: string): LintResult {
  const result: LintResult = { errors: [], warnings: [], pending: [] };
  const intentList = readYaml<Intent[]>(root, "intents.yaml", result) ?? [];
  const surfaceList = readYaml<Surface[]>(root, "surfaces.yaml", result) ?? [];
  const deps = readYaml<{ skills?: { name: string }[] }>(root, "deps.yaml", result);
  if (!Array.isArray(intentList)) result.errors.push("intents.yaml: 頂層必須是清單");
  if (!Array.isArray(surfaceList)) result.errors.push("surfaces.yaml: 頂層必須是清單");
  if (result.errors.length) return result;

  const intents = checkIntents(intentList, result);
  const skills = new Set((deps?.skills ?? []).map((s) => s.name));
  const surfaceIds = new Set<string>();
  for (const s of surfaceList) {
    if (surfaceIds.has(s.id)) result.errors.push(`surfaces.yaml: id 重複：${s.id}`);
    surfaceIds.add(s.id);
  }

  for (const surface of surfaceList) {
    if (surface.channel === "none") {
      checkSurface(root, surface, result);
      continue;
    }
    const content = checkSurface(root, surface, result);
    const file = `rationale/${surface.id}.yaml`;
    const records = readYaml<RationaleRecord[] | null>(root, file, result) ?? [];
    if (!Array.isArray(records)) {
      result.errors.push(`${file}: 頂層必須是清單`);
      continue;
    }

    records.forEach((r, i) => checkRecord(root, file, i, r, surface, intents, surfaceIds, skills, result));

    for (const intent of intents.values()) {
      if (!intent.kinds.includes(surface.kind) || !intent.scopes.includes(surface.scope)) continue;
      if (records.some((r) => r?.intent === intent.id)) continue;
      const message = `${file}: 缺少 intent ${intent.id} 的紀錄（每個適用的 intent 都必須有狀態，ADR-0001）`;
      if (surface.migration === "pending") result.warnings.push(message);
      else result.errors.push(message);
    }

    if (content === undefined) continue;
    const texts = records.filter((r) => r?.text?.trim()).map((r) => r.text!.trim());
    for (const [i, r] of records.entries()) {
      if (r?.text?.trim() && !content.includes(r.text.trim()))
        result.errors.push(`${file}[${i}] (${r.intent}): text 未逐字出現在部署檔（${surface.files!.join(", ")}）`);
    }
    for (const block of splitRuleBlocks(content)) {
      if (!texts.some((t) => t.includes(block))) {
        const preview = block.length > 40 ? `${block.slice(0, 40)}…` : block;
        result.errors.push(`${surface.files!.join(", ")}: 段落未被 rationale 引用：「${preview}」`);
      }
    }
  }
  return result;
}
