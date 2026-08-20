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
