import { z } from "zod";

const maxUint256 = (1n << 256n) - 1n;

export const evmAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Expected a 20-byte EVM address");

export const transactionHashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Expected a 32-byte transaction hash");

export const contentDigestSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, "Expected a 32-byte hexadecimal digest");

export const chainIdSchema = z
  .number()
  .int()
  .positive()
  .max(2_147_483_647, "Chain IDs must fit a signed 32-bit database integer");

export const erc8004IdentitySchema = z.object({
  namespace: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._-]+$/, "Namespace contains unsupported characters"),
  chainId: chainIdSchema,
  identityRegistry: evmAddressSchema,
  // ERC-8004 agent IDs are uint256 values. Keep them as decimal strings so
  // JavaScript number precision can never truncate the identity key.
  agentId: z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/, "Agent ID must be a decimal uint256 string")
    .refine((value) => BigInt(value) <= maxUint256, "Agent ID exceeds uint256")
});

export type Erc8004Identity = z.infer<typeof erc8004IdentitySchema>;

export const erc8004IdentityObservationSchema = erc8004IdentitySchema.extend({
  ownerAddress: evmAddressSchema.nullable(),
  agentWallet: evmAddressSchema.nullable(),
  agentUri: z.string().url().nullable(),
  observedBlock: z.number().int().nonnegative().nullable()
});

export type Erc8004IdentityObservation = z.infer<typeof erc8004IdentityObservationSchema>;

export function normalizeEvmAddress(address: string): string {
  return evmAddressSchema.parse(address).toLowerCase();
}

export function normalizeErc8004Identity(input: unknown): Erc8004Identity {
  const identity = erc8004IdentitySchema.parse(input);
  return {
    ...identity,
    namespace: identity.namespace.trim(),
    identityRegistry: normalizeEvmAddress(identity.identityRegistry),
    agentId: identity.agentId
  };
}

export function erc8004IdentityKey(input: Erc8004Identity): string {
  const identity = normalizeErc8004Identity(input);
  return [
    identity.namespace,
    identity.chainId.toString(10),
    identity.identityRegistry,
    identity.agentId
  ].join(":");
}

export function sameErc8004Identity(a: Erc8004Identity, b: Erc8004Identity): boolean {
  return erc8004IdentityKey(a) === erc8004IdentityKey(b);
}
