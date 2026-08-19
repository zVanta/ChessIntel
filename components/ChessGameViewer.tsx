"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chessground } from "@lichess-org/chessground";
import { Chess } from "chess.js";

type CgApi = ReturnType<typeof Chessground>;
type DrawShape = Parameters<CgApi["setAutoShapes"]>[0][number];
type CgKey = DrawShape["orig"];

export interface Blunder {
  ply: number;
  san?: string;
  phase: string;
  cp_loss: number;
  best?: string | null;
  class?: string;
  loss_pct?: number;
}

export type EvalPoint = [number, number, string | null];

interface Props {
  pgn: string;
  blunders?: Blunder[];
  evals?: EvalPoint[];
  className?: string;
}

const MATE_CP = 10000;

function winningChances(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function evalLabel(cp: number | null): string {
  if (cp === null || Number.isNaN(cp)) return "–";
  if (cp >= MATE_CP - 1) return "+M";
  if (cp <= -(MATE_CP - 1)) return "−M";
  const pawns = cp / 100;
  return (pawns > 0 ? "+" : "") + pawns.toFixed(1);
}

export default function ChessGameViewer({
  pgn,
  blunders = [],
  evals = [],
  className,
}: Props) {
  const game = useMemo(() => {
    try {
      const g = new Chess();
      g.loadPgn(pgn);
      return g;
    } catch {
      return null;
    }
  }, [pgn]);

  const history = useMemo(
    () => (game ? game.history({ verbose: true }) : []),
    [game]
  );
  const startFen = useMemo(() => new Chess().fen(), []);
  const [index, setIndex] = useState(0);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const boardRef = useRef<HTMLDivElement | null>(null);
  const cgRef = useRef<CgApi | null>(null);

  const fen = index === 0 ? startFen : history[index - 1]?.after ?? startFen;
  const total = history.length;

  // Create the chessground instance once per game.
  useEffect(() => {
    const el = boardRef.current;
    if (!el) {
      cgRef.current?.destroy();
      cgRef.current = null;
      return;
    }
    const cg = Chessground(el, {
      fen: startFen,
      orientation: "white",
      coordinates: true,
      viewOnly: true,
      disableContextMenu: true,
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true },
    });
    cgRef.current = cg;
    return () => {
      cg.destroy();
      cgRef.current = null;
    };
  }, [startFen, game]);

  // Keep the board in sync with navigation.
  useEffect(() => {
    const cg = cgRef.current;
    if (!cg) return;

    const move = index > 0 ? history[index - 1] : null;
    const lastMove: [CgKey, CgKey] | undefined = move
      ? [move.from as CgKey, move.to as CgKey]
      : undefined;

    const shapes: DrawShape[] = [];

    // Engine's best move for the current position (green arrow).
    const bestUci = evals[index]?.[2];
    if (bestUci && bestUci.length >= 4) {
      shapes.push({
        orig: bestUci.slice(0, 2) as CgKey,
        dest: bestUci.slice(2, 4) as CgKey,
        brush: "green",
      });
    }

    // Red squares on a blunder move at the current position.
    if (move && blunders.some((b) => b.ply === index)) {
      shapes.push({ orig: move.from as CgKey, brush: "red" });
      shapes.push({ orig: move.to as CgKey, brush: "red" });
    }

    cg.set({ fen, lastMove, orientation });
    cg.setAutoShapes(shapes);
  }, [fen, index, orientation, history, evals, blunders]);

  // Evaluation from White's perspective for the current position.
  const whiteCp = useMemo(() => {
    if (index === 0) return null;
    const point = evals[index - 1];
    if (!point || typeof point[1] !== "number") return null;
    return point[0] % 2 === 1 ? point[1] : -point[1];
  }, [index, evals]);

  const whitePct =
    whiteCp === null
      ? 50
      : Math.max(0, Math.min(100, winningChances(whiteCp)));

  const currentBlunder =
    index > 0 ? blunders.find((b) => b.ply === index) : undefined;

  if (!game) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
        This PGN could not be parsed.
      </div>
    );
  }

  const current = index > 0 ? history[index - 1] : null;
  const moveLabel =
    index === 0
      ? "Start position"
      : `${index}. ${current?.san ?? ""} ${current?.color === "w" ? "(White)" : "(Black)"}`;

  return (
    <div className={className}>
      <div className="mx-auto flex w-full max-w-lg items-stretch justify-center gap-3">
        {/* Eval bar */}
        <div className="relative w-4 shrink-0 overflow-hidden rounded-sm border border-slate-400 bg-slate-900">
          <div
            className="absolute left-0 right-0 bg-white transition-[height] duration-200"
            style={
              orientation === "white"
                ? { bottom: 0, height: `${whitePct}%` }
                : { top: 0, height: `${whitePct}%` }
            }
          />
        </div>

        {/* Board */}
        <div className="w-full max-w-md">
          <div ref={boardRef} className="cg-wrap aspect-square w-full" />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={() => setIndex(0)}
          disabled={index === 0}
          className="rounded bg-slate-200 px-3 py-1 text-sm font-medium disabled:opacity-40"
        >
          ⏮
        </button>
        <button
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          className="rounded bg-slate-200 px-3 py-1 text-sm font-medium disabled:opacity-40"
        >
          ◀
        </button>
        <button
          onClick={() => setIndex((i) => Math.min(total, i + 1))}
          disabled={index === total}
          className="rounded bg-slate-200 px-3 py-1 text-sm font-medium disabled:opacity-40"
        >
          ▶
        </button>
        <button
          onClick={() => setIndex(total)}
          disabled={index === total}
          className="rounded bg-slate-200 px-3 py-1 text-sm font-medium disabled:opacity-40"
        >
          ⏭
        </button>
        <button
          onClick={() =>
            setOrientation((o) => (o === "white" ? "black" : "white"))
          }
          className="rounded bg-slate-200 px-3 py-1 text-sm font-medium"
          title="Flip board"
        >
          ⇅
        </button>
        <span className="ml-2 text-sm text-slate-600">{moveLabel}</span>
        {currentBlunder && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
            {currentBlunder.class ?? "mistake"} · −
            {Math.round(currentBlunder.cp_loss)} cp
            {currentBlunder.best ? ` · best ${currentBlunder.best}` : ""}
          </span>
        )}
        <span className="text-xs text-slate-500">Eval {evalLabel(whiteCp)}</span>
      </div>

      {blunders.length > 0 && (
        <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Mistakes flagged in this game</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {blunders.map((b) => (
              <li key={b.ply}>
                Move {b.ply} ({b.phase}): {b.san ?? "?"} —{" "}
                {b.class ?? "mistake"}, lost {Math.round(b.cp_loss)} cp
                {b.best ? ` (best was ${b.best})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
