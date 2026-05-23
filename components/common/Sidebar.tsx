"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/wallets", label: "Wallets" },
  { href: "/tokens", label: "Tokens" },
  { href: "/actions", label: "Actions" },
  { href: "/logs", label: "Logs" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <nav className="w-48 border-r border-slate-800 p-4 space-y-1">
      {NAV.map((n) => (
        <Link key={n.href} href={n.href} className={`block px-3 py-2 rounded ${path === n.href ? "bg-slate-800" : "hover:bg-slate-900"}`}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
