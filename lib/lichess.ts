import { Chess } from "chess.js";

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  total: number;
}

export interface OpeningExplorerResult {
  fen: string;
  opening: string | null;
  moves: ExplorerMove[];
}

const EXPLORER_URL = "https://explorer.lichess.ovh/lichess";

/**
 * Lichess opening explorer: the most-played moves in master + lichess games
 * from the given position, with win/draw/loss counts. Used by the repertoire
 * builder so players see what is actually popular — not just what the engine
 * prefers. Data: lichess.org opening explorer.
 */
export async function openingExplorer(fen: string): Promise<OpeningExplorerResult> {
  const url =
    `${EXPLORER_URL}?variant=standard&speeds=blitz,rapid,classical&fen=` +
    encodeURIComponent(fen);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Lichess explorer failed (${res.status})`);
  }
  const data = await res.json();
  const moves: ExplorerMove[] = (data.moves || [])
    .map((m: any) => ({
      uci: m.uci,
      san: m.san,
      white: m.white || 0,
      draws: m.draws || 0,
      black: m.black || 0,
      total: (m.white || 0) + (m.draws || 0) + (m.black || 0),
    }))
    .sort((a: ExplorerMove, b: ExplorerMove) => b.total - a.total);

  return {
    fen: fen.split(" ").slice(0, 4).join(" "),
    opening: data.opening?.name || null,
    moves: moves.slice(0, 6),
  };
}

const LICHESS_DAILY = "https://lichess.org/api/puzzle/daily";
const USER_AGENT = "CheckmateCoach/1.0 (https://github.com/zVanta/ChessIntel)";

export interface DailyPuzzle {
  id: string;
  rating: number;
  themes: string[];
  fen: string;
  solution: string[];
  plays: number;
}

/**
 * FEN of the position ``initialPly`` plies into a PGN. Used only as a fallback
 * when the puzzle API omits the FEN.
 */
export function puzzleFenFromPgn(pgn: string, initialPly: number): string | null {
  try {
    const game = new Chess();
    game.loadPgn(pgn);
    const fen = (game.header().FEN as string | undefined) || undefined;
    const moves = game.history();
    const board = new Chess(fen);
    for (let i = 0; i < Math.min(initialPly, moves.length); i++) {
      board.move(moves[i]);
    }
    return board.fen();
  } catch {
    return null;
  }
}

/** Fetch today's Lichess puzzle and reduce it to the client shape. */
export async function dailyPuzzle(): Promise<DailyPuzzle> {
  const res = await fetch(LICHESS_DAILY, {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Lichess puzzle service unavailable (${res.status})`);
  }
  const data = await res.json();
  const puzzle = data?.puzzle;
  const game = data?.game;
  if (!puzzle || !Array.isArray(puzzle.solution) || puzzle.solution.length === 0) {
    throw new Error("Unexpected puzzle payload");
  }
  const fen =
    (typeof puzzle.fen === "string" && puzzle.fen) ||
    puzzleFenFromPgn(game?.pgn || "", puzzle.initialPly || 0);
  if (!fen) {
    throw new Error("Could not derive the puzzle position");
  }
  return {
    id: puzzle.id || "",
    rating: puzzle.rating ?? 0,
    themes: puzzle.themes ?? [],
    fen,
    solution: puzzle.solution,
    plays: puzzle.plays ?? 0,
  };
}
