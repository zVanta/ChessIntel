"use client";

import { useCallback, useEffect, useState } from "react";
import type { Kid, KidWithMeta } from "@/lib/types";

interface PublicUser {
  id: number;
  email: string;
  role: string;
  credits: number;
  subscription_status: string;
}

const EMPTY_KID = {
  name: "",
  age: "",
  uscf_rating: "",
  fide_rating: "",
  online_rating: "",
  chesscom_username: "",
  lichess_username: "",
  focus_notes: "",
};

type KidFields = typeof EMPTY_KID;

export default function ProfileView() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [kids, setKids] = useState<KidWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [funding, setFunding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [add, setAdd] = useState<KidFields>({ ...EMPTY_KID });
  const [editing, setEditing] = useState<number | null>(null);
  const [edit, setEdit] = useState<KidFields>({ ...EMPTY_KID });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [meRes, kidsRes] = await Promise.all([
        fetch("/api/auth/me", { cache: "no-store" }),
        fetch("/api/kids", { cache: "no-store" }),
      ]);
      const me = await meRes.json();
      const kidsData = await kidsRes.json();
      if (kidsRes.ok) {
        setKids((kidsData.kids as KidWithMeta[]) ?? []);
        setBillingEnabled(Boolean(kidsData.billingEnabled));
      }
      if (meRes.ok) setUser(me.user as PublicUser);
    } catch {
      setError("Failed to load your profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("funding=success")) {
      setNotice("Payment received — credits were added to your account.");
    }
  }, []);

  function fieldsFrom(kid: Kid | KidWithMeta): KidFields {
    return {
      name: kid.name,
      age: kid.age ?? "",
      uscf_rating: kid.uscf_rating ?? "",
      fide_rating: kid.fide_rating ?? "",
      online_rating: kid.online_rating ?? "",
      chesscom_username: kid.chesscom_username ?? "",
      lichess_username: kid.lichess_username ?? "",
      focus_notes: kid.focus_notes ?? "",
    };
  }

  function startEdit(kid: KidWithMeta) {
    setEditing(kid.id);
    setEdit(fieldsFrom(kid));
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/kids", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(add),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add child.");
      setShowAdd(false);
      setAdd({ ...EMPTY_KID });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add child.");
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit(e: React.FormEvent, id: number) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/kids/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(edit),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save.");
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setBusy(false);
    }
  }

  async function removeKid(id: number) {
    if (!confirm("Delete this child and all their reports?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/kids/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
    } finally {
      setBusy(false);
    }
  }

  async function fund() {
    setFunding(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed.");
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
      setFunding(false);
    }
  }

  async function manageBilling() {
    setFunding(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not open billing portal.");
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing portal.");
      setFunding(false);
    }
  }

  async function exportData() {
    setFunding(true);
    setError(null);
    try {
      const res = await fetch("/api/export", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Export failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "checkmate-coach-data.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setFunding(false);
    }
  }

  async function deleteAccount() {
    if (!confirm("Delete your account and ALL child data? This cannot be undone.")) return;
    setFunding(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/me", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Delete failed.");
      }
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
      setFunding(false);
    }
  }

  if (loading) return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="space-y-6">
      {/* Account summary */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{user?.email ?? "Account"}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {user?.role === "admin" ? "Administrator" : "Parent account"}
            </p>
          </div>
          <div className="text-right">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">
              ⚡ {user?.credits ?? 0} report credit{(user?.credits ?? 0) === 1 ? "" : "s"}
            </span>
            <p className="mt-1 text-xs text-slate-400">One report = one credit</p>
            {billingEnabled && user?.role !== "admin" && (
              <button
                onClick={fund}
                disabled={funding}
                className="mt-2 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {funding ? "Opening…" : "Fund credits — $20/mo"}
              </button>
            )}
            {user?.subscription_status && user.subscription_status !== "none" && (
              <button
                onClick={manageBilling}
                disabled={funding}
                className="mt-2 ml-2 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
              >
                Manage billing
              </button>
            )}
            <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-2">
              <button
                onClick={exportData}
                disabled={funding}
                className="text-xs text-slate-500 underline hover:text-slate-700"
              >
                Download my data
              </button>
              {user?.role !== "admin" && (
                <button
                  onClick={deleteAccount}
                  disabled={funding}
                  className="text-xs text-red-500 underline hover:text-red-700"
                >
                  Delete account
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {notice && (
        <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>
      )}
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* Add child */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <button
          onClick={() => setShowAdd((s) => !s)}
          className="text-sm font-medium text-emerald-700 underline"
        >
          {showAdd ? "Cancel" : "+ Add a child"}
        </button>
        {showAdd && (
          <KidFieldsForm
            fields={add}
            setFields={setAdd}
            onSubmit={submitAdd}
            busy={busy}
            submitLabel="Add child"
          />
        )}
      </div>

      {/* Kids */}
      <div className="space-y-4">
        {kids.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
            No players yet. Add a child to get started.
          </p>
        )}
        {kids.map((kid) => (
          <div key={kid.id} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">{kid.name}</h3>
                <p className="mt-0.5 text-sm text-slate-500">
                  {[
                    kid.age && `Age ${kid.age}`,
                    kid.uscf_rating && `USCF ${kid.uscf_rating}`,
                    kid.fide_rating && `FIDE ${kid.fide_rating}`,
                    kid.online_rating && `Online ${kid.online_rating}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {kid.chesscom_username ? `chess.com: ${kid.chesscom_username}` : ""}
                  {kid.chesscom_username && kid.lichess_username ? " · " : ""}
                  {kid.lichess_username ? `Lichess: ${kid.lichess_username}` : ""}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  {kid.reports_count} report{kid.reports_count === 1 ? "" : "s"}
                  {kid.tracked_habit ? ` · Tracking: ${kid.tracked_habit}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <button
                  onClick={() => (editing === kid.id ? setEditing(null) : startEdit(kid))}
                  className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                >
                  {editing === kid.id ? "Close" : "Edit profile"}
                </button>
                <button
                  onClick={() => removeKid(kid.id)}
                  className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                >
                  Delete
                </button>
              </div>
            </div>

            {editing === kid.id && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <KidFieldsForm
                  fields={edit}
                  setFields={setEdit}
                  onSubmit={(e) => submitEdit(e, kid.id)}
                  busy={busy}
                  submitLabel="Save changes"
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function KidFieldsForm({
  fields,
  setFields,
  onSubmit,
  busy,
  submitLabel,
}: {
  fields: KidFields;
  setFields: (f: KidFields) => void;
  onSubmit: (e: React.FormEvent) => void;
  busy: boolean;
  submitLabel: string;
}) {
  const set = (key: keyof KidFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setFields({ ...fields, [key]: e.target.value });

  return (
    <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="mb-1 block text-sm font-medium text-slate-700">Kid&apos;s name</label>
        <input value={fields.name} onChange={set("name")} required className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Age — optional</label>
        <input value={fields.age} onChange={set("age")} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">USCF / FIDE rating</label>
        <input value={fields.uscf_rating} onChange={set("uscf_rating")} placeholder="skip if unknown" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Online rating</label>
        <input value={fields.online_rating} onChange={set("online_rating")} placeholder="skip if unknown" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Chess.com username</label>
        <input value={fields.chesscom_username} onChange={set("chesscom_username")} placeholder="we pull up to 50 games" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Lichess username — optional</label>
        <input value={fields.lichess_username} onChange={set("lichess_username")} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-sm font-medium text-slate-700">Anything to focus on? — optional</label>
        <textarea value={fields.focus_notes} onChange={set("focus_notes")} rows={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <div className="sm:col-span-2">
        <button type="submit" disabled={busy} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
