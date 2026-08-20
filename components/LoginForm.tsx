"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only allow same-origin redirects — block open redirects via ?next=.
  const rawNext = searchParams.get("next");
  const next = rawNext && rawNext.startsWith("/") ? rawNext : "/dashboard";

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      let data: { error?: string } = {};
      try {
        data = await res.json();
      } catch {
        // Empty/non-JSON response — fall through with a generic message.
      }
      if (!res.ok) {
        throw new Error(data.error || `Request failed (status ${res.status}). Please try again.`);
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="card mx-auto w-full max-w-sm space-y-4 p-6 sm:p-8"
    >
      <div className="text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-2xl font-bold text-white shadow-sm">
          ♞
        </span>
        <h2 className="mt-3 text-xl font-bold tracking-tight text-slate-900">
          {mode === "login" ? "Welcome back, coach" : "Create your account"}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {mode === "login"
            ? "Log in to see your players and reports."
            : "Start with one free report on us."}
        </p>
      </div>

      <div>
        <label className="label">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="input"
        />
      </div>

      <div>
        <label className="label">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          className="input"
        />
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <button type="submit" disabled={busy} className="btn btn-primary w-full">
        {busy ? "Working…" : mode === "login" ? "Log in" : "Create account"}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "login" ? "register" : "login");
          setError(null);
        }}
        className="w-full text-center text-sm font-medium text-emerald-700 hover:text-emerald-800"
      >
        {mode === "login" ? "New here? Create an account" : "Already have an account? Log in"}
      </button>
    </form>
  );
}
