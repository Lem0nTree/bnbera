/**
 * Build the exact EIP-4361 message used by the browser and the server.
 *
 * This is intentionally a small, dependency-free formatter so the client
 * does not import the server-only auth package (which also contains WebAuthn
 * verification code). The server verifies that the submitted message is
 * byte-for-byte equal to this representation before checking its signature.
 */
export type SiweMessageFields = {
  readonly domain: string;
  readonly address: string;
  readonly statement?: string;
  readonly uri: string;
  readonly version?: string;
  readonly chainId: number;
  readonly nonce: string;
  readonly issuedAt: Date | string;
  readonly expirationTime: Date | string;
  readonly notBefore?: Date | string;
  readonly requestId?: string;
  readonly resources?: readonly string[];
};

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Return an EIP-4361 message suitable for `personal_sign`/`signMessage`. */
export function formatSiweMessage(input: SiweMessageFields): string {
  const version = input.version ?? "1";
  const header = `${input.domain} wants you to sign in with your Ethereum account:`;
  const statement = input.statement === undefined ? "" : `${input.statement}\n\n`;
  const fields = [
    `URI: ${input.uri}`,
    `Version: ${version}`,
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${timestamp(input.issuedAt)}`,
    `Expiration Time: ${timestamp(input.expirationTime)}`
  ];
  if (input.notBefore !== undefined) fields.push(`Not Before: ${timestamp(input.notBefore)}`);
  if (input.requestId !== undefined) fields.push(`Request ID: ${input.requestId}`);
  if (input.resources !== undefined && input.resources.length > 0) {
    fields.push(["Resources:", ...input.resources.map((resource) => `- ${resource}`)].join("\n"));
  }

  return `${header}\n${input.address}\n\n${statement}${fields.join("\n")}`;
}
