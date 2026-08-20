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
      className="card mx-auto max-w-md space-y-4 p-6"
    >
      <h2 className="text-lg font-semibold text-slate-800">Add a player</h2>

      <div>
        <label className="label">First name (or nickname)</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Alex"
          required
          className="input"
        />
      </div>

      <div>
        <label className="label">chess.com username</label>
        <input
          value={chesscom}
          onChange={(e) => setChesscom(e.target.value)}
          placeholder="optional"
          className="input"
        />
      </div>

      <div>
        <label className="label">Lichess username</label>
        <input
          value={lichess}
          onChange={(e) => setLichess(e.target.value)}
          placeholder="optional"
          className="input"
        />
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="btn btn-primary w-full"
      >
        {loading ? "Saving…" : "Save player"}
      </button>
    </form>
  );
}
