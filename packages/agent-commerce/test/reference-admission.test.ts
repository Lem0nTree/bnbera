import { describe,expect,it } from "vitest";
import { REFERENCE_ALLOWANCE as P,REFERENCE_ALLOWANCE_DIGEST,readReferenceCapacity,reserveReferenceCapacity } from "../src/reference-admission.js";
import type { Erc8183OperationQueryClient } from "../src/operations.js";
function database(patch:Record<string,unknown>={}) {
  const statements:string[]=[];
  const row={config_digest:REFERENCE_ALLOWANCE_DIGEST,enabled:true,healthy:true,heartbeat:new Date(),reason:"READY",admitted:"0",submitted:"0",completed:"0",reserved:"0",...patch};
  const db={query:async (sql:string)=>{statements.push(sql);return{rows:sql.includes("SELECT a.*")?[row]:[]}}} as unknown as Erc8183OperationQueryClient;
  return {db,statements};
}
const quote={quoteId:"unused",identity:{namespace:"eip155",chainId:97,identityRegistry:P.registry,agentId:P.agentId},chainId:97,agentVersionId:P.versionId,agentVersion:P.version,providerAddress:P.provider,commerceContract:P.commerce,paymentToken:P.token,paymentDecimals:18,priceAtomic:P.price,service:{url:P.card}};
describe("durable bounded reference admission",()=>{
  it("has exactly three slots and coherent worst-case gas budget",()=>{expect(P.maxJobs).toBe(3);expect(BigInt(P.gasLimit)*BigInt(P.gasPrice)).toBe(BigInt(P.gasReservation));expect(BigInt(P.gasReservation)*3n).toBe(BigInt(P.gasBudget))});
  it("reports fresh healthy capacity",async()=>{expect(await readReferenceCapacity(database().db)).toMatchObject({ready:true,remaining:3,reason:"READY"})});
  it("preserves consumed lifetime slots after the reviewed publication binding",async()=>{expect(P.version).toBe(4);expect(P.versionId).toBe("a394ad86-02de-5d21-8602-96f954fc679b");expect(await readReferenceCapacity(database({admitted:"1",reserved:P.gasReservation}).db)).toMatchObject({remaining:2});for(const version of [2,3])await expect(reserveReferenceCapacity(database().db,{...quote,agentVersion:version})).rejects.toMatchObject({code:"COMMERCE_DISABLED"})});
  it.each([{heartbeat:new Date(Date.now()-21_000),expected:"WORKER_STALE"},{healthy:false,reason:"RPC_UNAVAILABLE",expected:"RPC_UNAVAILABLE"},{enabled:false,expected:"ADMISSION_DISABLED"},{admitted:"3",reserved:P.gasBudget,expected:"CAPACITY_EXHAUSTED"},{config_digest:"changed",expected:"CONFIGURATION_MISMATCH"}])("fails closed: $expected",async({expected,...patch})=>{expect(await readReferenceCapacity(database(patch).db)).toMatchObject({ready:false,reason:expected})});
  it("locks capacity inside the quote transaction before durable reservation",async()=>{const {db,statements}=database();await reserveReferenceCapacity(db,quote);expect(statements[0]).toContain("pg_advisory_xact_lock");expect(statements.at(-1)).toContain("INSERT INTO reference_provider_slots")});
  it.each([{chainId:56},{priceAtomic:"2000000000000000"},{agentVersionId:"other"},{providerAddress:P.owner},{paymentToken:P.commerce},{service:{url:"https://example.com"}}])("never admits changed exact terms %j",async patch=>{const{db,statements}=database();await expect(reserveReferenceCapacity(db,{...quote,...patch})).rejects.toMatchObject({code:"COMMERCE_DISABLED"});expect(statements).toHaveLength(0)});
  it("does not recycle abandoned or completed reservations",async()=>{const{db,statements}=database({admitted:"3",completed:"1",reserved:P.gasBudget});await expect(reserveReferenceCapacity(db,quote)).rejects.toMatchObject({code:"COMMERCE_DISABLED"});expect(statements.some(sql=>sql.startsWith("INSERT"))).toBe(false)});
});
