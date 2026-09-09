import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const read=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/marketplace-server",()=>({readMarketplaceAgentApi:read}));
import { POST } from "./route";
const params={params:Promise.resolve({slug:"sample-56-1"})};
function request(body:unknown,origin="http://localhost"){return new Request("http://localhost/api/marketplace/sample-56-1/ask",{method:"POST",headers:{origin,host:"localhost","Content-Type":"application/json"},body:JSON.stringify(body)});}
beforeEach(()=>{vi.stubEnv("CHEAPERINFERENCE_API_KEY","test-server-only");read.mockReset();});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("bounded read-only profile assistant",()=>{
  it("rejects cross-origin and malformed origins without a provider call",async()=>{
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    expect((await POST(request({question:"What can it do?"},"https://elsewhere.example"),params)).status).toBe(403);
    expect((await POST(request({question:"What can it do?"},"invalid"),params)).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects oversized questions and request streams",async()=>{
    expect((await POST(request({question:"a".repeat(601)}),params)).status).toBe(400);
    expect((await POST(request({question:"a".repeat(5000)}),params)).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });
  it("fails closed when inference is not configured",async()=>{
    vi.stubEnv("CHEAPERINFERENCE_API_KEY","");
    expect((await POST(request({question:"What can it do?"}),params)).status).toBe(503);
  });
  it("passes an allowlisted public profile and returns only answer attribution",async()=>{
    read.mockResolvedValue({agent:{name:"Sample",description:"Advertised service",identity:{chainId:56,agentId:"1"},dataProvenance:{identityRead:{readConsistency:"finalized",observedBlock:123}},directory:{services:[],skills:[],scores:{overall:12},feedback:{count:0},cardCheck:{status:"unprobed"},registration:{status:"unavailable"},sourceUrl:"https://8004scan.io/agents/bsc/1"},activation:{enabled:false},metrics:{completedJobs:{completedCount:0},reputation:{verifiedReviews:[]}},privateField:"must-not-leave-server"}});
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:"The profile advertises a service. Execution is unverified."}}]}),{status:200}));vi.stubGlobal("fetch",fetcher);
    const response=await POST(request({question:"What can it do?"}),params);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({model:"deepseek-v4-flash-0731",answer:expect.stringContaining("unverified")});
    const call=fetcher.mock.calls[0];
    expect(call?.[0]).toBe("https://api.cheaperinference.com/v1/chat/completions");
    expect(call?.[1].body).not.toContain("must-not-leave-server");
    expect(call?.[1].body).not.toContain("test-server-only");
    expect(JSON.parse(call?.[1].body).max_tokens).toBe(500);
    expect(JSON.parse(call?.[1].body).thinking).toEqual({type:"disabled"});
    const context=JSON.parse(JSON.parse(call?.[1].body).messages[1].content).publicProfile;
    expect(context.registryIdentity).toEqual({agentId:"1",consistency:"finalized",observedBlock:123});
    expect(context.metadataResolution).toBe("unavailable");
    expect(context.registration).toBeUndefined();
  });
});
