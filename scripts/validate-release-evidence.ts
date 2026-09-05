import { fileURLToPath } from "node:url";
import { validateReleaseEvidenceDirectory } from "../packages/evidence/src/release-evidence.ts";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const report = await validateReleaseEvidenceDirectory(rootDir);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.valid) process.exitCode = 1;
