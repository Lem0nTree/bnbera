import bundledStandardsLock from "../../../../config/standards.lock.json";

export const standardsLockUnavailableCode = "STANDARDS_LOCK_UNAVAILABLE" as const;
export const standardsLockInvalidCode = "STANDARDS_LOCK_INVALID" as const;

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
 * Parse a lock payload at a trusted build boundary. The production loader
 * below receives the checked-in JSON as a static module import, so runtime
 * cwd/module paths cannot replace the authoritative configuration.
 */
export function parseStandardsLockContent(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw lockLoadError(standardsLockInvalidCode, error);
  }
}

function trustedBundledStandardsLock(): unknown {
  if (typeof bundledStandardsLock !== "object" || bundledStandardsLock === null || Array.isArray(bundledStandardsLock)) {
    throw lockLoadError(standardsLockInvalidCode);
  }
  return bundledStandardsLock;
}

/**
 * Return the checked-in lock bundled by Next. Deliberately no cwd, URL or
 * filesystem lookup is accepted at runtime: those locations are untrusted
 * and must not be able to alter release gate decisions.
 */
export async function readStandardsLock(): Promise<unknown> {
  return trustedBundledStandardsLock();
}
