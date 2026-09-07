/**
 * Browser-safe ERC-8183 SDK surface for the T5 composition.
 *
 * Keep this subpath intentionally small: importing the package root also
 * exposes PostgreSQL/node persistence helpers, while a browser only needs
 * the public Altana high-level actions and their opaque Wallet/Signer types.
 */
export {
  BNB_TESTNET,
  createClient,
  hireErc8183Agent,
  settleErc8183Job
} from "@altananetwork/sdk";
export type {
  ExecuteResult,
  HireAgentParams,
  HireAgentResult,
  Signer,
  Wallet
} from "@altananetwork/sdk";
