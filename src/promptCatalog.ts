import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parseFrontmatter } from "./frontmatter.js";
import type {
  ErrorResponse,
  JsonValue,
  ListingFolder,
  ListingPromptSummary,
  ListingResponse,
  PromptFile,
  PromptResponse,
} from "./types.js";

type DirectoryItem =
  | { kind: "directory"; name: string; fullPath: string; relativePath: string }
  | { kind: "file"; name: string; fullPath: string; relativePath: string; fileName: string };

type IgnoreRule = {
  pattern: string;
  negated: boolean;
  directoryOnly: boolean;
  anchored: boolean;
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pickFields<T extends Record<string, JsonValue>>(record: T, fields?: string[]): Record<string, JsonValue> {
  if (!fields || fields.length === 0) {
    return record;
  }
  const selected = new Set(fields);
  const output: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(record)) {
    if (selected.has(key)) {
      output[key] = value;
    }
  }
  return output;
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function parseIgnoreRules(content: string): IgnoreRule[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const negated = line.startsWith("!");
      const rawPattern = negated ? line.slice(1) : line;
      const directoryOnly = rawPattern.endsWith("/");
      const withoutTrailingSlash = directoryOnly ? rawPattern.slice(0, -1) : rawPattern;
      const anchored = withoutTrailingSlash.startsWith("/");
      const pattern = anchored ? withoutTrailingSlash.slice(1) : withoutTrailingSlash;
      return {
        pattern,
        negated,
        directoryOnly,
        anchored,
      };
    })
    .filter((rule) => rule.pattern.length > 0);
}

async function loadIgnoreRules(repoRoot: string): Promise<IgnoreRule[]> {
  try {
    const content = await readFile(path.join(repoRoot, ".gitignore"), "utf8");
    return parseIgnoreRules(content);
  } catch {
    return [];
  }
}

function matchesRule(relativePath: string, isDirectory: boolean, rule: IgnoreRule): boolean {
  if (rule.directoryOnly && !isDirectory) {
    return false;
  }

  const normalizedPath = toPosixPath(relativePath).toLowerCase();
  const basename = path.posix.basename(normalizedPath);
  const normalizedPattern = rule.pattern.toLowerCase();

  if (rule.directoryOnly) {
    if (rule.anchored) {
      return normalizedPath === normalizedPattern || normalizedPath.startsWith(`${normalizedPattern}/`);
    }
    if (!normalizedPattern.includes("/")) {
      return normalizedPath.split("/").some((segment) => path.matchesGlob(segment, normalizedPattern));
    }
    return (
      path.matchesGlob(normalizedPath, normalizedPattern) ||
      path.matchesGlob(normalizedPath, `**/${normalizedPattern}`) ||
      normalizedPath.startsWith(`${normalizedPattern}/`) ||
      normalizedPath.includes(`/${normalizedPattern}/`)
    );
  }

  if (rule.anchored) {
    return path.matchesGlob(normalizedPath, normalizedPattern);
  }

  if (!normalizedPattern.includes("/")) {
    return path.matchesGlob(basename, normalizedPattern);
  }

  return (
    path.matchesGlob(normalizedPath, normalizedPattern) ||
    path.matchesGlob(normalizedPath, `**/${normalizedPattern}`)
  );
}

function hasDotPrefixedSegment(relativePath: string): boolean {
  return toPosixPath(relativePath)
    .split("/")
    .some((segment) => segment.startsWith("."));
}

function shouldIgnore(relativePath: string, isDirectory: boolean, ignoreRules: IgnoreRule[]): boolean {
  const normalizedPath = toPosixPath(relativePath);
  let ignored = hasDotPrefixedSegment(normalizedPath);

  for (const rule of ignoreRules) {
    if (!matchesRule(normalizedPath, isDirectory, rule)) {
      continue;
    }
    ignored = !rule.negated;
  }

  return ignored;
}

