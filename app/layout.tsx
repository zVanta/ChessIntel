import type { Metadata, Viewport } from "next";
import Link from "next/link";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import LogoutButton from "@/components/LogoutButton";
import MobileNav from "@/components/MobileNav";
import { getSessionUser, isAdmin } from "@/lib/auth";
import "./globals.css";
import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.brown.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || "Checkmate Coach";

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} — automated coach reports for junior chess players`,
    template: `%s · ${SITE_NAME}`,
  },
  description:
    "Plain-language progress reports for your junior chess player, built from their own games.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#047857",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const user = getSessionUser();
  const isAdminUser = user ? isAdmin(user) : false;

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Source+Sans+3:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        <header className="relative border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <Link href={user ? "/dashboard" : "/"} className="text-lg font-bold text-slate-900">
              {SITE_NAME}
            </Link>
            <div className="hidden items-center gap-4 text-sm font-medium text-slate-600 sm:flex">
              {user ? (
                <>
                  <Link href="/analyze" className="hover:text-slate-900">
                    Analyze
                  </Link>
                  <Link href="/dashboard" className="hover:text-slate-900">
                    Dashboard
                  </Link>
                  <Link href="/reports" className="hover:text-slate-900">
                    Reports
                  </Link>
                  <Link href="/progress" className="hover:text-slate-900">
                    Progress
                  </Link>
                  <Link href="/train" className="hover:text-slate-900">
                    Train
                  </Link>
                  <Link href="/puzzles" className="hover:text-slate-900">
                    Puzzles
                  </Link>
                  <Link href="/profile" className="hover:text-slate-900">
                    Profile
                  </Link>
                  {isAdmin(user) && (
                    <Link href="/admin" className="font-semibold text-indigo-700 hover:text-indigo-900">
                      Admin
                    </Link>
                  )}
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                    ⚡ {user.credits}
                  </span>
                  <LogoutButton />
                </>
              ) : (
                <Link
                  href="/login"
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700"
                >
                  Log in
                </Link>
              )}
            </div>
            <MobileNav
              loggedIn={Boolean(user)}
              isAdmin={isAdminUser}
              credits={user?.credits ?? 0}
              siteName={SITE_NAME}
            />
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
        <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-400">
          {SITE_NAME} · Built for parents of young chess players ·{" "}
          <Link href="/privacy" className="underline">
            Privacy
          </Link>
        </footer>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
