import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark, StatusBadge } from "@bnbera/ui";
import "@bnbera/ui/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "BNBEra · Read the agent market",
    template: "%s · BNBEra"
  },
  description: "A read-only first marketplace for discovering, comparing, and understanding BNB Chain agents.",
  applicationName: "BNBEra"
};

export const viewport: Viewport = {
  colorScheme: "dark",
  initialScale: 1,
  themeColor: "#0B0714",
  width: "device-width"
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-frame">
          <a className="skip-link" href="#main-content">Skip to marketplace content</a>
          <header className="topbar">
            <div className="topbar__inner">
              <Link href="/" aria-label="BNBEra home">
                <BrandMark />
              </Link>
              <nav className="main-nav" aria-label="Primary navigation">
                <Link href="/marketplace">Marketplace</Link>
                <Link href="/compare">Compare</Link>
              </nav>
              <div className="topbar__network">
                <span className="network-dot" aria-hidden="true" />
                BSC read-only preview
                <StatusBadge value="Core gate" tone="purple" />
              </div>
            </div>
          </header>
          <main id="main-content">{children}</main>
          <footer className="footer">
            <BrandMark compact /> <strong>BNBEra</strong> · public discovery with provenance in view · activation rails disabled until verified
          </footer>
        </div>
      </body>
    </html>
  );
}
