import type { Metadata } from "next";
import PageHeader from "@/components/PageHeader";

export const metadata: Metadata = { title: "FAQ" };

const FAQS = [
  {
    q: "How do I get my kid's first report?",
    a: "Add a player on the Profile page with their chess.com or Lichess username, then press “Run report” on the dashboard. Your first report is free — no card needed.",
  },
  {
    q: "What counts as one report credit?",
    a: "Each analysis of a set of recent games uses one credit. New accounts start with one free credit, and the $20/month plan adds 20 credits each month.",
  },
  {
    q: "Why does the report ask which side my kid played?",
    a: "Some pasted PGNs and scoresheets don't include player names. Telling us White or Black makes sure the report blames the right player's mistakes.",
  },
  {
    q: "How does the app find mistakes?",
    a: "Every move is checked against a chess engine (Stockfish). Moves that lose a lot of advantage are flagged, and the report explains the repeating pattern in plain language.",
  },
  {
    q: "What are mistake cards and how do they work?",
    a: "After each report, your kid's biggest mistakes become training cards. Cards return on a spaced schedule — right answers stretch the gap to 2, 4, 8… days; missed cards come back sooner.",
  },
  {
    q: "Where do the puzzles come from?",
    a: "Puzzles come from chess.com's random puzzle feed (the Lichess daily is the fallback). You can also practice your own mistakes on the Train page with the “Try the fix” board.",
  },
  {
    q: "What does the opening repertoire builder do?",
    a: "Record the lines you play move by move. At each step you see Stockfish's best replies and what is most popular in the Lichess game database.",
  },
  {
    q: "What is the sparring partner?",
    a: "A computer opponent that plays at roughly the rating you choose. It's the same engine, softened to make human-like mistakes at lower ratings.",
  },
  {
    q: "Is my kid's data private?",
    a: "Yes. We only store what's needed to make reports and training cards, and we never sell data. See the privacy policy for details.",
  },
  {
    q: "How do I cancel my subscription?",
    a: "Cancel anytime from the billing section of your profile. You keep access until the end of the period you've already paid for.",
  },
];

export default function FaqPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Frequently asked questions"
        description="Quick answers about reports, credits, and the practice tools."
      />
      <div className="space-y-4">
        {FAQS.map((f) => (
          <div key={f.q} className="card p-5">
            <h2 className="font-semibold text-slate-900">{f.q}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{f.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
