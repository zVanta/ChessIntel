export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <div className="prose prose-slate max-w-none">
      <h1 className="text-2xl font-bold text-slate-900">Privacy Policy</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated: 2026-08-17</p>

      <div className="mt-6 space-y-6 text-sm leading-relaxed text-slate-700">
        <section>
          <h2 className="text-lg font-semibold text-slate-900">Data we collect</h2>
          <ul className="mt-2 list-inside list-disc space-y-1">
            <li>A player&apos;s first name or nickname (optional).</li>
            <li>chess.com and/or Lichess usernames.</li>
            <li>Public game data fetched from those platforms, and/or photos of paper scoresheets you upload.</li>
            <li>Generated coach reports and analysis results.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-900">Children&apos;s privacy</h2>
          <p className="mt-2">
            We follow COPPA and GDPR-K friendly defaults: no analytics on child
            accounts, per-player opt-in by a parent or guardian, and no email to
            minors. We never collect a child&apos;s email address.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-900">Storage & payments</h2>
          <p className="mt-2">
            Data is stored in a local SQLite database. If an OpenAI-compatible API
            key is configured, report summaries may be sent to that provider; leave
            it empty to use deterministic summaries instead. Billing is handled by
            Stripe and belongs to the parent or guardian.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-900">Your rights</h2>
          <p className="mt-2">
            Contact the operator of your deployment to access, correct, export, or
            delete a player profile and its reports. Deleting a profile removes the
            child&apos;s data.
          </p>
        </section>
      </div>
    </div>
  );
}
