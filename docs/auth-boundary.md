# BNBEra authentication boundary

The foundation exposes `@bnbera/auth` as a narrow integration boundary for
BetterAuth and SIWE. The package validates the application domain and chain,
the exact HTTP(S) URI audience, and bounded SIWE timestamps; delegates
cryptographic signature verification to the version-pinned BetterAuth/SIWE
adapter; atomically consumes a server-issued nonce; and exposes owner/session
assertions for downstream routes. Expiration is required, issued-at freshness
is bounded, and replay or unavailable nonce storage fails closed.

Callers must pass an application verification context containing the expected
domain, URI, and chain ID. `NonceStore.consume` must be an atomic persistent
check-and-mark operation; an in-memory set is suitable only for tests. The
`SiweVerifier` interface is a concrete adapter boundary: production wiring
must perform real SIWE signature verification and return the signed address,
chain, issued-at, and expiration values. The foundation does not claim to
implement that cryptographic adapter.

The implementation intentionally does not persist authentication cookie values,
wallet private keys, passkey exports, Altana administrative keys, or serialized
runtime sessions. A future persistence adapter stores only a one-way cookie
token digest and the non-secret session fields needed for expiry and ownership
checks. BetterAuth schema adoption must preserve this boundary and be reviewed
against the standards lock before merging.

The connected EOA proves ownership for BNBEra account and claim actions. It is
not automatically the ERC-8004 `agentWallet`, the Altana smart wallet, or a
runtime signer; those are separate, explicitly verified concepts.

## Mainnet marketplace application boundary — September 9, 2026

The current web application now wires persistent nonce consumption and actual
EOA message verification. Authenticated cookie tokens are retained only as
one-way digests; the browser cookie is Secure, HttpOnly and SameSite=Strict.
Chain-56 buyer login requires the explicit mainnet HTTPS runtime gate. It does
not enable Creator authority, a server signer or arbitrary chain/token access.

Auth and commerce JSON mutations also enforce request-origin checks, including
same-site sibling subdomains, and bounded JSON bodies. SameSite alone is not
the CSRF boundary. Logout checks origin without requiring a JSON body. A trusted
production reverse proxy must preserve the public Host/protocol correctly;
untrusted forwarding headers must not select the audience. Read-only RPC and
existing-job dispute/refund reconciliation remain independent of the separate
checked-in new-hire release flag.
