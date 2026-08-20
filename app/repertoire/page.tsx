"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import type { Kid, Repertoire } from "@/lib/types";

export default function RepertoirePage() {
  const [kids, setKids] = useState<Kid[]>([]);
  const [kidId, setKidId] = useState<number | null>(null);
  const [repertoires, setRepertoires] = useState<Repertoire[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState<"white" | "black">("white");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/kids", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) return;
      const list = data.kids as Kid[];
      setKids(list);
      if (list[0]) setKidId(list[0].id);
    })();
  }, []);

  const load = useCallback(async (id: number) => {
    const res = await fetch(`/api/repertoires?kidId=${id}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Failed to load repertoires.");
    setRepertoires(data.repertoires as Repertoire[]);
    setError(null);
  }, []);

  useEffect(() => {
    if (kidId != null) void load(kidId);
  }, [kidId, load]);

  async function create() {
    if (kidId == null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/repertoires", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kidId, name, color }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create.");
      setName("");
      await load(kidId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    await fetch(`/api/repertoires/${id}`, { method: "DELETE" });
    if (kidId != null) await load(kidId);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Opening repertoires"
        description="Record the lines you play and let Stockfish suggest the best replies at each step."
      />

      {kids.length > 0 && (
        <div className="max-w-xs">
          <label className="block text-sm font-medium text-slate-700">Player</label>
          <select
            value={kidId ?? ""}
            onChange={(e) => setKidId(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {kids.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-800">New repertoire</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Italian for White"
              className="mt-1 block w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <div className="flex gap-4">
            {(["white", "black"] as const).map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="rep-color"
                  checked={color === c}
                  onChange={() => setColor(c)}
                  className="accent-emerald-600"
                />
                {c === "white" ? "White" : "Black"}
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy || !name.trim()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Create
          </button>
        </div>
        {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {repertoires.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
            <Link href={`/repertoire/${r.id}`} className="min-w-0">
              <div className="truncate font-semibold text-slate-900">{r.name}</div>
              <div className="text-sm capitalize text-slate-500">{r.color}</div>
            </Link>
            <button
              type="button"
              onClick={() => void remove(r.id)}
              className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        ))}
        {kidId != null && repertoires.length === 0 && (
          <div className="text-slate-500 sm:col-span-2">No repertoires yet — create one above.</div>
        )}
      </div>
    </div>
  );
}
