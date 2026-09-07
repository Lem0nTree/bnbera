/** The browser only receives exact WalletConnect EOA calls from the server. */
export {
  ERC8183_EOA_CHAIN_ID,
  ERC8183_EOA_CONTRACTS,
  ERC8183_EOA_MAX_BUDGET_ATOMIC,
  buildErc8183EoaCall,
  erc8183EoaSteps
} from "./eoa.js";
export type {
  Erc8183EoaCall,
  Erc8183EoaCallInput,
  Erc8183EoaContracts,
  Erc8183EoaStep
} from "./eoa.js";
