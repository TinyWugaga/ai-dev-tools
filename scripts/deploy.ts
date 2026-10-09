import { defaultCtx } from "./lib/context.ts";
import { deploy } from "./lib/deploy.ts";

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith("--"));
if (!id) {
  console.error("用法：npm run deploy -- <surface-id> [--confirm | --pull | --overwrite]");
  process.exit(2);
}
const result = deploy(defaultCtx(), id, {
  confirm: args.includes("--confirm"),
  pull: args.includes("--pull"),
  overwrite: args.includes("--overwrite"),
});
for (const line of result.lines) console.log(line);
process.exitCode = result.ok ? 0 : 1;
