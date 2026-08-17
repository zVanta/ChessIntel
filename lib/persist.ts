import { createDrillFollowup, createGame, createReport, getLatestReportForKid } from "./db";
import type { AnalysisResult, DrillFollowup, GameRow, Report } from "./types";

export interface PersistedAnalysis {
  report: Report;
  games: GameRow[];
  followup: DrillFollowup | null;
}

/**
 * Persist an analysis result: insert the report, its games, and (memory loop)
 * a drill follow-up row comparing against the kid's most recent prior report.
 *
 * Memory loop semantics: if the prior report tracked the same recurring habit,
 * the new drill "held" when points_lost stayed the same or improved (lower is
 * better for points lost).
 */
export function persistAnalysis(kidId: number, result: AnalysisResult): PersistedAnalysis {
  const prior = getLatestReportForKid(kidId);

  const report = createReport(
    kidId,
    result.summary_text,
    result.habit,
    result.drill,
    result.points_lost,
    JSON.stringify(result)
  );

  const games = (result.games || []).map((g) =>
    createGame(report.id, g.source || "unknown", g.external_id || null, g.pgn || "")
  );

  let followup: DrillFollowup | null = null;
  if (prior && prior.recurring_habit === result.habit) {
    const held = result.points_lost <= prior.points_lost;
    followup = createDrillFollowup(prior.id, kidId, report.id, held);
  }

  return { report, games, followup };
}
