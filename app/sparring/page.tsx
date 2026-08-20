"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Chessground } from "@lichess-org/chessground";
import { Chess } from "chess.js";
import PageHeader from "@/components/PageHeader";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function destsFor(game: Chess): any {
  const d = new Map<string, string[]>();
  for (const m of game.moves({ verbose: true })) {
    const arr = d.get(m.from) ?? [];
    arr.push(m.to);
    d.set(m.from, arr);
  }
  return d;
}

function uciToMove(uci: string) {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? (uci[4] as "q" | "r" | "b" | "n") : undefined,
  };
}

function Board({
  fen,
  orientation,
  lastMove,
  movableColor,
  onMove,
}: {
  fen: string;
  orientation: "white" | "black";
  lastMove?: [string, string];
  movableColor?: "white" | "black";
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
      animation: { enabled: true, duration: 150 },
      lastMove: lastMove as any,
      movable: {
        color: movableColor,
        free: false,
        dests: destsFor(game),
        showDests: true,
        events: { after: (orig, dest) => onMoveRef.current(orig, dest) },
      },
    });
    return () => cg.destroy();
  }, [fen, orientation, lastMove, movableColor]);

  return <div ref={ref} className="aspect-square w-full" />;
}

export default function SparringPage() {
  const [fen, setFen] = useState(START_FEN);
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [kidColor, setKidColor] = useState<"white" | "black">("white");
  const [elo, setElo] = useState(1200);
  const [thinking, setThinking] = useState(false);
  const [status, setStatus] = useState("Your move — play as White.");
  const [sans, setSans] = useState<string[]>([]);
  const gameRef = useRef(new Chess());

  const kidChar = kidColor === "white" ? "w" : "b";

  const newGame = useCallback((color: "white" | "black") => {
    gameRef.current = new Chess();
    setKidColor(color);
    setFen(START_FEN);
    setLastMove(undefined);
    setSans([]);
    setStatus(color === "white" ? "Your move — play as White." : "Thinking…");
  }, []);

  const engineMove = useCallback(
    async (game: Chess, color: "white" | "black", currentElo: number) => {
      setThinking(true);
      try {
        const res = await fetch("/api/spar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fen: game.fen(), elo: currentElo }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Engine unreachable");
        if (data.game_over || !data.move_uci) {
          setStatus(game.isCheckmate() ? "Checkmate!" : "Game over.");
          setFen(game.fen());
          return;
        }
        const m = game.move(uciToMove(data.move_uci));
        setLastMove([m.from, m.to]);
        setSans((s) => [...s, m.san]);
        setFen(game.fen());
        if (game.isGameOver()) {
          setStatus(game.isCheckmate() ? "Checkmate!" : "Game over.");
        } else {
          setStatus(color === "white" ? "Your move." : "Your move.");
        }
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "The engine is unreachable right now.");
      } finally {
        setThinking(false);
      }
    },
    []
  );

  // When the kid plays Black, the engine opens with White.
  useEffect(() => {
    if (kidColor === "black" && fen === START_FEN && !thinking) {
      engineMove(gameRef.current, "black", elo);
    }
  }, [kidColor, fen, thinking, elo, engineMove]);

  const onMove = useCallback(
    async (orig: string, dest: string) => {
      const game = gameRef.current;
      if (thinking || game.isGameOver()) return;
      if (game.turn() !== kidChar) return;
      let m;
      try {
        m = game.move({ from: orig, to: dest, promotion: "q" });
      } catch {
        return;
      }
      setLastMove([m.from, m.to]);
      setSans((s) => [...s, m.san]);
      setFen(game.fen());
      if (game.isGameOver()) {
        setStatus(game.isCheckmate() ? "Checkmate — you win!" : "Game over.");
        return;
      }
      setStatus("Thinking…");
      await engineMove(game, kidColor, elo);
    },
    [thinking, kidChar, kidColor, elo, engineMove]
  );

  const movableColor =
    thinking || gameRef.current.turn() !== kidChar
      ? undefined
      : kidColor === "white"
        ? "white"
        : "black";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sparring partner"
        description="Play against a human-like opponent set to roughly your rating. No neural model needed — the engine softens its search to match the level."
      />

      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="sm:w-2/3">
          <div className="overflow-hidden rounded-lg border border-slate-200 shadow-sm">
            <Board
              fen={fen}
              orientation={kidColor}
              lastMove={lastMove}
              movableColor={movableColor}
              onMove={onMove}
            />
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:w-1/3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Opponent strength</span>
            <input
              type="range"
              min={600}
              max={2000}
              step={50}
              value={elo}
              onChange={(e) => setElo(Number(e.target.value))}
              className="mt-1 w-full"
            />
            <span className="text-xs text-slate-500">~{elo} Elo</span>
          </label>

          <div>
            <span className="text-sm font-medium text-slate-700">Play as</span>
            <div className="mt-1 flex gap-2">
              <button
                onClick={() => newGame("white")}
                className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
              >
                ♔ White
              </button>
              <button
                onClick={() => newGame("black")}
                className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
              >
                ♚ Black
              </button>
            </div>
          </div>

          <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{status}</p>

          <div className="rounded-md bg-slate-50 px-3 py-2">
            <span className="text-xs font-medium uppercase text-slate-400">Moves</span>
            <p className="mt-1 min-h-6 text-sm text-slate-700">
              {sans.length > 0 ? sans.join(" ") : "—"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
