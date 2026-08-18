import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import AnalyzeForm from "@/components/AnalyzeForm";

export const metadata = { title: "Analyze" };

export default function AnalyzePage() {
  const user = getSessionUser();
  if (!user) redirect("/login?next=/analyze");

  return (
    <div>
      <h1 className="text-3xl font-bold text-slate-900">Get a game analyzed.</h1>
      <p className="mt-2 max-w-2xl text-slate-600">
        Send a game three ways — a scoresheet photo, pulled online games, or a pasted PGN — or
        ask the coach a question, no game needed. Every move gets checked against a real engine,
        and the report lands in your account.
      </p>

      <div className="mt-6">
        <AnalyzeForm />
      </div>

      <div className="mt-10 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">What happens next</h2>
        <p className="mt-2 text-sm text-slate-600">
          Every move is read and checked against the actual game score. We find the turning
          points and the patterns costing your kid points, then write it up in plain language: a
          short page for your kid and the full picture for you. The report ends with a few
          questions your kid answers, then rewrites itself around what they saw. The first report
          is free.
        </p>
      </div>
    </div>
  );
}
