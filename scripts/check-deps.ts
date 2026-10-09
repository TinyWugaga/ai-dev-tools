import { defaultCtx } from "./lib/context.ts";
import { applyStale, checkDeps } from "./lib/check-deps.ts";

const ctx = defaultCtx();
const { lines, problems, staleTargets } = checkDeps(ctx);
for (const line of lines) console.log(line);
if (problems.length) {
  console.log(`\n需要處理（${problems.length}）`);
  for (const p of problems) console.log(`  - ${p}`);
}
if (process.argv.includes("--apply") && staleTargets.length) {
  console.log("\n已更新 rationale：");
  for (const c of applyStale(ctx, staleTargets)) console.log(`  - ${c}`);
  console.log("執行 npm run lint 後 commit");
} else if (staleTargets.length) {
  console.log("\n加上 --apply 會把上述紀錄的 status 改為 stale");
}
process.exitCode = problems.length ? 1 : 0;
