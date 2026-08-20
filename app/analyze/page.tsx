import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import AnalyzeForm from "@/components/AnalyzeForm";
import PageHeader from "@/components/PageHeader";

export const metadata = { title: "Analyze" };

export default function AnalyzePage() {
  const user = getSessionUser();
  if (!user) redirect("/login?next=/analyze");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Get a game analyzed"
        description="Send a game three ways — a scoresheet photo, pulled online games, or a pasted PGN — or ask the coach a question, no game needed. Every move gets checked against a real engine, and the report lands in your account."
      />

      <AnalyzeForm />

      <div className="card p-6">
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
