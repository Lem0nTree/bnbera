import type { CreatorAuthorityGateway, RuntimeSessionSecretSink } from "@bnbera/altana";
import { createAltanaChainAuthorityGateway } from "./creator-altana-gateway";
import { LocalCreatorStudioSecretSink } from "./creator-local-secret";

export type CreatorAuthorityComposition = {
  readonly gateway: CreatorAuthorityGateway;
  readonly sink: RuntimeSessionSecretSink;
};

/** Compose only the local MVP adapters; managed/cloud sinks are separate T6 work. */
export function createLocalCreatorAuthorityComposition(input: { readonly workspaceRoot: string }): CreatorAuthorityComposition {
  return {
    gateway: createAltanaChainAuthorityGateway(),
    sink: new LocalCreatorStudioSecretSink({ workspaceRoot: input.workspaceRoot }),
  };
}
