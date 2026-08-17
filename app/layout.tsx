import type { Metadata, Viewport } from "next";
import Link from "next/link";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import "./globals.css";

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
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-bold text-slate-900">
              {SITE_NAME}
            </Link>
            <div className="flex items-center gap-4 text-sm font-medium text-slate-600">
              <Link href="/dashboard" className="hover:text-slate-900">
                Dashboard
              </Link>
              <Link href="/progress" className="hover:text-slate-900">
                Progress
              </Link>
              <Link
                href="/onboard"
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-white hover:bg-emerald-700"
              >
                Add player
              </Link>
            </div>
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
