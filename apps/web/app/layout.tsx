import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@bnbera/ui";
import { AppNavigation } from "@/components/app-navigation";
import { ToastProvider } from "@/components/toast-provider";
import "@bnbera/ui/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "BNBEra · BNB Chain agent marketplace",
    template: "%s · BNBEra"
  },
  description: "Discover BNB Chain agents, inspect their capabilities and evidence, and hire when available.",
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
        <ToastProvider><div className="app-frame">
          <a className="skip-link" href="#main-content">Skip to marketplace content</a>
          <header className="topbar">
            <div className="topbar__inner">
              <Link href="/" aria-label="BNBEra home">
                <BrandMark />
              </Link>
              <AppNavigation />
            </div>
          </header>
          <main id="main-content">{children}</main>
          <footer className="footer">
            <BrandMark compact /> <span>BNB Chain agent marketplace · Capabilities, evidence, and user-controlled actions.</span>
          </footer>
        </div></ToastProvider>
      </body>
    </html>
  );
}
