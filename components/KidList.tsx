"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { KidWithMeta } from "@/lib/types";
import ScoreSheetUpload from "./ScoreSheetUpload";

export default function KidList() {
  const router = useRouter();
  const [kids, setKids] = useState<KidWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKid, setBusyKid] = useState<number | null>(null);
  const [actionError, setActionError] = useState<{ kidId: number; message: string } | null>(
    null
  );
  const [platforms, setPlatforms] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/kids", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load players.");
      setKids(data.kids as KidWithMeta[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load players.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function defaultPlatform(kid: KidWithMeta): string {
    if (kid.lichess_username) return "lichess";
    if (kid.chesscom_username) return "chesscom";
    return "";
  }

  async function analyze(kid: KidWithMeta) {
    const platform = platforms[kid.id] || defaultPlatform(kid);
    if (!platform) {
      setActionError({ kidId: kid.id, message: "No platform username configured." });
      return;
    }
    setBusyKid(kid.id);
    setActionError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kidId: kid.id, platform }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed.");
      router.push(`/progress?kid=${kid.id}`);
      router.refresh();
    } catch (err) {
      setActionError({
        kidId: kid.id,
        message: err instanceof Error ? err.message : "Analysis failed.",
      });
      setBusyKid(null);
    }
  }

  async function subscribe(kid: KidWithMeta) {
    setBusyKid(kid.id);
    setActionError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kidId: kid.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed.");
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setActionError({
        kidId: kid.id,
        message: err instanceof Error ? err.message : "Checkout failed.",
      });
      setBusyKid(null);
    }
  }

  if (loading) {
    return <p className="text-slate-500">Loading players…</p>;
  }
  if (error) {
    return <p className="rounded-md bg-red-50 p-4 text-red-700">{error}</p>;
  }
  if (kids.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center">
        <p className="text-slate-600">No players yet.</p>
        <Link
          href="/onboard"
          className="mt-3 inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Add your first player
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {kids.map((kid) => {
        const platform = platforms[kid.id] || defaultPlatform(kid);
        const needsSubscription = kid.reports_count > 0 && kid.subscription_status !== "active";
        return (
          <div
            key={kid.id}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">{kid.name}</h3>
                <p className="text-sm text-slate-500">
                  {kid.chesscom_username ? `chess.com: ${kid.chesscom_username}` : ""}
                  {kid.chesscom_username && kid.lichess_username ? " · " : ""}
                  {kid.lichess_username ? `Lichess: ${kid.lichess_username}` : ""}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {kid.reports_count === 0
                    ? "No reports yet — the first one is free."
                    : `Last report: ${kid.latest_report_at ?? "—"} · Tracking: ${kid.tracked_habit ?? "—"}`}
                </p>
                {kid.reports_count > 0 && (
                  <p
                    className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      kid.subscription_status === "active"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {kid.subscription_status === "active" ? "Active" : "No active plan"}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  {(kid.lichess_username || kid.chesscom_username) && (
                    <select
                      value={platform}
                      onChange={(e) =>
                        setPlatforms((p) => ({ ...p, [kid.id]: e.target.value }))
                      }
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
                    >
                      {kid.lichess_username && <option value="lichess">Lichess</option>}
                      {kid.chesscom_username && <option value="chesscom">chess.com</option>}
                    </select>
                  )}
                  <button
                    onClick={() => analyze(kid)}
                    disabled={busyKid === kid.id}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {busyKid === kid.id ? "Working…" : "Run report"}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/progress?kid=${kid.id}`}
                    className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                  >
                    Progress
                  </Link>
                  {needsSubscription && (
                    <button
                      onClick={() => subscribe(kid)}
                      disabled={busyKid === kid.id}
                      className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      Subscribe $15/mo
                    </button>
                  )}
                </div>
              </div>
            </div>

            {actionError?.kidId === kid.id && (
              <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">
                {actionError.message}
              </p>
            )}

            <div className="mt-4">
              <ScoreSheetUpload kidId={kid.id} kidName={kid.name} onDone={load} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
