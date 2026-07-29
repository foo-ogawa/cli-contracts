import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { VersionSyncFile, VersionSyncResult } from "../types.js";

export interface VersionSyncOptions {
  check?: boolean;
  packageFile?: string;
}

class VersionSyncError extends Error {}

export async function readPackageVersion(packageFile: string): Promise<string> {
  let raw: string;
  try {
    raw = await readFile(resolve(packageFile), "utf-8");
  } catch (err) {
    throw new VersionSyncError(
      `Cannot read package file ${packageFile}: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new VersionSyncError(
      `Cannot parse ${packageFile} as JSON: ${(err as Error).message}`,
    );
  }

  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== "string" || version.length === 0) {
    throw new VersionSyncError(`${packageFile} has no version field`);
  }
  return version;
}

/**
 * Rewrites `info.version` in place, touching only that one line so the rest of
 * the contract file keeps its original formatting and comments.
 *
 * Returns the current version and the rewritten document. `content` is
 * unchanged when the version already matches.
 */
export function applyContractVersion(
  content: string,
  version: string,
): { current: string | undefined; content: string } {
  const lines = content.split("\n");
  let inInfo = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (/^info:\s*$/.test(line)) {
      inInfo = true;
      continue;
    }
    // A new top-level key ends the info block.
    if (inInfo && /^\S/.test(line)) break;
    if (!inInfo) continue;

    const match = /^(\s+)version:[ \t]*(.*)$/.exec(line);
    if (!match) continue;

    const current = match[2]!.trim();
    if (current === version) return { current, content };
    lines[i] = `${match[1]}version: ${version}`;
    return { current, content: lines.join("\n") };
  }

  return { current: undefined, content };
}

export async function runVersionSync(
  contractFiles: string[],
  options: VersionSyncOptions = {},
): Promise<VersionSyncResult> {
  const packageFile = options.packageFile ?? "package.json";
  const version = await readPackageVersion(packageFile);
  const files: VersionSyncFile[] = [];

  for (const file of contractFiles) {
    const filePath = resolve(file);
    let original: string;
    try {
      original = await readFile(filePath, "utf-8");
    } catch (err) {
      throw new VersionSyncError(
        `Cannot read contract file ${file}: ${(err as Error).message}`,
      );
    }

    const { current, content } = applyContractVersion(original, version);
    if (current === undefined) {
      throw new VersionSyncError(
        `${file} has no info.version to synchronize`,
      );
    }

    const inSync = current === version;
    if (!inSync && !options.check) {
      await writeFile(filePath, content, "utf-8");
    }

    files.push({
      file,
      contractVersion: current,
      packageVersion: version,
      status: inSync ? "in-sync" : options.check ? "out-of-sync" : "updated",
    });
  }

  return {
    packageVersion: version,
    checked: options.check === true,
    inSync: files.every((f) => f.status === "in-sync"),
    files,
  };
}
