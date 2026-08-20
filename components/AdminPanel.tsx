"use client";

import { useCallback, useEffect, useState } from "react";

interface AdminUser {
  id: number;
  email: string;
  role: string;
  credits: number;
  created_at: string;
  kids_count: number;
  reports_count: number;
  puzzles_solved: number;
  subscription_status: string;
}

export default function AdminPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [creditInput, setCreditInput] = useState<Record<number, string>>({});
  const [search, setSearch] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load users.");
      setUsers(data.users as AdminUser[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(t);
  }, [flash]);

  async function update(id: number, patch: { credits?: number; role?: string }) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed.");
      setFlash("Saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function setCredits(id: number) {
    const raw = creditInput[id] ?? "";
    const parsed = Number(raw);
    if (raw === "" || !Number.isFinite(parsed) || parsed < 0) {
      setError("Enter a non-negative number of credits.");
      return;
    }
    await update(id, { credits: Math.floor(parsed) });
    setCreditInput((s) => ({ ...s, [id]: "" }));
  }

  async function remove(id: number, email: string) {
    if (!confirm(`Delete ${email} and all their data?`)) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed.");
      setFlash("Account deleted.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function grantAll() {
    if (!confirm(`Add 20 credits to all ${users.length} accounts?`)) return;
    setBusyAll(true);
    setError(null);
    try {
      for (const u of users) {
        const res = await fetch(`/api/admin/users/${u.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ credits: u.credits + 20 }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Bulk grant failed.");
      }
      setFlash(`Granted +20 credits to ${users.length} account${users.length === 1 ? "" : "s"}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk grant failed.");
    } finally {
      setBusyAll(false);
    }
  }

  const filtered = users.filter((u) =>
    u.email.toLowerCase().includes(search.trim().toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-6 text-slate-500">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        Loading accounts…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {flash && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
          {flash}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Accounts" value={String(users.length)} />
        <StatCard label="Total reports" value={String(users.reduce((s, u) => s + u.reports_count, 0))} />
        <StatCard label="Puzzles solved" value={String(users.reduce((s, u) => s + u.puzzles_solved, 0))} />
        <StatCard label="Total credits out" value={String(users.reduce((s, u) => s + u.credits, 0))} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email…"
          className="input max-w-xs"
        />
        <button
          type="button"
          onClick={grantAll}
          disabled={busyAll || users.length === 0}
          className="btn btn-secondary"
        >
          Grant +20 to all
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Credits</th>
              <th className="px-4 py-3">Kids</th>
              <th className="px-4 py-3">Reports</th>
              <th className="px-4 py-3">Puzzles</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50/70">
                <td className="px-4 py-3 font-medium text-slate-800">
                  {u.email}
                  <span className="ml-1 text-xs text-slate-400">#{u.id}</span>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => update(u.id, { role: u.role === "admin" ? "user" : "admin" })}
                    disabled={busyId === u.id}
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      u.role === "admin"
                        ? "bg-indigo-100 text-indigo-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                    title="Click to toggle role"
                  >
                    {u.role}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => update(u.id, { credits: u.credits - 1 })}
                      disabled={busyId === u.id || u.credits <= 0}
                      className="h-6 w-6 rounded border border-slate-300 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    >
                      −
                    </button>
                    <span className="w-8 text-center font-semibold">{u.credits}</span>
                    <button
                      onClick={() => update(u.id, { credits: u.credits + 1 })}
                      disabled={busyId === u.id}
                      className="h-6 w-6 rounded border border-slate-300 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                    >
                      +
                    </button>
                    <button
                      onClick={() => update(u.id, { credits: u.credits + 20 })}
                      disabled={busyId === u.id}
                      className="ml-1 rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-200"
                      title="Fund one $20 month (20 credits)"
                    >
                      +20
                    </button>
                    <input
                      type="number"
                      min={0}
                      value={creditInput[u.id] ?? ""}
                      onChange={(e) => setCreditInput((s) => ({ ...s, [u.id]: e.target.value }))}
                      placeholder="Set"
                      className="ml-1 w-14 rounded border border-slate-300 px-1 py-0.5 text-xs"
                    />
                    <button
                      onClick={() => setCredits(u.id)}
                      disabled={busyId === u.id}
                      className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                    >
                      Set
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3">{u.kids_count}</td>
                <td className="px-4 py-3">{u.reports_count}</td>
                <td className="px-4 py-3">{u.puzzles_solved}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      u.subscription_status === "active"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {u.subscription_status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {new Date(u.created_at + "Z").toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => remove(u.id, u.email)}
                    disabled={busyId === u.id || u.role === "admin"}
                    className="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-40"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                  No accounts match “{search}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
