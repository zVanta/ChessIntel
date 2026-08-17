"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AddKidForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [chesscom, setChesscom] = useState("");
  const [lichess, setLichess] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/kids", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          chesscomUsername: chesscom,
          lichessUsername: lichess,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add kid.");
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add kid.");
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <h2 className="text-lg font-semibold text-slate-800">Add a player</h2>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          First name (or nickname)
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Alex"
          required
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          chess.com username
        </label>
        <input
          value={chesscom}
          onChange={(e) => setChesscom(e.target.value)}
          placeholder="optional"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Lichess username
        </label>
        <input
          value={lichess}
          onChange={(e) => setLichess(e.target.value)}
          placeholder="optional"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      {error && (
        <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {loading ? "Saving…" : "Save player"}
      </button>
    </form>
  );
}
