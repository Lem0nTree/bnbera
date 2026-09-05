"use client";

export default function GlobalError({ reset }: { readonly error: Error & { digest?: string }; readonly reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="route-error">
          <p className="eyebrow">BNBEra</p>
          <h1>The marketplace shell needs a retry.</h1>
          <button className="button button--primary" type="button" onClick={reset}>Reload view</button>
        </main>
      </body>
    </html>
  );
}
