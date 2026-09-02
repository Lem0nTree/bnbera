import { normalizeManualImport } from "../normalize.js";
import type { IdentityCandidate, ManualIdentityImport } from "../types.js";

/** Manual imports never claim ownership or verification as a side effect. */
export class ManualImportAdapter {
  public normalize(input: ManualIdentityImport): IdentityCandidate {
    return normalizeManualImport(input);
  }
}
