"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DrillFollowup, Kid, KidWithMeta, Report } from "@/lib/types";

interface ProgressRow {
  report: Report;
  followups: DrillFollowup[];
}

interface Props {
  kidId: number | null;
}

export default function ProgressView({ kidId }: Props) {
  const [kids, setKids] = useState<KidWithMeta[]>([]);
  const [kid, setKid] = useState<Kid | null>(null);
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (kidId == null) {
          const res = await fetch("/api/kids", { cache: "no-store" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to load players.");
          if (!cancelled) setKids(data.kids as KidWithMeta[]);
        } else {
          const res = await fetch(`/api/progress/${kidId}`, { cache: "no-store" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Failed to load progress.");
          if (!cancelled) {
            setKid(data.kid as Kid);
            setRows(data.progress as ProgressRow[]);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [kidId]);

  if (loading) return <p className="text-slate-500">Loading…</p>;
  if (error) return <p className="rounded-md bg-red-50 p-4 text-red-700">{error}</p>;

  if (kidId == null) {
    if (kids.length === 0) {
      return (
        <p className="text-slate-600">
          No players yet.{" "}
          <Link href="/onboard" className="text-emerald-700 underline">
            Add one first
          </Link>
          .
        </p>
      );
    }
    return (
      <div className="space-y-2">
        <p className="text-sm text-slate-600">Choose a player to view progress:</p>
        {kids.map((k) => (
          <Link
            key={k.id}
            href={`/progress?kid=${k.id}`}
            className="block rounded-lg border border-slate-200 bg-white p-3 hover:border-emerald-400"
          >
            <span className="font-medium text-slate-800">{k.name}</span>
            <span className="ml-2 text-xs text-slate-500">
              {k.reports_count} report{k.reports_count === 1 ? "" : "s"}
            </span>
          </Link>
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-slate-800">{kid?.name ?? "Player"}</h2>
        <p className="mt-2 text-slate-600">
          No reports yet. Run a report from the dashboard to get started.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-slate-800">
        {kid?.name ?? "Player"} — report history
      </h2>

      <div className="mt-4 space-y-4">
        {rows.map(({ report, followups }) => {
          const check = followups.find((f) => f.later_report_id === report.id);
          return (
            <div
              key={report.id}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-slate-500">{report.created_at}</p>
                  <h3 className="mt-1 text-base font-semibold text-slate-800">
                    <Link href={`/report/${report.id}`} className="hover:text-emerald-700">
                      {report.recurring_habit}
                    </Link>
                  </h3>
                  <p className="mt-1 text-sm text-slate-600">{report.summary_text}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                      Points lost: {report.points_lost}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                      Drill: {report.drill}
                    </span>
                  </div>
                  <Link
                    href={`/report/${report.id}`}
                    className="mt-3 inline-block text-sm font-medium text-emerald-700 underline hover:text-emerald-800"
                  >
                    View full report →
                  </Link>
                </div>

                <div className="shrink-0">
                  {check ? (
                    check.held ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                        ✓ Drill held
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700">
                        ✗ Drill regressed
                      </span>
                    )
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                      {report.id === rows[0]?.report.id ? "Pending next report" : "New habit"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
