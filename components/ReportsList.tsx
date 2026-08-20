"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface ReportRow {
  id: number;
  kid_id: number;
  kid_name: string;
  user_email: string | null;
  recurring_habit: string;
  summary_text: string;
  points_lost: number;
  created_at: string;
}

export default function ReportsList({
  reports,
  isAdmin,
}: {
  reports: ReportRow[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: number) {
    if (!confirm("Delete this report? This cannot be undone.")) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
      setBusyId(null);
    }
  }

  if (reports.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
        No reports yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {reports.map((r) => (
        <div
          key={r.id}
          className="card p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-slate-500">
                {r.kid_name}
                {isAdmin && r.user_email ? ` · ${r.user_email}` : ""} · {r.created_at}
              </p>
              <h3 className="mt-1 text-base font-semibold text-slate-800">
                <Link href={`/report/${r.id}`} className="hover:text-emerald-700">
                  {r.recurring_habit}
                </Link>
              </h3>
              <p className="mt-1 text-sm text-slate-600">{r.summary_text}</p>
              <p className="mt-1 text-xs text-slate-400">Points lost: {r.points_lost}</p>
            </div>
            <button
              onClick={() => remove(r.id)}
              disabled={busyId === r.id}
              className="shrink-0 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-40"
            >
              {busyId === r.id ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
