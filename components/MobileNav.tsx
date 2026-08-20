"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import LogoutButton from "@/components/LogoutButton";

interface Props {
  loggedIn: boolean;
  isAdmin: boolean;
  credits: number;
  siteName: string;
}

export default function MobileNav({ loggedIn, isAdmin, credits, siteName }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const links = loggedIn
    ? [
        { href: "/analyze", label: "Analyze" },
        { href: "/dashboard", label: "Dashboard" },
        { href: "/reports", label: "Reports" },
        { href: "/progress", label: "Progress" },
        { href: "/train", label: "Train" },
        { href: "/puzzles", label: "Puzzles" },
        { href: "/repertoire", label: "Repertoire" },
        { href: "/sparring", label: "Sparring" },
        { href: "/profile", label: "Profile" },
        { href: "/faq", label: "FAQ" },
        ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
      ]
    : [];

  return (
    <div className="sm:hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700"
        aria-label="Toggle menu"
        aria-expanded={open}
      >
        {open ? "✕ Close" : "☰ Menu"}
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 rounded-b-2xl border-b border-slate-200 bg-white px-4 py-3 shadow-xl">
          {loggedIn ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between pb-2">
                <span className="text-sm font-semibold text-slate-900">{siteName}</span>
                <span className="badge-emerald">⚡ {credits}</span>
              </div>
              {links.map((link) => {
                const active =
                  pathname === link.href ||
                  (link.href !== "/dashboard" && pathname.startsWith(link.href + "/"));
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className={
                      "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium " +
                      (active
                        ? "bg-emerald-50 text-emerald-800"
                        : "text-slate-700 hover:bg-slate-100")
                    }
                  >
                    {link.label}
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                  </Link>
                );
              })}
              <div className="pt-2">
                <LogoutButton />
              </div>
            </div>
          ) : (
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="block rounded-lg bg-emerald-600 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Log in
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
