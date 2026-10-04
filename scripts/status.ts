import { defaultCtx } from "./lib/context.ts";
import { status } from "./lib/status.ts";

const { rows, warnings } = status(defaultCtx());
for (const r of rows) {
  const target = r.target ? ` → ${r.target}` : "";
  console.log(`${r.surface}${target}：${r.label}${r.detail ? `（${r.detail}）` : ""}`);
}
for (const w of warnings) console.log(`警告：${w}`);
process.exitCode = rows.some((r) => r.status === "drift") ? 1 : 0;
