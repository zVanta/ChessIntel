"use client";

import { useState } from "react";

interface Message {
  role: "user" | "coach";
  text: string;
}

export default function ReportChat({ reportId, kidName }: { reportId: number; kidName: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/report-ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reportId, question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The coach couldn't reply.");
      setMessages((m) => [...m, { role: "coach", text: data.answer }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "coach", text: err instanceof Error ? err.message : "The coach couldn't reply." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-base font-semibold text-slate-900">
        Ask the coach about this report
      </h3>
      <p className="mt-0.5 text-sm text-slate-500">
        The coach has read {kidName}&apos;s report — ask anything about the moments, the drill, or
        what to do next.
      </p>

      {messages.length > 0 && (
        <div className="mt-4 space-y-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                m.role === "user"
                  ? "ml-auto bg-emerald-600 text-white"
                  : "bg-slate-100 text-slate-800"
              }`}
            >
              {m.text}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={send} className="mt-4 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`e.g. Why did ${kidName} lose to the knight fork?`}
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? "Thinking…" : "Ask"}
        </button>
      </form>
    </div>
  );
}
