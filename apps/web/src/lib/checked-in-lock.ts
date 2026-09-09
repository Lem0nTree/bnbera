import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Local deployment artifact only; no request or environment-selected lock. */
export function readCheckedInStandardsLock(): unknown {
  // A native pathname also works in production Turbopack, whose URL shim is
  // not accepted by Node's filesystem API. Match the existing Creator loader.
  const path=["config/standards.lock.json","../config/standards.lock.json","../../config/standards.lock.json"]
    .map(relative=>resolve(process.cwd(),relative)).find(candidate=>existsSync(candidate));
  if(!path)throw new Error("STANDARDS_LOCK_UNAVAILABLE");
  return JSON.parse(readFileSync(path,"utf8")) as unknown;
}
