"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Chessground } from "@lichess-org/chessground";
import { Chess } from "chess.js";
import PageHeader from "@/components/PageHeader";

type Cg = ReturnType<typeof Chessground>;

interface Puzzle {
  id: string;
  rating: number;
  themes: string[];
  fen: string;
  solution: string[];
  plays: number;
}

type Status = "loading" | "playing" | "solved" | "error";

function destsFrom(game: Chess): any {
  const d = new Map<string, string[]>();
  for (const m of game.moves({ verbose: true })) {
    const arr = d.get(m.from) ?? [];
    arr.push(m.to);
    d.set(m.from, arr);
  }
  return d;
}

function turn(game: Chess): "white" | "black" {
  return game.turn() === "w" ? "white" : "black";
}

function applyUci(game: Chess, uci: string) {
  return game.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? (uci[4] as "q" | "r" | "b" | "n") : undefined,
  });
}

function sanOf(game: Chess, uci: string): string {
  const move = applyUci(game, uci);
  if (!move) return uci;
  const san = move.san;
  game.undo();
  return san;
}

export default function PuzzlesPage() {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Chess | null>(null);
  const cgRef = useRef<Cg | null>(null);
  const stepRef = useRef(0);
  const solutionRef = useRef<string[]>([]);
  const startFenRef = useRef("");
  const lastWrongRef = useRef<string>("");

  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [wrongCount, setWrongCount] = useState(0);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);

  const loadPuzzle = useCallback(async () => {
    setStatus("loading");
    setExplanation(null);
    setWrongCount(0);
    try {
      const res = await fetch("/api/puzzles", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.fen) {
        throw new Error(
          (data && (data as { error?: string }).error) ||
            "Failed to load the puzzle. Please try again."
        );
      }
      setPuzzle(data as Puzzle);
    } catch (err) {
      setStatus("error");
      setExplanation(err instanceof Error ? err.message : "Failed to load the puzzle.");
    }
  }, []);

  useEffect(() => {
    void loadPuzzle();
  }, [loadPuzzle]);

  const requestExplanation = useCallback(
    async (playedUci: string, reveal: boolean) => {
      const game = gameRef.current;
      if (!game || !puzzle) return;
      const expected = solutionRef.current[stepRef.current];
      const playedSan = sanOf(game, playedUci);
      const solutionSan = expected ? sanOf(game, expected) : "";
      setExplaining(true);
      try {
        const res = await fetch("/api/puzzles/explain", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fen: startFenRef.current,
            playedMove: playedSan,
            solutionMove: solutionSan,
            themes: puzzle.themes,
            kidName: "Player",
            reveal,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not get a hint.");
        setExplanation(data.answer as string);
      } catch (err) {
        setExplanation(err instanceof Error ? err.message : "Could not get a hint.");
      } finally {
        setExplaining(false);
      }
    },
    [puzzle]
  );

  const onMove = useCallback(
    (orig: string, dest: string) => {
      const game = gameRef.current;
      const cg = cgRef.current;
      if (!game || !cg) return;
      const solution = solutionRef.current;
      const step = stepRef.current;
      const expected = solution[step];
      if (!expected) return;

      const actual = `${orig}${dest}`;
      if (expected.slice(0, 4) !== actual) {
        // Wrong: revert and explain.
        cg.set({ fen: startFenRef.current });
        lastWrongRef.current = actual;
        setWrongCount((c) => c + 1);
        void requestExplanation(actual, false);
        return;
      }

      // Correct.
      const move = applyUci(game, actual);
      if (!move) {
        cg.set({ fen: startFenRef.current });
        return;
      }
      setExplanation(null);

      const opp = solution[step + 1];
      if (!opp) {
        stepRef.current = step + 1;
        cg.set({ fen: game.fen(), lastMove: [move.from, move.to] });
        setStatus("solved");
        return;
      }

      stepRef.current = step + 2;
      // Opponent's turn: block the player while the reply plays.
      cg.set({
        fen: game.fen(),
        turnColor: turn(game),
        lastMove: [move.from, move.to],
        movable: { color: turn(game), dests: new Map(), showDests: false },
      });
      window.setTimeout(() => {
        const g = gameRef.current;
        const c = cgRef.current;
        if (!g || !c) return;
        const reply = applyUci(g, opp);
        c.set({
          fen: g.fen(),
          turnColor: turn(g),
          lastMove: reply ? [reply.from, reply.to] : undefined,
          movable: { color: turn(g), dests: destsFrom(g), showDests: true },
        });
      }, 450);
    },
    [requestExplanation]
  );

  // (Re)build the board whenever a new puzzle loads.
  useEffect(() => {
    if (!puzzle || !boardRef.current) return;
    const game = new Chess(puzzle.fen);
    gameRef.current = game;
    solutionRef.current = puzzle.solution;
    stepRef.current = 0;
    startFenRef.current = puzzle.fen;
    setStatus("playing");

    const cg = Chessground(boardRef.current, {
      fen: puzzle.fen,
      orientation: turn(game),
      coordinates: true,
      highlight: { lastMove: true, check: true },
      animation: { enabled: true, duration: 150 },
      movable: {
        color: turn(game),
        free: false,
        dests: destsFrom(game),
        showDests: true,
        events: { after: onMove },
      },
    });
    cgRef.current = cg;
    return () => {
      cg.destroy();
      cgRef.current = null;
      gameRef.current = null;
    };
  }, [puzzle, onMove]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Daily puzzle"
        description="Solve the tactic. A wrong move gets a hint from the coach — no solution spoilers."
        actions={
          <button
            type="button"
            onClick={() => void loadPuzzle()}
            className="btn btn-secondary"
          >
            Reload
          </button>
        }
      />

      {status === "loading" && <div className="text-slate-500">Loading today&apos;s puzzle…</div>}

      {status === "error" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-red-600">{explanation}</div>
      )}

      {(status === "playing" || status === "solved") && puzzle && (
        <div className="grid gap-6 md:grid-cols-[minmax(0,400px)_1fr]">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div ref={boardRef} className="aspect-square w-full" />
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {puzzle.rating > 0 && (
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-semibold text-slate-700">
                  {puzzle.rating} rated
                </span>
              )}
              {puzzle.themes.map((t) => (
                <span key={t} className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-emerald-800">
                  {t}
                </span>
              ))}
            </div>

            {status === "solved" ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                <p className="text-lg font-semibold text-emerald-800">Solved! 🎉</p>
                <p className="mt-1 text-sm text-emerald-700">
                  You found the full line
                  {wrongCount ? ` after ${wrongCount} wrong tr${wrongCount === 1 ? "y" : "ies"}` : " on the first try"}.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="text-sm text-slate-600">
                  Find the forcing move. You play first, then the coach&apos;s reply appears.
                </p>
                {explanation && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 whitespace-pre-wrap">
                    {explaining ? "Thinking…" : explanation}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {explanation && lastWrongRef.current && (
                    <button
                      type="button"
                      onClick={() => void requestExplanation(lastWrongRef.current, true)}
                      className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
                    >
                      Reveal solution
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void loadPuzzle()}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    Skip
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Puzzles are served by Lichess.{" "}
        <Link href="/train" className="text-emerald-700 underline">
          Train your own mistakes
        </Link>{" "}
        instead.
      </p>
    </div>
  );
}
