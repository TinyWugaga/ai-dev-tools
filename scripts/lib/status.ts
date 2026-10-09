import { existsSync, readFileSync } from "node:fs";
import { type Ctx, expandPath, loadState, loadSurfaces, readSource, sha256, uncommitted } from "./context.ts";
import { environmentWarnings } from "./env-checks.ts";
import { measure } from "./lint.ts";

export type SurfaceStatus =
  | "synced"
  | "pending-deploy"
  | "drift"
  | "never-deployed"
  | "unmanaged"
  | "manual-confirmed"
  | "manual-never"
  | "in-repo"
  | "no-channel";

const LABELS: Record<SurfaceStatus, string> = {
  synced: "已同步",
  "pending-deploy": "repo 有變更但尚未部署",
  drift: "目標檔被外部修改（drift）",
  "never-deployed": "尚未部署",
  unmanaged: "目標檔存在但從未由本 repo 部署（首次部署會先備份）",
  "manual-confirmed": "手動確認",
  "manual-never": "手動目標，從未確認",
  "in-repo": "repo 內實體檔",
  "no-channel": "沒有載入管道",
};

export interface StatusRow {
  surface: string;
  target?: string;
  status: SurfaceStatus;
  label: string;
  detail?: string;
}

const NEAR_LIMIT = 0.9;

export function status(ctx: Ctx): { rows: StatusRow[]; warnings: string[] } {
  const surfaces = loadSurfaces(ctx);
  const state = loadState(ctx);
  const rows: StatusRow[] = [];
  const warnings = environmentWarnings(ctx, surfaces);
  const row = (surface: string, s: SurfaceStatus, extra: Partial<StatusRow> = {}) =>
    rows.push({ surface, status: s, label: LABELS[s], ...extra });

  for (const surface of surfaces) {
    const entry = state.surfaces[surface.id] ?? {};
    if (surface.channel === "none") {
      row(surface.id, "no-channel");
      continue;
    }
    const sources = surface.files!.map((_, i) => readSource(ctx, surface, i));
    const dirty = uncommitted(ctx, surface.files!);
    const dirtyNote = dirty.length ? `未 commit：${dirty.join(", ")}` : undefined;

    if (surface.channel === "in-repo") {
      const limit = surface.limit;
      let detail = dirtyNote;
      if (limit && (limit.unit === "bytes" || limit.unit === "chars" || limit.unit === "lines")) {
        const size = measure(sources.join("\n"), limit.unit);
        detail = [`${size}/${limit.value} ${limit.unit}`, detail].filter(Boolean).join("；");
        if (size > Number(limit.value) * NEAR_LIMIT)
          warnings.push(`${surface.id}：${size}/${limit.value} ${limit.unit}，接近或超過上限`);
      }
      row(surface.id, "in-repo", { detail });
      continue;
    }

    if (surface.channel === "manual") {
      const m = entry.manual;
      if (!m) row(surface.id, "manual-never", { detail: dirtyNote });
      else if (m.hash !== sha256(sources.join("\n")))
        row(surface.id, "pending-deploy", { detail: `重新貼上後執行 deploy --confirm；上次確認 ${m.at}` });
      else row(surface.id, "manual-confirmed", { detail: `上次確認 ${m.at}（${m.revision.slice(0, 7)}）` });
      continue;
    }

    for (const [i, raw] of surface.targets!.entries()) {
      const target = expandPath(ctx, raw);
      const record = entry.targets?.[target];
      const exists = existsSync(target);
      const sourceHash = sha256(sources[i]);
      let s: SurfaceStatus;
      if (!record) s = exists ? "unmanaged" : "never-deployed";
      else if (exists && sha256(readFileSync(target)) !== record.hash) s = "drift";
      else if (!exists || sourceHash !== record.hash) s = "pending-deploy";
      else s = "synced";
      const detail = [record ? `上次部署 ${record.at}（${record.revision.slice(0, 7)}）` : undefined, dirtyNote]
        .filter(Boolean)
        .join("；");
      row(surface.id, s, { target, detail: detail || undefined });
    }
  }
  return { rows, warnings };
}
