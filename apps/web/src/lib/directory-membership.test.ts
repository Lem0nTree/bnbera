import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
describe("retained directory membership",()=>{
  it("requires active membership before projecting historical snapshots",()=>{
    const source=readFileSync(new URL("./marketplace-server.ts",import.meta.url),"utf8");
    const query=source.slice(source.indexOf("async function loadRegisteredDirectory()"),source.indexOf("const checks =",source.indexOf("async function loadRegisteredDirectory()")));
    expect(query).toContain("membership.identity_id=i.id");
    expect(query).toContain("membership.normalized_ingestion_version='bnbera-directory-v1'");
    expect(query).toContain("LIMIT 100");
    expect(query).not.toContain("DELETE");
  });
});
