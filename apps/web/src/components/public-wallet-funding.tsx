import React, { type RefObject } from "react";

export type WalletAddressCopyState = "idle" | "copying" | "copied" | "manual";

type PublicWalletFundingProps = {
  readonly identifier: string;
  readonly walletAddress: string;
  readonly copyState: WalletAddressCopyState;
  readonly addressInputRef?: RefObject<HTMLInputElement | null>;
  readonly onCopy: () => void;
};

function copyStatus(copyState: WalletAddressCopyState): string {
  if (copyState === "copying") return "Copying the public wallet address…";
  if (copyState === "copied") return "Public wallet address copied.";
  if (copyState === "manual") return "Clipboard access was unavailable. The address is selected; press Ctrl+C or Cmd+C to copy it.";
  return "";
}

/**
 * Shows only the public address needed to fund a newly-created wallet. The
 * read-only input also provides a manual-copy path when browser clipboard
 * permissions are unavailable.
 */
export function PublicWalletFunding({
  identifier,
  walletAddress,
  copyState,
  addressInputRef,
  onCopy
}: PublicWalletFundingProps) {
  const addressId = `${identifier}-public-wallet-address`;
  const helpId = `${identifier}-wallet-funding-help`;
  const statusId = `${identifier}-wallet-address-copy-status`;
  const status = copyStatus(copyState);

  return (
    <section className="commerce-journey__wallet-funding" aria-labelledby={`${identifier}-wallet-funding-title`}>
      <p className="eyebrow" id={`${identifier}-wallet-funding-title`}>Public wallet address</p>
      <div className="commerce-journey__wallet-address">
        <label className="sr-only" htmlFor={addressId}>Public wallet address</label>
        <input
          ref={addressInputRef}
          id={addressId}
          type="text"
          value={walletAddress}
          readOnly
          spellCheck={false}
          aria-describedby={helpId}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          className="button button--ghost button--small"
          type="button"
          disabled={copyState === "copying"}
          aria-label="Copy public wallet address"
          aria-describedby={helpId}
          onClick={onCopy}
        >
          {copyState === "copied" ? "Copied" : "Copy address"}
        </button>
      </div>
      <p className="commerce-journey__wallet-funding-help" id={helpId}>
        Fund this public address with a small amount of BNB testnet gas and U testnet funds before activating. If clipboard copy is unavailable, focus the address and press Ctrl+C or Cmd+C.
      </p>
      <p className="commerce-journey__wallet-copy-status" id={statusId} role="status" aria-live="polite" aria-atomic="true">
        {status}
      </p>
    </section>
  );
}
