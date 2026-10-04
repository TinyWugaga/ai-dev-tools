const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^#{1,6}\s/;
const RULE_LINE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*(```|~~~)/;

export function splitRuleBlocks(markdown: string): string[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  let inComment = false;

  const flush = () => {
    const text = current.join("\n").trim();
    if (text) blocks.push(text);
    current = [];
  };

  for (const line of lines) {
    if (fence) {
      current.push(line);
      if (line.trim().startsWith(fence)) {
        fence = null;
        flush();
      }
      continue;
    }
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    const fenceMatch = line.match(FENCE);
    if (fenceMatch) {
      flush();
      fence = fenceMatch[1];
      current.push(line);
      continue;
    }
    if (line.trim().startsWith("<!--")) {
      flush();
      if (!line.includes("-->")) inComment = true;
      continue;
    }
    if (!line.trim() || HEADING.test(line) || RULE_LINE.test(line)) {
      flush();
      continue;
    }
    const item = line.match(LIST_ITEM);
    if (item) {
      flush();
      current.push(item[3]);
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}
