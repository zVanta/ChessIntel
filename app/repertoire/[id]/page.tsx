"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Chessground } from "@lichess-org/chessground";
import { Chess } from "chess.js";
import type { Repertoire, RepertoireMove } from "@/lib/types";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

interface PendingMove {
  fenBefore: string;
  uci: string;
  san: string;
  fenAfter: string;
}

function applyUci(game: Chess, uci: string) {
  return game.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? (uci[4] as "q" | "r" | "b" | "n") : undefined,
  });
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

function Board({
  fen,
  orientation,
  lastMove,
  onMove,
}: {
  fen: string;
  orientation: "white" | "black";
  lastMove?: [string, string];
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
        color: game.turn() === "w" ? "white" : "black",
        free: false,
        dests: destsFor(game),
        showDests: true,
        events: { after: (orig, dest) => onMoveRef.current(orig, dest) },
      },
    });
    return () => cg.destroy();
  }, [fen, orientation, lastMove]);

  return <div ref={ref} className="aspect-square w-full" />;
}

export default function RepertoireBuildPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const [repertoire, setRepertoire] = useState<Repertoire | null>(null);
  const [moves, setMoves] = useState<RepertoireMove[]>([]);
  const [path, setPath] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [suggestions, setSuggestions] = useState<{ uci: string; san: string; cp: number }[]>([]);
  const [explorer, setExplorer] = useState<{
    opening: string | null;
    moves: { uci: string; san: string; total: number; white: number }[];
  }>({ opening: null, moves: [] });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/repertoires/${id}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) return setError(data.error || "Repertoire not found.");
      setRepertoire(data.repertoire as Repertoire);
      setMoves(data.moves as RepertoireMove[]);
    })();
  }, [id]);

  const line = useMemo(() => {
    const game = new Chess();
    const sans: string[] = [];
    const fens: string[] = [START_FEN];
    for (const uci of path) {
      const m = applyUci(game, uci);
      if (!m) break;
      sans.push(m.san);
      fens.push(game.fen());
    }
    return { sans, fens, game };
  }, [path]);

  const currentFen = line.fens[line.fens.length - 1];
  const lastMove: [string, string] | undefined =
    path.length > 0 ? [path[path.length - 1].slice(0, 2), path[path.length - 1].slice(2, 4)] : undefined;

  const savedHere = useMemo(
    () => moves.filter((m) => m.fen_before === currentFen),
    [moves, currentFen]
  );

  useEffect(() => {
    let cancelled = false;
    setSuggestions([]);
    (async () => {
      try {
        const res = await fetch(`/api/repertoires/suggest?fen=${encodeURIComponent(currentFen)}`);
        const data = await res.json();
        if (!res.ok || cancelled) return;
        setSuggestions(data.moves as { uci: string; san: string; cp: number }[]);
      } catch {
        // Engine unavailable — the panel just stays empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentFen]);

  useEffect(() => {
    let cancelled = false;
    setExplorer({ opening: null, moves: [] });
    (async () => {
      try {
        const res = await fetch(`/api/opening-explorer?fen=${encodeURIComponent(currentFen)}`);
        const data = await res.json();
        if (!res.ok || cancelled) return;
        setExplorer(data);
      } catch {
        // Explorer unavailable — the panel stays empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentFen]);

  function navigate(uci: string) {
    const before = new Chess(currentFen);
    const m = applyUci(before, uci);
    if (!m) return;
    setPending({ fenBefore: currentFen, uci, san: m.san, fenAfter: before.fen() });
    setPath((prev) => [...prev, uci]);
  }

  function handleBoardMove(orig: string, dest: string) {
    navigate(`${orig}${dest}`);
  }

  async function save() {
    if (!pending) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/repertoires/${id}/moves`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pending),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save the move.");
      setMoves((prev) => [...prev, data.move as RepertoireMove]);
      setPending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the move.");
    } finally {
      setSaving(false);
    }
  }

  async function removeMove(moveId: number) {
    await fetch(`/api/repertoires/${id}/moves/${moveId}`, { method: "DELETE" });
    setMoves((prev) => prev.filter((m) => m.id !== moveId));
  }

  function jumpTo(index: number) {
    setPath((prev) => prev.slice(0, index));
    setPending(null);
  }

  const orientation: "white" | "black" = repertoire?.color ?? "white";

  if (!repertoire) {
    return error ? <div className="text-red-600">{error}</div> : <div className="text-slate-500">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{repertoire.name}</h1>
          <p className="text-sm capitalize text-slate-500">{repertoire.color} repertoire</p>
        </div>
        <Link href="/repertoire" className="text-sm text-emerald-700 underline">
          ← All repertoires
        </Link>
      </div>

      {/* Breadcrumb of the current line */}
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
        <button type="button" onClick={() => jumpTo(0)} className="rounded px-1.5 py-0.5 font-medium text-slate-500 hover:bg-slate-100">
          start
        </button>
        {line.sans.map((san, i) => (
          <span key={i} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => jumpTo(i + 1)}
              className={`rounded px-1.5 py-0.5 font-mono ${i === line.sans.length - 1 ? "bg-emerald-100 text-emerald-800" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {san}
            </button>
            {i < line.sans.length - 1 && <span className="text-slate-300">·</span>}
          </span>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,400px)_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <Board fen={currentFen} orientation={orientation} lastMove={lastMove} onMove={handleBoardMove} />
        </div>

        <div className="space-y-4">
          {pending && (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <span className="font-mono text-lg font-semibold text-emerald-800">{pending.san}</span>
              <span className="text-sm text-emerald-700">is on the board.</span>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="ml-auto rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setPath((prev) => prev.slice(0, -1));
                  setPending(null);
                }}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Undo
              </button>
            </div>
          )}

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">My moves here</h2>
            {savedHere.length === 0 ? (
              <p className="mt-1 text-sm text-slate-400">No saved moves at this position.</p>
            ) : (
              <div className="mt-2 space-y-1">
                {savedHere.map((m) => (
                  <div key={m.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(m.uci)}
                      className="rounded-md bg-slate-100 px-3 py-1.5 font-mono text-sm text-slate-800 hover:bg-slate-200"
                    >
                      {m.san}
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeMove(m.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Stockfish suggests</h2>
            {suggestions.length === 0 ? (
              <p className="mt-1 text-sm text-slate-400">Thinking…</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s.uci}
                    type="button"
                    onClick={() => navigate(s.uci)}
                    className="rounded-md border border-slate-200 px-3 py-1.5 font-mono text-sm text-slate-800 hover:border-emerald-400 hover:bg-emerald-50"
                  >
                    {s.san} <span className="text-slate-400">({(s.cp / 100).toFixed(1)})</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Popular in the Lichess database
            </h2>
            {explorer.opening && <p className="mt-1 text-xs text-slate-400">{explorer.opening}</p>}
            {explorer.moves.length === 0 ? (
              <p className="mt-1 text-sm text-slate-400">No games reach this position yet.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {explorer.moves.map((m) => {
                  const whitePct = m.total ? Math.round((m.white * 100) / m.total) : 0;
                  return (
                    <button
                      key={m.uci}
                      type="button"
                      onClick={() => navigate(m.uci)}
                      className="group flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-left hover:border-emerald-400 hover:bg-emerald-50"
                    >
                      <span className="w-14 font-mono text-sm text-slate-800">{m.san}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <span
                          className="block h-full rounded-full bg-emerald-500"
                          style={{ width: `${whitePct}%` }}
                        />
                      </span>
                      <span className="w-10 text-right text-xs text-slate-500">{whitePct}%</span>
                      <span className="w-16 text-right text-xs text-slate-400">
                        {m.total.toLocaleString()} games
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
