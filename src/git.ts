import { access, stat } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PULL_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface SyncResult {
  didClone: boolean;
  didPull: boolean;
  pullAttempted: boolean;
  pullSucceeded: boolean;
  warnings: string[];
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function isLocalDirectorySource(source: string): Promise<boolean> {
  try {
    const sourceStat = await stat(path.resolve(source));
    return sourceStat.isDirectory();
  } catch {
    return false;
  }
}

export async function runGit(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, {
    cwd,
    windowsHide: true,
  });
}

export function deriveAgencyKey(repoUrl: string): string {
  const normalized = repoUrl
    .replace(/\\/g, "/")
    .replace(/^git@[^:]+:/, "")
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\.git$/, "");
  const parts = normalized.split("/").filter(Boolean);
  const tail = parts.slice(-2).join("-");
  return tail
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getRepoLocalPath(reposDir: string, agencyKey: string): string {
  return path.join(reposDir, agencyKey);
}

export function shouldAttemptPull(lastPullAttemptAt?: string): boolean {
  if (!lastPullAttemptAt) {
    return true;
  }
  const last = new Date(lastPullAttemptAt).getTime();
  if (Number.isNaN(last)) {
    return true;
  }
  return Date.now() - last >= PULL_INTERVAL_MS;
}

export async function ensureRepo(
  repoUrl: string,
  localPath: string,
  lastPullAttemptAt?: string,
): Promise<SyncResult> {
  const warnings: string[] = [];
  const exists = await pathExists(localPath);

  if (!exists) {
    await runGit(["clone", repoUrl, localPath]);
    return {
      didClone: true,
      didPull: false,
      pullAttempted: false,
      pullSucceeded: false,
      warnings,
    };
  }

  if (!shouldAttemptPull(lastPullAttemptAt)) {
    return {
      didClone: false,
      didPull: false,
      pullAttempted: false,
      pullSucceeded: false,
      warnings,
    };
  }

  try {
    await runGit(["pull", "--ff-only"], localPath);
    return {
      didClone: false,
      didPull: true,
      pullAttempted: true,
      pullSucceeded: true,
      warnings,
    };
  } catch (error) {
    warnings.push(
      "The cached repo could not be refreshed from git, so the CLI kept using the existing local copy.",
    );
    return {
      didClone: false,
      didPull: false,
      pullAttempted: true,
      pullSucceeded: false,
      warnings,
    };
  }
}