function shouldExcludeRootMarkdown(relativeDir: string, fileName: string): boolean {
  if (relativeDir !== "") {
    return false;
  }
  return /^(readme|contributing)(?:[._-].+)?\.md$/i.test(fileName);
}

async function getDirectoryItems(repoRoot: string, relativeDir = "", ignoreRules?: IgnoreRule[]): Promise<DirectoryItem[]> {
  const currentPath = path.join(repoRoot, relativeDir);
  const entries = await readdir(currentPath, { withFileTypes: true });
  const items: DirectoryItem[] = [];
  const rules = ignoreRules ?? (await loadIgnoreRules(repoRoot));

  for (const entry of entries) {
    const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    const fullPath = path.join(repoRoot, relativePath);
    if (entry.isDirectory()) {
      if (shouldIgnore(relativePath, true, rules)) {
        continue;
      }
      items.push({ kind: "directory", name: entry.name, fullPath, relativePath });
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      if (shouldIgnore(relativePath, false, rules) || shouldExcludeRootMarkdown(relativeDir, entry.name)) {
        continue;
      }
      items.push({
        kind: "file",
        name: entry.name,
        fileName: entry.name,
        fullPath,
        relativePath,
      });
    }
  }

  return items.sort((left, right) => left.name.localeCompare(right.name));
}

async function loadPrompt(filePath: string, relativePath: string, fileName: string): Promise<PromptFile> {
  const raw = await readFile(filePath, "utf8");
  const parsed = parseFrontmatter(raw);
  return {
    fileName,
    path: relativePath.replace(/\\/g, "/"),
    frontmatter: parsed.frontmatter,
    prompt: parsed.body,
  };
}

async function buildPromptSummary(item: Extract<DirectoryItem, { kind: "file" }>, fields?: string[]): Promise<ListingPromptSummary> {
  const prompt = await loadPrompt(item.fullPath, item.relativePath, item.fileName);
  return {
    fileName: prompt.fileName,
    path: prompt.path,
    ...pickFields(prompt.frontmatter, fields),
  };
}

async function buildListing(
  repoRoot: string,
  agency: string,
  contextPath: string,
  fields?: string[],
): Promise<ListingResponse> {
  const ignoreRules = await loadIgnoreRules(repoRoot);
  const items = await getDirectoryItems(repoRoot, contextPath, ignoreRules);
  const subdepartments: ListingFolder[] = items
    .filter((item): item is Extract<DirectoryItem, { kind: "directory" }> => item.kind === "directory")
    .map((item) => ({
      name: item.name,
      path: item.relativePath.replace(/\\/g, "/"),
    }));

  const prompts = await Promise.all(
    items
      .filter((item): item is Extract<DirectoryItem, { kind: "file" }> => item.kind === "file")
      .map((item) => buildPromptSummary(item, fields)),
  );

  const humanContext = contextPath ? `under "${contextPath.replace(/\\/g, "/")}"` : "at the repo root";
  return {
    ok: true,
    type: "listing",
    message: `These are the available options ${humanContext}. Choose a subdepartment or prompt file for the next agency command.`,
    agency,
    contextPath: contextPath.replace(/\\/g, "/"),
    subdepartments,
    prompts,
  };
}

function buildError(message: string, candidates?: string[], contextPath?: string): ErrorResponse {
  return {
    ok: false,
    type: "error",
    message,
    ...(candidates ? { candidates } : {}),
    ...(contextPath ? { contextPath: contextPath.replace(/\\/g, "/") } : {}),
  };
}

async function resolveSinglePrompt(
  agency: string,
  item: Extract<DirectoryItem, { kind: "file" }>,
  matchSource: string,
  fields?: string[],
): Promise<PromptResponse> {
  const prompt = await loadPrompt(item.fullPath, item.relativePath, item.fileName);
  const baseRecord: Record<string, JsonValue> = {
    ...prompt.frontmatter,
    fileName: prompt.fileName,
    path: prompt.path,
    prompt: prompt.prompt,
  };
  const projected = fields && fields.length > 0 ? pickFields(baseRecord, fields) : baseRecord;

  return {
    ok: true,
    type: "prompt",
    message: `Resolved prompt "${prompt.fileName}" from agency "${agency}".`,
    agency,
    fileName: prompt.fileName,
    path: prompt.path,
    prompt: prompt.prompt,
    matchedBy: matchSource,
    ...projected,
  };
}

