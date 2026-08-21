import type { Metadata, Viewport } from "next";
import Link from "next/link";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import MobileNav from "@/components/MobileNav";
import Sidebar from "@/components/Sidebar";
import { getSessionUser, isAdmin } from "@/lib/auth";
import "./globals.css";
import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.brown.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";
import "./chessground-overrides.css";

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
        {user ? (
          <div className="flex min-h-screen">
            <Sidebar siteName={SITE_NAME} credits={user.credits} isAdmin={isAdminUser} />
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur sm:hidden">
                <div className="relative flex items-center justify-between px-4 py-3">
                  <Link href="/dashboard" className="flex items-center gap-2 text-lg font-bold text-slate-900">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 text-sm font-bold text-white">
                      ♞
                    </span>
                    {SITE_NAME}
                  </Link>
                  <div className="flex items-center gap-2">
                    <span className="badge-emerald">⚡ {user.credits}</span>
                    <MobileNav
                      loggedIn
                      isAdmin={isAdminUser}
                      credits={user.credits}
                      siteName={SITE_NAME}
                    />
                  </div>
                </div>
              </header>
              <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
                {children}
              </main>
              <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-400">
                <span className="mr-1">♞</span>
                {SITE_NAME} · Built for parents of young chess players ·{" "}
                <Link href="/privacy" className="underline hover:text-slate-600">
                  Privacy
                </Link>
                {" · "}
                <Link href="/faq" className="underline hover:text-slate-600">
                  FAQ
                </Link>
              </footer>
            </div>
          </div>
        ) : (
          <>
            <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur">
              <nav className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
                <Link href="/" className="flex items-center gap-2 text-lg font-bold text-slate-900">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 text-base font-bold text-white">
                    ♞
                  </span>
                  {SITE_NAME}
                </Link>
                <Link href="/login" className="btn btn-primary">
                  Log in
                </Link>
              </nav>
            </header>
            <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">{children}</main>
            <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-400">
              <span className="mr-1">♞</span>
              {SITE_NAME} · Built for parents of young chess players ·{" "}
              <Link href="/privacy" className="underline hover:text-slate-600">
                Privacy
              </Link>
              {" · "}
              <Link href="/faq" className="underline hover:text-slate-600">
                FAQ
              </Link>
            </footer>
          </>
        )}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
