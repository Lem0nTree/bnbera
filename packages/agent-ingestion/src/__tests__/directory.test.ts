import { buildDirectorySemanticDocument } from "../directory-semantic.js";
import { describe, expect, it } from "vitest";
import { directorySlug, normalizeDirectorySnapshot, publicHttpsUrl } from "../directory.js";
import { normalizeNullableForRegistryRead } from "../registry-values.js";

const raw={chain_id:56,contract_address:"0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",token_id:"341628",name:"IVL Rebalancer",description:"Advertised service",total_score:12.09,total_feedbacks:0,average_score:0};
describe("registered directory evidence",()=>{
  it("reuses embeddings across health and score refreshes, but changes them for skills or identity",()=>{
    const profile=normalizeDirectorySnapshot(raw,null,"2026-09-09T00:00:00.000Z");
    const first=buildDirectorySemanticDocument(profile);
    expect(buildDirectorySemanticDocument({...profile,fetchedAt:"2026-09-10T00:00:00.000Z",scores:{...profile.scores,overall:99},cardCheck:{...profile.cardCheck,status:"reachable"}}).digest).toBe(first.digest);
    expect(buildDirectorySemanticDocument({...profile,skills:[{id:"risk",name:"Risk analysis",description:"Analyse liquidation risk"}]}).digest).not.toBe(first.digest);
    expect(buildDirectorySemanticDocument({...profile,identity:{...profile.identity,chainId:97}}).digest).not.toBe(first.digest);
  });
  it("keeps missing observations unknown and vendor score separate from reviews",()=>{
    const profile=normalizeDirectorySnapshot(raw,null,"2026-09-09T00:00:00.000Z");
    expect(profile.scores.overall).toBe(12.09);
    expect(profile.feedback).toEqual({count:0,average:null,items:[]});
    expect(profile.cardCheck).toMatchObject({status:"unprobed",observedAt:null});
    expect(profile.skills).toEqual([]);
    expect(profile.stats.views).toBeNull();
  });
  it("keeps chain identity in every slug and source link",()=>{
    const mainnet=normalizeDirectorySnapshot(raw,null);
    const testnet=normalizeDirectorySnapshot({...raw,chain_id:97},null);
    expect(directorySlug(mainnet)).toBe("ivl-rebalancer-56-341628");
    expect(directorySlug(testnet)).toBe("ivl-rebalancer-97-341628");
    expect(testnet.sourceUrl).toContain("/bsc-testnet/341628");
  });
  it("allows only public HTTPS links without credential-bearing parameters",()=>{
    for(const uri of ["http://example.com","https://localhost/a","https://127.0.0.1/a","https://user:pass@example.com","https://example.com?api_key=private","javascript:alert(1)"]) expect(publicHttpsUrl(uri)).toBeNull();
    expect(publicHttpsUrl("https://agents.example/a2a.json")).toBe("https://agents.example/a2a.json");
    const profile=normalizeDirectorySnapshot(raw,{services:[{name:"A2A",endpoint:"https://agent.example/card"},{name:"Secret",endpoint:"https://agent.example?token=private"}]});
    expect(profile.services).toEqual([{name:"A2A",url:"https://agent.example/card",version:null}]);
  });
  it("rejects identity mismatches and out-of-range scores",()=>{
    expect(()=>normalizeDirectorySnapshot({...raw,contract_address:"invalid"},null)).toThrow();
    expect(normalizeDirectorySnapshot({...raw,total_score:999},null).scores.overall).toBeNull();
  });
  it("accepts bounded inline registrations larger than web URLs",()=>{
    const uri=`data:application/json;base64,${Buffer.from(JSON.stringify({description:"x".repeat(4000)})).toString("base64")}`;
    expect(normalizeNullableForRegistryRead(uri)).toBe(uri);
    expect(()=>normalizeNullableForRegistryRead(`https://example.com/${"x".repeat(3000)}`)).toThrow();
    expect(()=>normalizeNullableForRegistryRead(`data:application/json,${"x".repeat(1_500_000)}`)).toThrow();
  });
});
