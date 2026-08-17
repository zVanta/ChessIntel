"use client";

import { useMemo, useState } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";

export interface Blunder {
  ply: number;
  san?: string;
  phase: string;
  cp_loss: number;
}

interface Props {
  pgn: string;
  blunders?: Blunder[];
  className?: string;
}

export default function ChessGameViewer({ pgn, blunders = [], className }: Props) {
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

  const fen = index === 0 ? startFen : history[index - 1]?.after ?? startFen;
  const total = history.length;

  const blunderSquares = useMemo(() => {
    const set = new Set<string>();
    for (const b of blunders) {
      const move = history[b.ply - 1];
      if (move) {
        set.add(move.from);
        set.add(move.to);
      }
    }
    return set;
  }, [blunders, history]);

  const currentSquares = useMemo(() => {
    const set = new Set<string>();
    if (index > 0) {
      const move = history[index - 1];
      if (move) {
        set.add(move.from);
        set.add(move.to);
      }
    }
    return set;
  }, [index, history]);

  const customSquareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    for (const sq of blunderSquares) {
      styles[sq] = { backgroundColor: "rgba(220, 38, 38, 0.35)" };
    }
    for (const sq of currentSquares) {
      styles[sq] = { backgroundColor: "rgba(250, 204, 21, 0.45)" };
    }
    return styles;
  }, [blunderSquares, currentSquares]);

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
      <div className="mx-auto w-full max-w-md">
        <Chessboard
          position={fen}
          customSquareStyles={customSquareStyles}
          arePiecesDraggable={false}
          boardWidth={480}
        />
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
        <span className="ml-2 text-sm text-slate-600">{moveLabel}</span>
      </div>

      {blunders.length > 0 && (
        <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Mistakes flagged in this game</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {blunders.map((b) => (
              <li key={b.ply}>
                Move {b.ply} ({b.phase}): {b.san ?? "?"} — lost {Math.round(b.cp_loss)} cp
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
