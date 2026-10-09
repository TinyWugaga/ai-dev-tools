import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lint } from "./lib/lint.ts";

const root = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const { errors, warnings, pending } = lint(root);

const section = (title: string, items: string[]) => {
  if (!items.length) return;
  console.log(`\n${title}（${items.length}）`);
  for (const item of items) console.log(`  - ${item}`);
};

section("錯誤", errors);
section("警告", warnings);
section("待驗（experimental / stale / unimplemented）", pending);
console.log(errors.length ? `\nlint 失敗：${errors.length} 個錯誤` : "\nlint 通過");
process.exitCode = errors.length ? 1 : 0;
