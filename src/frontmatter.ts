import type { JsonValue } from "./types.js";

interface ParseResult {
  frontmatter: Record<string, JsonValue>;
  body: string;
}

function parseScalar(value: string): JsonValue {
  const trimmed = value.trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "null") {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseFrontmatter(input: string): ParseResult {
  if (!input.startsWith("---\n") && !input.startsWith("---\r\n")) {
    return {
      frontmatter: {},
      body: input,
    };
  }

  const lines = input.split(/\r?\n/);
  const frontmatter: Record<string, JsonValue> = {};
  let closingIndex = -1;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "---") {
      closingIndex = index;
      break;
    }
    if (!line.trim()) {
      continue;
    }
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);
    frontmatter[key] = parseScalar(value);
  }

  if (closingIndex === -1) {
    return {
      frontmatter: {},
      body: input,
    };
  }

  return {
    frontmatter,
    body: lines.slice(closingIndex + 1).join("\n").trimStart(),
  };
}
