"use client";

import { Callout } from "@bnbera/ui";

export default function RouteError({ reset }: { readonly error: Error & { digest?: string }; readonly reset: () => void }) {
  return (
    <div className="route-error">
      <p className="eyebrow">Route boundary</p>
      <h1>BNBEra could not render this view.</h1>
      <Callout title="Unexpected UI error" tone="danger" icon="!">
        The read model and its error envelope are kept separate from this route boundary. Retry the view or return to public browse.
      </Callout>
      <div className="detail-actions">
        <button className="button button--primary" type="button" onClick={reset}>Try again</button>
        <a className="button button--ghost" href="/marketplace">Back to marketplace</a>
      </div>
    </div>
  );
}
