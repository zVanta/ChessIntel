"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Chessground } from "@lichess-org/chessground";
import { Chess } from "chess.js";
import PageHeader from "@/components/PageHeader";
import type { Kid, MistakeCard } from "@/lib/types";

const norm = (s: string) => s.replace(/[+#]/g, "");

function StaticBoard({ fen, orientation }: { fen: string; orientation: "white" | "black" }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cg = Chessground(el, {
      fen,
      orientation,
      coordinates: true,
      viewOnly: true,
      disableContextMenu: true,
    });
    return () => cg.destroy();
  }, [fen, orientation]);
  return <div ref={ref} className="aspect-square w-full max-w-sm" />;
}

function destsFor(game: Chess): any {
  const d = new Map<string, string[]>();
  for (const m of game.moves({ verbose: true })) {
    const arr = d.get(m.from) ?? [];
    arr.push(m.to);
    d.set(m.from, arr);
  }
  return d;
}

function PlayableBoard({
  fen,
  orientation,
  onMove,
}: {
  fen: string;
  orientation: "white" | "black";
  onMove: (orig: string, dest: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const game = new Chess(fen);
    const cg = Chessground(el, {
      fen,
      orientation,
      coordinates: true,
      highlight: { lastMove: true, check: true },
      animation: { enabled: true, duration: 120 },
      movable: {
        color: game.turn() === "w" ? "white" : "black",
        free: false,
        dests: destsFor(game),
        showDests: true,
        events: { after: (orig, dest) => onMoveRef.current(orig, dest) },
      },
    });
    return () => cg.destroy();
  }, [fen, orientation]);

  return <div ref={ref} className="aspect-square w-full max-w-sm" />;
}

export default function TrainPage() {
  const [kids, setKids] = useState<Kid[]>([]);
  const [kidId, setKidId] = useState<number | null>(null);
  const [cards, setCards] = useState<MistakeCard[]>([]);
  const [showAnswer, setShowAnswer] = useState(false);
  const [mode, setMode] = useState<"recall" | "play">("recall");
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [playMessage, setPlayMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/kids", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load players.");
        const list = data.kids as Kid[];
        setKids(list);
        if (list[0]) setKidId(list[0].id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load players.");
      }
    })();
  }, []);

  const loadCards = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/train?kidId=${id}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load cards.");
      setCards(data.cards as MistakeCard[]);
      setShowAnswer(false);
      setMode("recall");
      setWrongAttempts(0);
      setPlayMessage(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cards.");
    }
  }, []);

  useEffect(() => {
    if (kidId != null) void loadCards(kidId);
  }, [kidId, loadCards]);

  async function review(correct: boolean) {
    const card = cards[0];
    if (!card || kidId == null) return;
    const res = await fetch("/api/train", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cardId: card.id, correct }),
    });
    if (!res.ok) return;
    await loadCards(kidId);
  }

  const card = cards[0];
  const remaining = cards.length;

  // The engine's better move, parsed into from/to/san so the kid can try to find it.
  const bestMove = useMemo(() => {
    if (!card?.best) return null;
    try {
      const game = new Chess(card.fen);
      const mv = game.move(card.best.replace(/[+#]/g, ""));
      if (!mv) return null;
      return { san: mv.san, from: mv.from, to: mv.to };
    } catch {
      return null;
    }
  }, [card]);

  function handlePlayMove(orig: string, dest: string) {
    if (!card || !bestMove) return;
    const game = new Chess(card.fen);
    let mv;
    try {
      mv = game.move({ from: orig, to: dest, promotion: "q" });
    } catch {
      return;
    }
    if (norm(mv.san) === norm(bestMove.san)) {
      setPlayMessage("Correct! That was the move the engine wanted.");
      setMode("recall");
      void review(true);
    } else {
      setWrongAttempts((n) => n + 1);
      setPlayMessage("Not quite — that isn't the engine's pick. Try again.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Train your mistakes"
        description="Cards return on a spaced schedule so a mistake stops repeating. Recall what went wrong — or play the position and try to find the better move."
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

      {error && <div className="text-sm text-red-600">{error}</div>}

      {!error && kidId != null && !card && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">
          No cards due right now. 🎉 New cards appear after each game you analyze.
        </div>
      )}

      {card && (
        <div className="grid gap-6 md:grid-cols-[minmax(0,360px)_1fr]">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            {mode === "play" ? (
              <PlayableBoard fen={card.fen} orientation={card.color} onMove={handlePlayMove} />
            ) : (
              <StaticBoard fen={card.fen} orientation={card.color} />
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Concept
              </div>
              <div className="text-lg font-semibold text-slate-900">{card.concept}</div>
              <div className="mt-2 text-sm text-slate-500">
                {remaining} card{remaining === 1 ? "" : "s"} due · reviewed {card.repetitions}×
                {card.lapses ? ` · ${card.lapses} lapse${card.lapses === 1 ? "" : "s"}` : ""}
              </div>

              {showAnswer ? (
                <div className="mt-4 space-y-2 text-sm">
                  <p>
                    <span className="font-semibold text-red-600">You played:</span>{" "}
                    <span className="font-mono">{card.san}</span>
                  </p>
                  {card.best && card.best !== card.san && (
                    <p>
                      <span className="font-semibold text-emerald-700">Better was:</span>{" "}
                      <span className="font-mono">{card.best}</span>
                    </p>
                  )}
                  {card.threat_detail && (
                    <p className="text-slate-600">{card.threat_detail}</p>
                  )}
                  <p className="text-slate-500">
                    This move cost ~{(card.cp_loss / 100).toFixed(1)} pawns.
                  </p>
                </div>
              ) : mode === "play" ? (
                <div className="mt-4 space-y-3 text-sm">
                  <p className="text-slate-600">
                    Your move. Find the better move the engine wanted instead of{" "}
                    <span className="font-mono">{card.san}</span>.
                  </p>
                  {playMessage && (
                    <p className="rounded-md bg-slate-50 px-3 py-2 text-slate-700">{playMessage}</p>
                  )}
                  {wrongAttempts >= 2 && (
                    <p className="text-slate-500">
                      Hint: it would have kept the position safe.{" "}
                      <button
                        type="button"
                        onClick={() => {
                          setShowAnswer(true);
                          setMode("recall");
                        }}
                        className="font-semibold text-emerald-700 underline"
                      >
                        Reveal the answer
                      </button>
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500">
                  Look at the position. What was wrong with the move you played here?
                </p>
              )}

              <div className="mt-5 flex flex-wrap gap-2">
                {!showAnswer && mode === "recall" && (
                  <>
                    {bestMove && (
                      <button
                        type="button"
                        onClick={() => {
                          setMode("play");
                          setPlayMessage(null);
                          setWrongAttempts(0);
                        }}
                        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                      >
                        Try the fix
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowAnswer(true)}
                      className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900"
                    >
                      Show answer
                    </button>
                  </>
                )}

                {showAnswer && (
                  <>
                    <button
                      type="button"
                      onClick={() => review(false)}
                      className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                    >
                      Missed
                    </button>
                    <button
                      type="button"
                      onClick={() => review(true)}
                      className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                    >
                      Got it ✓
                    </button>
                  </>
                )}
              </div>
            </div>

            <p className="text-xs text-slate-400">
              Cards come from the mistakes found in analyzed games. Missed cards return tomorrow;
              cards you get right stretch out to 2, 4, 8… days.
            </p>
          </div>
        </div>
      )}

      {kids.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">
          No players yet — <Link href="/dashboard" className="text-emerald-700 underline">add a player</Link>{" "}
          and analyze a game first.
        </div>
      )}
    </div>
  );
}
