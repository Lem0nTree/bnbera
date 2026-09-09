"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function AppNavigation() {
  const pathname = usePathname();
  return <nav className="main-nav" aria-label="Primary navigation">
    {[["/marketplace", "Marketplace"], ["/hired", "Hired agents"], ["/creator", "My agents"], ["/create", "Create agent"]].map(([href, label]) =>
      <Link key={href} href={href!} aria-current={pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined}>{label}</Link>
    )}
  </nav>;
}
