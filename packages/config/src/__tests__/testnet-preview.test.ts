import { describe, expect, it } from "vitest";
import { testnetCommercePreviewEnabled } from "../runtime.js";
const env={BNBERA_ENV:"preview",NODE_ENV:"production",BSC_CHAIN_ID:"97",APP_URL:"https://preview.example.org",T5_COMMERCE_TESTNET_PREVIEW_ENABLED:"true",T5_WALLETCONNECT_AUTH_ENABLED:"true",T5_COMMERCE_LOCAL_ACTIVATION:"true",T5_COMMERCE_DEVELOPMENT_CANARY_ENABLED:"true"};
describe("explicit testnet preview gate",()=>{
  it("allows an explicitly enabled HTTPS testnet production artifact",()=>expect(testnetCommercePreviewEnabled(env)).toBe(true));
  it.each([{BNBERA_ENV:"production"},{BNBERA_ENV:"development"},{BSC_CHAIN_ID:"56"},{APP_URL:"http://preview.example.org"},{APP_URL:"https://user:pass@preview.example.org"},{T5_COMMERCE_TESTNET_PREVIEW_ENABLED:"false"},{T5_WALLETCONNECT_AUTH_ENABLED:"false"},{T5_COMMERCE_LOCAL_ACTIVATION:"false"},{T5_COMMERCE_DEVELOPMENT_CANARY_ENABLED:"false"}])("fails closed for %j",patch=>expect(testnetCommercePreviewEnabled({...env,...patch})).toBe(false));
});