async function matchSelector(
  items: DirectoryItem[],
  selector: string,
): Promise<{ matches: DirectoryItem[]; sources: Map<string, string> }> {
  const desired = normalize(selector);
  const scoredMatches = new Map<string, { item: DirectoryItem; score: number; source: string }>();
  const sources = new Map<string, string>();
  let bestScore = 0;

  const updateMatch = (item: DirectoryItem, score: number, source: string): void => {
    if (score <= 0) {
      return;
    }
    const existing = scoredMatches.get(item.relativePath);
    if (!existing || score > existing.score) {
      scoredMatches.set(item.relativePath, { item, score, source });
      if (score > bestScore) {
        bestScore = score;
      }
    }
  };

  const scoreCandidate = (candidate: string): number => {
    if (candidate === desired) {
      return 3;
    }
    if (candidate.startsWith(desired) || desired.startsWith(candidate)) {
      return 2;
    }
    if (candidate.includes(desired)) {
      return 1;
    }
    return 0;
  };

  for (const item of items) {
    updateMatch(item, scoreCandidate(normalize(item.name)), "fileName");

    if (item.kind === "file") {
      const prompt = await loadPrompt(item.fullPath, item.relativePath, item.fileName);
      const frontmatterName = typeof prompt.frontmatter.name === "string" ? prompt.frontmatter.name : undefined;
      if (frontmatterName) {
        updateMatch(item, scoreCandidate(normalize(frontmatterName)), "frontmatter.name");
      }
    }
  }

  const matches = Array.from(scoredMatches.values())
    .filter((match) => match.score === bestScore)
    .map((match) => {
      sources.set(match.item.relativePath, match.source);
      return match.item;
    });

  return { matches, sources };
}

export async function resolveAgencyPath(
  repoRoot: string,
  agency: string,
  selectors: string[],
  fields?: string[],
): Promise<ListingResponse | PromptResponse | ErrorResponse> {
  let currentDir = "";
  const ignoreRules = await loadIgnoreRules(repoRoot);

  if (selectors.length === 0) {
    return buildListing(repoRoot, agency, currentDir, fields);
  }

  for (let index = 0; index < selectors.length; index += 1) {
    const selector = selectors[index];
    const isLast = index === selectors.length - 1;
    const items = await getDirectoryItems(repoRoot, currentDir, ignoreRules);
    const { matches, sources } = await matchSelector(items, selector);

    if (matches.length === 0) {
      const available = items.map((item) => item.name);
      return buildError(
        `Nothing matched "${selector}" ${currentDir ? `under "${currentDir.replace(/\\/g, "/")}"` : "at the repo root"}. Choose one of the available options.`,
        available,
        currentDir,
      );
    }

    if (matches.length > 1) {
      return buildError(
        `More than one option matched "${selector}". Choose one of these exact candidates.`,
        matches.map((item) => item.relativePath.replace(/\\/g, "/")),
        currentDir,
      );
    }

    const [match] = matches;
    if (match.kind === "directory") {
      currentDir = match.relativePath;
      if (isLast) {
        return buildListing(repoRoot, agency, currentDir, fields);
      }
      continue;
    }

    if (!isLast) {
      return buildError(
        `"${match.fileName}" is a prompt file, so there are no deeper path options after it.`,
        undefined,
        currentDir,
      );
    }

    const source = sources.get(match.relativePath) ?? "fileName";
    return resolveSinglePrompt(agency, match, source, fields);
  }

  return buildListing(repoRoot, agency, currentDir, fields);
}
