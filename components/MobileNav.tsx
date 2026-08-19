"use client";

import { useState } from "react";
import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";

interface Props {
  loggedIn: boolean;
  isAdmin: boolean;
  credits: number;
  siteName: string;
}

export default function MobileNav({ loggedIn, isAdmin, credits, siteName }: Props) {
  const [open, setOpen] = useState(false);

  const links = loggedIn
    ? [
        { href: "/analyze", label: "Analyze" },
        { href: "/dashboard", label: "Dashboard" },
        { href: "/reports", label: "Reports" },
        { href: "/progress", label: "Progress" },
        { href: "/train", label: "Train" },
        { href: "/puzzles", label: "Puzzles" },
        { href: "/profile", label: "Profile" },
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
        <div className="absolute left-0 right-0 top-full z-50 border-b border-slate-200 bg-white px-4 py-3 shadow-lg">
          {loggedIn ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between pb-2">
                <span className="text-sm font-semibold text-slate-900">{siteName}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                  ⚡ {credits}
                </span>
              </div>
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-2 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  {link.label}
                </Link>
              ))}
              <div className="pt-2">
                <LogoutButton />
              </div>
            </div>
          ) : (
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="block rounded-md bg-emerald-600 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Log in
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
