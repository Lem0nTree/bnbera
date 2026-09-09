import { describe, expect, it } from "vitest";
import { parseReferenceBuyerTask, referenceBuyerTaskSchema } from "../src/reference-task.js";
const task={schemaVersion:"bnbera.reference.health-factor.user-task/v1",collateralValueUsd:"2000",debtValueUsd:"1000",liquidationThresholdBps:8000,observedAtUnix:1788930000};
describe("buyer-attested reference task",()=>{
  it("preserves exact decimal inputs without claiming a chain position",()=>expect(parseReferenceBuyerTask(JSON.stringify(task))).toEqual(task));
  it.each([{debtValueUsd:"0"},{collateralValueUsd:"-2"},{liquidationThresholdBps:10001},{collateralValueUsd:"1e12"},{observedAtUnix:0},{providerAddress:"0x123"}])("rejects invalid or injected task fields %j",patch=>expect(referenceBuyerTaskSchema.safeParse({...task,...patch}).success).toBe(false));
});
