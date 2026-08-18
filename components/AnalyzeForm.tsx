"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { KidWithMeta } from "@/lib/types";
import { pollJob } from "@/lib/poll";

const MODES = [
  { id: "scoresheet", label: "Scoresheet photo" },
  { id: "online", label: "Online games" },
  { id: "pgn", label: "Paste a game (PGN)" },
  { id: "ask", label: "Ask the coach" },
] as const;

type Mode = (typeof MODES)[number]["id"];

const KID_QUESTIONS = [
  "At the point the game turned, what did your kid think was going on — what were they expecting the opponent to do?",
  "At their most important decision, which moves did your kid actually consider?",
  "At the end, did your kid think they were winning, equal, or losing — and were they surprised by how it turned out?",
  "Was your kid short on time, tired, or rattled at any point? Which round of the day was this?",
  "When did your kid realize the position had turned against them — during the game, or only afterward?",
];

export default function AnalyzeForm() {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [kids, setKids] = useState<KidWithMeta[]>([]);
  const [kidId, setKidId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("scoresheet");
  const [notes, setNotes] = useState("");
  const [answers, setAnswers] = useState<string[]>(["", "", "", "", ""]);
  const [showQuestions, setShowQuestions] = useState(false);
  const [scoresheetFile, setScoresheetFile] = useState<File | null>(null);

  const [platform, setPlatform] = useState<"chesscom" | "lichess">("chesscom");
  const [username, setUsername] = useState("");
  const [maxGames, setMaxGames] = useState(5);
  const [pgnText, setPgnText] = useState("");
  const [question, setQuestion] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/kids", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load players.");
        if (cancelled) return;
        setKids(data.kids as KidWithMeta[]);
        const first = (data.kids as KidWithMeta[])[0];
        if (first) {
          setKidId(first.id);
          prefill(first);
        }
      } catch {
        // The page still renders; the kid selector will show "no players".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function prefill(kid: KidWithMeta) {
    if (kid.lichess_username) {
      setPlatform("lichess");
      setUsername(kid.lichess_username);
    } else if (kid.chesscom_username) {
      setPlatform("chesscom");
      setUsername(kid.chesscom_username);
    } else {
      setUsername("");
    }
  }

  const selectedKid = kids.find((k) => k.id === kidId) ?? null;

  function selectKid(nextId: number) {
    setKidId(nextId);
    const kid = kids.find((k) => k.id === nextId);
    if (kid) prefill(kid);
  }

  const cleanAnswers = answers.map((a) => a.trim()).filter(Boolean);

  async function handleScoresheet() {
    if (!scoresheetFile) return setError("Choose a scoresheet photo first.");
    if (kidId == null) return setError("Choose a player first.");
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("image", scoresheetFile);
      form.append("kidId", String(kidId));
      form.append("notes", notes);
      form.append("answers", JSON.stringify(cleanAnswers));
      const res = await fetch("/api/upload-scoresheet", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      setScoresheetFile(null);
      pollJob(
        data.jobId,
        (result) => {
          router.push(`/report/${result.report.id}`);
          router.refresh();
        },
        (msg) => {
          setError(msg);
          setBusy(false);
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setBusy(false);
    }
  }

  async function handleOnline() {
    if (kidId == null) return setError("Choose a player first.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kidId, platform, username, maxGames, notes, answers: cleanAnswers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed.");
      pollJob(
        data.jobId,
        (result) => {
          router.push(`/report/${result.report.id}`);
          router.refresh();
        },
        (msg) => {
          setError(msg);
          setBusy(false);
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
      setBusy(false);
    }
  }

  async function handlePgn() {
    if (kidId == null) return setError("Choose a player first.");
    if (!pgnText.trim()) return setError("Paste a PGN first.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze-pgn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kidId, pgn: pgnText, notes, answers: cleanAnswers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "PGN analysis failed.");
      pollJob(
        data.jobId,
        (result) => {
          router.push(`/report/${result.report.id}`);
          router.refresh();
        },
        (msg) => {
          setError(msg);
          setBusy(false);
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "PGN analysis failed.");
      setBusy(false);
    }
  }

  async function handleAsk() {
    if (!question.trim()) return setError("Type a question first.");
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, notes, kidName: selectedKid?.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The coach is unreachable right now.");
      setAnswer(data.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The coach is unreachable right now.");
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    setError(null);
    setAnswer(null);
    if (mode === "scoresheet") return handleScoresheet();
    if (mode === "online") return handleOnline();
    if (mode === "pgn") return handlePgn();
    return handleAsk();
  }

  const showKidQuestions = mode === "scoresheet" || mode === "pgn";

  return (
    <div className="space-y-6">
      {/* Player selector */}
      {kids.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <label className="block text-sm font-medium text-slate-700">Player</label>
          <select
            value={kidId ?? ""}
            onChange={(e) => selectKid(Number(e.target.value))}
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

      {/* Mode tabs */}
      <div className="grid gap-2 sm:grid-cols-4">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setMode(m.id);
              setError(null);
              setAnswer(null);
            }}
            className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
              mode === m.id
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-emerald-400"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Mode panels */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        {mode === "scoresheet" && (
          <div>
            <h3 className="text-base font-semibold text-slate-800">Photograph the scoresheet</h3>
            <p className="mt-1 text-sm text-slate-600">
              Snap the paper scoresheet and we&apos;ll read every move into a report.
            </p>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setScoresheetFile(f);
              }}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setScoresheetFile(f);
              }}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900"
              >
                📷 Take photo
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                🖼 Upload picture
              </button>
              {scoresheetFile && (
                <span className="text-sm text-slate-500">✓ {scoresheetFile.name}</span>
              )}
            </div>
          </div>
        )}

        {mode === "online" && (
          <div>
            <h3 className="text-base font-semibold text-slate-800">Pull recent online games</h3>
            <p className="mt-1 text-sm text-slate-600">
              We build a profile of what keeps costing points, so every later report gets sharper.
            </p>

            <div className="mt-4 flex gap-6">
              {(["chesscom", "lichess"] as const).map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="platform"
                    checked={platform === p}
                    onChange={() => setPlatform(p)}
                    className="accent-emerald-600"
                  />
                  {p === "chesscom" ? "Chess.com" : "Lichess"}
                </label>
              ))}
            </div>

            <label className="mt-4 block text-sm font-medium text-slate-700">
              Username on {platform === "chesscom" ? "Chess.com" : "Lichess"}
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={platform === "chesscom" ? "Chess.com username" : "Lichess username"}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />

            <label className="mt-4 block text-sm font-medium text-slate-700">
              How many recent games — up to {maxGames}
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={maxGames}
              onChange={(e) => setMaxGames(Number(e.target.value))}
              className="mt-1 w-full accent-emerald-600"
            />
            <p className="mt-1 text-xs text-slate-500">
              Slower games give a sharper read — rapid and classical beat blitz, and bullet
              mostly measures reflexes.
            </p>
          </div>
        )}

        {mode === "pgn" && (
          <div>
            <h3 className="text-base font-semibold text-slate-800">Paste one game or a whole set</h3>
            <p className="mt-1 text-sm text-slate-600">
              Paste PGN (one game, or several separated by blank lines).
            </p>
            <textarea
              value={pgnText}
              onChange={(e) => setPgnText(e.target.value)}
              rows={10}
              placeholder='[Event "Tournament"]&#10;[White "Kid"]&#10;[Black "Opponent"]&#10;[Result "1-0"]&#10;&#10;1. e4 e5 2. Nf3 *'
              className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
            />
          </div>
        )}

        {mode === "ask" && (
          <div>
            <h3 className="text-base font-semibold text-slate-800">Ask the coach — no game needed</h3>
            <p className="mt-1 text-sm text-slate-600">
              Describe what you&apos;re seeing and get an analysis back.
            </p>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={4}
              placeholder="e.g. My kid keeps losing knights in the middlegame — what should we practice?"
              className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            {answer && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-slate-800 whitespace-pre-wrap">
                {answer}
              </div>
            )}
          </div>
        )}

        {/* Common: notes + kid questions */}
        <div className="mt-5 border-t border-slate-100 pt-4">
          <label className="block text-sm font-medium text-slate-700">
            Anything we should know? <span className="font-normal text-slate-400">— optional</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Context, time trouble, a specific concern…"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />

          {showKidQuestions && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowQuestions((s) => !s)}
                className="text-sm font-medium text-emerald-700 underline"
              >
                {showQuestions ? "Hide" : "Ask your kid"} (optional — right after the game)
              </button>
              {showQuestions && (
                <div className="mt-3 space-y-3">
                  {KID_QUESTIONS.map((q, i) => (
                    <div key={i}>
                      <label className="block text-sm text-slate-600">
                        {i + 1}. {q}
                      </label>
                      <input
                        value={answers[i]}
                        onChange={(e) =>
                          setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))
                        }
                        placeholder="In their own words… (optional)"
                        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy
              ? "Working…"
              : mode === "ask"
                ? "Ask"
                : mode === "online"
                  ? "Analyze games"
                  : "Analyze"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}
