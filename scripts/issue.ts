import { defaultCtx } from "./lib/context.ts";
import { defaultGh, syncIssue } from "./lib/issue.ts";

const ctx = defaultCtx();
const { code, url, log } = syncIssue(ctx, defaultGh(ctx), process.argv.slice(2));
for (const line of log) console.error(line);
if (url) console.log(url);
process.exitCode = code;
