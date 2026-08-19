import { notFound, redirect } from "next/navigation";
import ChessGameViewer from "@/components/ChessGameViewer";
import { getGame, getReport } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const metadata = { title: "Game" };

interface GameBlunder {
  ply: number;
  san?: string;
  phase: string;
  cp_loss: number;
  best?: string | null;
  class?: string;
  loss_pct?: number;
}

type GameEval = [number, number, string | null];

export default function GamePage({ params }: { params: { id: string } }) {
  const user = getSessionUser();
  if (!user) redirect("/login");

  const game = getGame(Number(params.id));
  if (!game) notFound();

  let blunders: GameBlunder[] = [];
  let evals: GameEval[] = [];
  const report = getReport(game.report_id);
  if (report) {
    try {
      const payload = JSON.parse(report.json_payload) as {
        games?: {
          external_id?: string | null;
          pgn?: string;
          blunders?: GameBlunder[];
          evals?: GameEval[];
        }[];
      };
      const match = (payload.games ?? []).find(
        (g) =>
          (g.external_id && g.external_id === game.external_id) ||
          (g.pgn && g.pgn === game.pgn)
      );
      blunders = match?.blunders ?? [];
      evals = match?.evals ?? [];
    } catch {
      blunders = [];
      evals = [];
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Game review</h1>
      <p className="mt-1 text-sm text-slate-600">
        Source: {game.source}
        {game.external_id ? ` · ${game.external_id}` : ""} · Analyzed: {game.analyzed_at}
      </p>
      <div className="mt-6">
        <ChessGameViewer pgn={game.pgn} blunders={blunders} evals={evals} />
      </div>
    </div>
  );
}
