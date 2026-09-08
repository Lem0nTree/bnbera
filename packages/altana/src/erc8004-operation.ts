import { encodeFunctionData, toFunctionSelector } from "viem";
import { AltanaBoundaryError } from "./errors.ts";
import type { ActionRequest, Address, ScopedPolicy } from "./types.ts";

export const ERC8004_SET_AGENT_URI_SIGNATURE = "setAgentURI(uint256,string)";
export const ERC8004_SET_AGENT_URI_SELECTOR = toFunctionSelector(ERC8004_SET_AGENT_URI_SIGNATURE);

const identityRegistryAbi = [{ type: "function", name: "setAgentURI", stateMutability: "nonpayable", inputs: [{ name: "agentId", type: "uint256" }, { name: "agentURI", type: "string" }], outputs: [] }] as const;

/** Bind selector-only Altana permission to the Creator's exact identity and reviewed URI. */
export function buildCreatedAgentUriUpdate(input: { readonly policy: ScopedPolicy; readonly identityRegistry: Address; readonly agentId: bigint; readonly approvedUri: string }): { readonly request: ActionRequest; readonly calldata: `0x${string}` } {
  if (input.policy.chainId !== 97 || input.agentId < 0n || input.approvedUri.length === 0 || input.approvedUri.length > 2048) throw new AltanaBoundaryError("CALL_NOT_ALLOWED", "Created-agent URI update is invalid.");
  const allowed = input.policy.calls.some(call => call.target.toLowerCase() === input.identityRegistry.toLowerCase() && call.selectors.map(String).includes(ERC8004_SET_AGENT_URI_SELECTOR));
  if (!allowed) throw new AltanaBoundaryError("CALL_NOT_ALLOWED", "Authority does not allow the ERC-8004 URI update selector.");
  const calldata = encodeFunctionData({ abi: identityRegistryAbi, functionName: "setAgentURI", args: [input.agentId, input.approvedUri] });
  return { calldata, request: { target: input.identityRegistry, selector: ERC8004_SET_AGENT_URI_SELECTOR, valueWei: 0n, spends: [{ token: "native", amountAtomic: 0n, period: "day" }] } };
}
