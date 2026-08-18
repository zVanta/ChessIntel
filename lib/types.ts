export interface User {
  id: number;
  email: string;
  password_hash: string;
  role: "admin" | "user" | string;
  credits: number;
  created_at: string;
  stripe_customer_id: string | null;
  subscription_status: "none" | "active" | "canceled" | "past_due" | string;
}

export interface Kid {
  id: number;
  user_id: number | null;
  name: string;
  age: string | null;
  uscf_rating: string | null;
  fide_rating: string | null;
  online_rating: string | null;
  chesscom_username: string | null;
  lichess_username: string | null;
  focus_notes: string | null;
  created_at: string;
  stripe_customer_id: string | null;
  subscription_status: "none" | "active" | "canceled" | "past_due" | string;
}

export interface KidWithMeta extends Kid {
  reports_count: number;
  latest_report_at: string | null;
  tracked_habit: string | null;
}

export interface Report {
  id: number;
  kid_id: number;
  created_at: string;
  summary_text: string;
  recurring_habit: string;
  drill: string;
  points_lost: number;
  json_payload: string;
}

export interface GameRow {
  id: number;
  report_id: number;
  source: string;
  external_id: string | null;
  pgn: string;
  analyzed_at: string;
}

export interface GameWithReport extends GameRow {
  kid_id: number;
  recurring_habit: string | null;
}

export interface DrillFollowup {
  id: number;
  report_id: number;
  kid_id: number;
  later_report_id: number;
  held: boolean;
  checked_at: string;
}

export interface ProgressRow {
  report: Report;
  followups: DrillFollowup[];
}

export interface AnalysisGame {
  source?: string | null;
  external_id?: string | null;
  pgn?: string;
  white?: string | null;
  black?: string | null;
  result?: string | null;
  played_at?: number | null;
  blunders: { ply: number; san?: string; phase: string; cp_loss: number }[];
  phase_blunders: Record<string, number>;
  points_lost: number;
  habit_tags: string[];
}

export interface AnalysisResult {
  kid_name: string;
  platform: string;
  username: string;
  game_count: number;
  habit: string;
  summary_text: string;
  report_markdown?: string;
  drill: string;
  points_lost: number;
  games: AnalysisGame[];
}
