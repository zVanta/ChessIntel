import Link from "next/link";

const practice = [
  {
    href: "/puzzles",
    icon: "🧩",
    title: "Tactical puzzles",
    body: "A fresh tactic every round, with coach hints when you miss.",
  },
  {
    href: "/sparring",
    icon: "♟️",
    title: "Sparring partner",
    body: "Play a human-like opponent at your rating — White or Black.",
  },
  {
    href: "/repertoire",
    icon: "📚",
    title: "Repertoire builder",
    body: "Build an opening you trust, move by move, engine-checked.",
  },
  {
    href: "/train",
    icon: "🎯",
    title: "Mistake cards",
    body: "Drill the exact positions from your own games until they stick.",
  },
];

export default function LandingPage() {
  return (
    <div className="space-y-16">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-emerald-100 bg-gradient-to-b from-emerald-50 via-white to-white px-6 py-16 text-center sm:px-10 sm:py-24">
        <div className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full bg-emerald-100/60 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -right-10 h-72 w-72 rounded-full bg-teal-100/50 blur-3xl" />
        <div className="relative mx-auto max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3.5 py-1 text-xs font-semibold text-emerald-700 shadow-sm">
            ♞ Checkmate Coach
          </span>
          <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-5xl sm:leading-tight">
            Turn your kid&apos;s games into a{" "}
            <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
              simple coaching plan
            </span>
            .
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
            We pull your junior player&apos;s recent games, run them through a chess engine,
            and explain — in plain English — the one habit worth fixing next.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/onboard" className="btn btn-primary px-7 py-3">
              Start with a free report
            </Link>
            <Link href="/dashboard" className="btn btn-secondary px-7 py-3">
              View dashboard
            </Link>
          </div>
          <p className="mt-5 text-xs text-slate-500">
            First report free · No card required · Built for parents, not for coaches
          </p>
        </div>
      </section>

      {/* Practice suite */}
      <section>
        <h2 className="text-center text-2xl font-bold text-slate-900 sm:text-3xl">
          Practice, not just analysis
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-slate-600">
          Every report feeds a practice suite grounded in your player&apos;s own games.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {practice.map((f) => (
            <Link key={f.href} href={f.href} className="card card-hover p-6">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-2xl">
                {f.icon}
              </div>
              <h3 className="mt-4 font-semibold text-slate-900">{f.title}</h3>
              <p className="mt-1.5 text-sm text-slate-600">{f.body}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section>
        <h2 className="text-center text-2xl font-bold text-slate-900 sm:text-3xl">How it works</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {[
            {
              n: "1",
              title: "Connect",
              body: "Add your player's chess.com or Lichess username — or snap a photo of a paper scoresheet.",
            },
            {
              n: "2",
              title: "Analyze",
              body: "A chess engine reviews each game and finds the mistakes that repeat most often.",
            },
            {
              n: "3",
              title: "Improve",
              body: "Get a parent-friendly summary and one focused drill. We check whether it stuck in later games.",
            },
          ].map((step) => (
            <div key={step.n} className="card card-hover p-6">
              <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-emerald-100 text-lg font-bold text-emerald-700">
                {step.n}
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
          <Link href="/onboard" className="btn btn-primary mt-6 w-full px-6 py-3">
            Get started
          </Link>
        </div>
      </section>
    </div>
  );
}
