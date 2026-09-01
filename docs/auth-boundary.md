# BNBEra authentication boundary

The foundation exposes `@bnbera/auth` as a narrow integration boundary for
BetterAuth and SIWE. The package validates the application domain and chain,
delegates signature verification to the version-pinned BetterAuth/SIWE adapter,
and exposes owner/session assertions for downstream routes.

The implementation intentionally does not persist authentication cookie values,
wallet private keys, passkey exports, Altana administrative keys, or serialized
runtime sessions. A future persistence adapter stores only a one-way cookie
token digest and the non-secret session fields needed for expiry and ownership
checks. BetterAuth schema adoption must preserve this boundary and be reviewed
against the standards lock before merging.

The connected EOA proves ownership for BNBEra account and claim actions. It is
not automatically the ERC-8004 `agentWallet`, the Altana smart wallet, or a
runtime signer; those are separate, explicitly verified concepts.
