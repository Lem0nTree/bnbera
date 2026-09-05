import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const standardsLockRelativePath = join("config", "standards.lock.json");
const maxAncestorSearchDepth = 12;

export const standardsLockUnavailableCode = "STANDARDS_LOCK_UNAVAILABLE" as const;
export const standardsLockInvalidCode = "STANDARDS_LOCK_INVALID" as const;

export type StandardsLockLocationOptions = {
  readonly cwd?: string;
  readonly moduleUrl?: string | URL;
};

function moduleDirectory(moduleUrl: string | URL): string | null {
  try {
    if (typeof moduleUrl === "string" && !moduleUrl.startsWith("file:")) {
      return dirname(isAbsolute(moduleUrl) ? moduleUrl : resolve(moduleUrl));
    }
    return dirname(fileURLToPath(moduleUrl));
  } catch {
    return null;
  }
}

function ancestorDirectories(start: string): readonly string[] {
  const directories: string[] = [];
  let current = resolve(start);
  for (let depth = 0; depth <= maxAncestorSearchDepth; depth += 1) {
    directories.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories;
}

/**
 * Return bounded candidates for the checked-in lock file.
 *
 * Next may execute this module from a generated `.next`/standalone chunk,
 * while development runs from the source tree. Searching from both the
 * process cwd and the module directory handles either layout without relying
 * on the source-file relative path surviving bundling.
 */
export function standardsLockCandidates(
  options: StandardsLockLocationOptions = {}
): readonly string[] {
  const starts = [
    options.cwd ?? process.cwd(),
    moduleDirectory(options.moduleUrl ?? import.meta.url)
  ];
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const start of starts) {
    if (start === null || start.trim() === "") continue;
    for (const directory of ancestorDirectories(start)) {
      const candidate = join(directory, standardsLockRelativePath);
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      candidates.push(candidate);
    }
  }
  return candidates;
}

function isMissingFile(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { readonly code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function lockLoadError(code: string, cause?: unknown): Error {
  const error = new Error(code);
  error.name = code;
  if (cause !== undefined) {
    Object.defineProperty(error, "cause", {
      configurable: true,
      enumerable: false,
      value: cause,
      writable: false
    });
  }
  return error;
}

/**
 * Read and parse the standards lock without exposing candidate paths or file
 * contents in the resulting error. The caller still performs the authoritative
 * semantic-lock validation after loading.
 */
export async function readStandardsLock(
  options: StandardsLockLocationOptions = {}
): Promise<unknown> {
  for (const candidate of standardsLockCandidates(options)) {
    let content: string;
    try {
      content = await readFile(candidate, "utf8");
    } catch (error) {
      if (isMissingFile(error)) continue;
      throw lockLoadError(standardsLockUnavailableCode, error);
    }
    try {
      return JSON.parse(content) as unknown;
    } catch (error) {
      throw lockLoadError(standardsLockInvalidCode, error);
    }
  }
  throw lockLoadError(standardsLockUnavailableCode);
}
