import { describe, expect, it } from "vitest";
import { readCheckedInStandardsLock } from "./checked-in-lock";

describe("production standards-lock pathname",()=>{
  it("loads the authoritative local mainnet/testnet pins without URL shims",()=>{
    const lock=readCheckedInStandardsLock() as {networks:Record<string,{erc8183:{commerceProxy:string|null}}>};
    expect(lock.networks["56"]?.erc8183.commerceProxy).toBe("0xEa4DAa3100A767e86FDed867729ae7446476EBA6");
    expect(lock.networks["97"]?.erc8183.commerceProxy).toBe("0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de");
  });
});
