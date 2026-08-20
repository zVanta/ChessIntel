import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-b from-emerald-50 to-white px-6 py-14 text-center sm:px-10 sm:py-20">
        <div className="pointer-events-none absolute -left-10 -top-10 h-48 w-48 rounded-full bg-emerald-100/50 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-16 -right-10 h-64 w-64 rounded-full bg-teal-100/40 blur-2xl" />
        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-700">
            ♞ Checkmate Coach
          </span>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            Turn your kid&apos;s games into a simple coaching plan.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
            We pull your junior player&apos;s recent games, run them through a chess engine,
            and explain — in plain English — the one habit worth fixing next.
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/onboard"
              className="rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
            >
              Start with a free report
            </Link>
            <Link
              href="/dashboard"
              className="rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-100"
            >
              View dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section>
        <h2 className="text-center text-2xl font-bold text-slate-900">How it works</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {[
            {
              title: "1 · Connect",
              body: "Add your player's chess.com or Lichess username — or snap a photo of a paper scoresheet.",
            },
            {
              title: "2 · Analyze",
              body: "A chess engine reviews each game and finds the mistakes that repeat most often.",
            },
            {
              title: "3 · Improve",
              body: "Get a parent-friendly summary and one focused drill. We check whether it stuck in later games.",
            },
          ].map((step) => (
            <div key={step.title} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
              <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-emerald-100 text-lg font-bold text-emerald-700">
                {step.title.charAt(0)}
              </div>
              <h3 className="font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="mx-auto max-w-md">
        <div className="rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-bold text-slate-900">Simple pricing</h2>
          <p className="mt-2 text-5xl font-extrabold text-slate-900">
            $20<span className="text-lg font-medium text-slate-500">/month</span>
          </p>
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            <li>✓ First report free — no card required</li>
            <li>✓ New coach report every month</li>
            <li>✓ Drill tracking across games</li>
            <li>✓ Auto-renews monthly — cancel anytime</li>
          </ul>
          <Link
            href="/onboard"
            className="mt-6 block rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Get started
          </Link>
        </div>
      </section>
    </div>
  );
}
