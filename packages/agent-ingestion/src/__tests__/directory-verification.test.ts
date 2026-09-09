import { describe,it,expect } from "vitest";
import { HttpServiceProbeTransport } from "../probe.js";
import { verifyDirectoryService } from "../directory-verification.js";
import { serviceVerificationState } from "../directory.js";
import { normalizedContentType } from "../metadata.js";
const lookup=async()=>[{address:"93.184.216.34",family:4}] as const;
const service={name:"MCP",url:"https://agent.example/mcp",version:"2025-11-25"};
describe("protocol-specific directory verification",()=>{
  it("accepts identical duplicated JSON MIME headers but rejects conflicting types",()=>{
    expect(normalizedContentType("application/json, application/json")).toBe("application/json");
    expect(normalizedContentType("application/json; charset=utf-8, application/json")).toBe("application/json");
    expect(normalizedContentType("application/json, text/html")).toBe("");
  });
  it("initializes, acknowledges and lists tools without invocation or leaked session headers",async()=>{
    const methods:string[]=[];
    const transport=new HttpServiceProbeTransport({lookup,fetch:async(_url,init)=>{
      const body=JSON.parse(String(init?.body));methods.push(body.method);
      const headers=new Headers(init?.headers);expect(headers.has("authorization")).toBe(false);
      if(body.method==="initialize")return Response.json({jsonrpc:"2.0",id:1,result:{protocolVersion:"2025-11-25",serverInfo:{name:"Reference MCP",version:"1"},capabilities:{tools:{}}}},{headers:{"mcp-session-id":"ephemeral-private-session"}});
      expect(headers.get("mcp-session-id")).toBe("ephemeral-private-session");
      expect(headers.get("mcp-protocol-version")).toBe("2025-11-25");
      if(body.method==="notifications/initialized")return new Response(null,{status:202});
      return Response.json({jsonrpc:"2.0",id:2,result:{tools:[{name:"read_status",inputSchema:{type:"object"}}]}});
    }});
    const result=await verifyDirectoryService(service,transport);
    expect(methods).toEqual(["initialize","notifications/initialized","tools/list"]);
    expect(result).toMatchObject({protocol:"mcp",status:"verified",capabilityCount:1,capabilityNames:["read_status"],evidence:"handshake-and-list"});
    expect(JSON.stringify(result)).not.toContain("ephemeral-private-session");
    expect(serviceVerificationState(result,Date.parse(result.checkedAt!)+120001)).toBe("stale");
  });
  it("accepts matching JSON-RPC SSE events and closes the stream",async()=>{
    let cancelled=false;
    const transport=new HttpServiceProbeTransport({lookup,fetch:async(_url,init)=>{
      const body=JSON.parse(String(init?.body));
      if(body.method==="notifications/initialized")return new Response(null,{status:202});
      const bytes=new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({jsonrpc:"2.0",id:1,result:{protocolVersion:"2025-06-18",serverInfo:{name:"Example",version:"1"},capabilities:{}}})}\n\n`);
      return new Response(new ReadableStream({start(c){c.enqueue(bytes)},cancel(){cancelled=true}}),{headers:{"content-type":"text/event-stream"}});
    }});
    expect(await verifyDirectoryService(service,transport)).toMatchObject({status:"verified",protocolVersion:"2025-06-18",capabilityCount:0});
    expect(cancelled).toBe(true);
  });
  it.each([401,403])("reports authentication required for HTTP%s without trying a secret",async(status)=>{
    const transport=new HttpServiceProbeTransport({lookup,fetch:async()=>new Response(null,{status})});
    expect(await verifyDirectoryService(service,transport)).toMatchObject({status:"auth_required",reason:"SERVICE_AUTH_REQUIRED"});
  });
  it("rejects mismatched response IDs and malformed capability schemas",async()=>{
    const transport=new HttpServiceProbeTransport({lookup,fetch:async()=>Response.json({jsonrpc:"2.0",id:999,result:{}})});
    expect(await verifyDirectoryService(service,transport)).toMatchObject({status:"invalid",reason:"SERVICE_MCP_CONTRACT_INVALID"});
  });
  it("separates a reachable website from a valid A2A card",async()=>{
    const transport=new HttpServiceProbeTransport({lookup,fetch:async()=>new Response("<html>Website</html>",{headers:{"content-type":"text/html"}})});
    expect(await verifyDirectoryService({...service,name:"web"},transport)).toMatchObject({status:"reachable",evidence:"http-availability"});
    expect(await verifyDirectoryService({...service,name:"a2a"},transport)).toMatchObject({status:"invalid",reason:"SERVICE_MIME_UNSUPPORTED"});
  });
  it("never fetches unknown protocols or private MCP targets",async()=>{
    let calls=0;const transport=new HttpServiceProbeTransport({lookup:async()=>[{address:"127.0.0.1",family:4}],fetch:async()=>{calls++;return Response.json({})}});
    expect(await verifyDirectoryService({...service,name:"email"},transport)).toMatchObject({status:"advertised",checkedAt:null});
    expect(await verifyDirectoryService(service,transport)).toMatchObject({status:"invalid",reason:"SERVICE_SSRF_BLOCKED"});expect(calls).toBe(0);
  });
});
