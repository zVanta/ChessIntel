# Checkmate Coach

**Stockfish-powered coaching reports for junior chess players.**

Checkmate Coach is an original, self-hostable web app that turns a kid's real
games into a plain-language coach report. A parent connects a chess.com or
Lichess account, uploads a photo of a paper scoresheet, or pastes a PGN — and
the app runs every game through Stockfish, finds the one recurring habit that's
costing points, and writes a GM-style report with player-specific drills. A
"memory loop" then checks whether each drill actually held in later games. A
practice suite — mistake cards, puzzles, an opening repertoire builder, and a
sparring partner — is built on top of the same engine analysis, so practice is
always grounded in the kid's own games.

It's a fully original product — original name, branding, copy, and design, with
no third-party branding or content. (The internal analysis module is named
`chessintel_clone.py`, but it's this project's own implementation.)

---

## What it does

- **Three ways to analyze a game** — online games (chess.com / Lichess), a photo
  of a paper scoresheet (OCR), or pasted PGN.
- **Engine-grounded reports** — every report cites the real position (FEN) and
  Stockfish's preferred line, copies move notation exactly, and explains *why*
  a move was better in concrete chess terms.
- **Move-by-move accuracy** — every move is scored 0–100 (CAPS-style) and
  rolled up per game, per color, and across the set.
- **Candidate-move comparison** — the costliest blunders are re-analyzed with
  Multi-PV, so the report lists Stockfish's top alternatives with evaluations,
  not just the single "best" move.
- **Tactical threat detection** — each blunder is classified as hanging a piece
  or walking into a fork. A fork is only claimed when it is the engine's actual
  best reply — never a speculative scan of every legal move — so the report
  never invents tactics. Feeds two habit tags ("Hung pieces", "Fork awareness")
  with their own drills.
- **ELO-aware coaching** — report vocabulary and depth are pitched to the kid's
  rating (online, USCF, or FIDE).
- **Lichess-style game viewer** — an interactive review board with an
  evaluation bar and the engine's best-move arrow.
- **Recurring-habit detection** — aggregates across a player's recent games to
  name the one pattern that keeps costing points.
- **Drill follow-up ("did it hold?")** — each new report compares against the
  kid's most recent prior report for the same habit.
- **Ask the coach** — an interactive chat on each report for follow-up
  questions.
- **Structured per-move explanations** — each key mistake is written as a
  "Moment" with four labeled beats: why it looked good, why it failed, the
  concept, and the pattern to remember.
- **Clock & reflex detection** — per-move clocks flag mistakes played in under
  three seconds, so "rushed" is diagnosed separately from "didn't know".
- **Practice suite** — mistake cards with spaced repetition (Woodpecker-style)
  and a "try the fix" board; Lichess daily puzzles with coach hints; an opening
  repertoire builder (Stockfish multi-PV + the Lichess opening explorer); and
  an Elo-scaled sparring partner.
- **Kid profiles** — age, USCF/FIDE/online ratings, focus notes, and linked
  chess.com / Lichess usernames.
- **Accounts & credits** — parent login, an admin panel for managing users, and
  a credit system where each analysis consumes a credit.
- **Self-serve funding** — users fund credits through Stripe ($20/mo adds 20
  credits); admins can also grant credits directly from the admin panel.
- **Report permissions** — users see and delete only their own reports; admins
  see every report.
- **Android app** — ships as a PWA plus a Trusted Web Activity (APK).
- **Privacy-first** — COPPA / GDPR-K aware; no analytics on child accounts.

---

## How it works

```
                  ┌──────────────────────────────────────────────┐
                  │               Next.js app (web)              │
                  │  pages: /  /login /dashboard /analyze        │
                  │         /reports /report/[id] /game/[id]     │
                  │         /progress /profile /admin            │
                  │         /train /puzzles /repertoire          │
                  │         /repertoire/[id] /sparring /faq      │
                  │         /onboard /privacy                    │
                  │  routes: /api/auth/* /api/kids/*             │
                  │          /api/analyze /api/analyze-pgn       │
                  │          /api/upload-scoresheet /api/ask     │
                  │          /api/jobs/* /api/progress/*         │
                  │          /api/train /api/puzzles             │
                  │          /api/puzzles/explain /api/spar      │
                  │          /api/repertoires/*                  │
                  │          /api/opening-explorer               │
                  │          /api/checkout /api/webhooks         │
                  │          /api/admin/users/*                  │
                  └───────┬───────────────┬──────────────────────┘
                          │ better-sqlite3│  HTTP (PYTHON_SERVICE_URL)
                          ▼               ▼
                     SQLite file    ┌──────────────────────────────┐
                     (DATABASE_PATH)│  FastAPI service             │
                                    │  service/main.py             │
                                    │  ┌────────────────────────┐  │
                                    │  │ chessintel_clone.py    │──┼─► Stockfish
                                    │  │  fetch → analyze →     │  │   engine
                                    │  │  aggregate → report    │  │
                                    │  ├────────────────────────┤  │
                                    │  │ scoresheet_ocr.py      │──┼─► Tesseract
                                    │  │  (photo → PGN)         │  │   OCR
                                    │  ├────────────────────────┤  │
                                    │  │ llm.py                 │──┼─► DeepSeek /
                                    │  │  (report + chat LLM)   │  │   LibreChat
                                    │  ├────────────────────────┤  │
                                    │  │ chess_agent.py         │──┼─► ChessAgent
                                    │  │  (MCP game fetch)      │  │   MCP server
                                    │  └────────────────────────┘  │
                                    └──────────────────────────────┘
```

### The pipeline

1. **Analyze** — `POST /api/analyze` (or `/api/analyze-pgn`) calls the FastAPI
   service, which runs `chessintel_clone.run_analysis`: fetch recent games,
   analyze each with Stockfish (`ANALYSIS_DEPTH=14`; a blunder is losing ≥ 250
   centipawns), score every move's accuracy, detect hung pieces and forks, and
   re-analyze the costliest blunders with Multi-PV for candidate moves. It then
   aggregates recurring habits and writes the report with an LLM
   (`deepseek-reasoner` by default, or a LibreChat gateway model), pitched to
   the kid's rating when one is set.
2. **Persist** — `lib/persist.ts` stores a `reports` row, one `games` row per
   game, and — via the **memory loop** — a `drill_followups` row comparing the
   new report to the kid's most recent prior report with the same habit
   (`held = points lost stayed the same or improved`).
3. **Scoresheet** — `POST /api/upload-scoresheet` forwards the photo to
   `POST /ocr` (`scoresheet_ocr.scoresheet_to_pgn`, Tesseract), then analyzes
   the resulting PGN through the same path.
4. **Ask the coach** — `POST /api/ask` answers a question about a report using
   the same LLM provider.
5. **Practice** — every report seeds the practice suite: blunders become
   spaced-repetition mistake cards (`/api/train`), and the repertoire builder
   reuses Stockfish multi-PV (`/api/repertoires/suggest`) plus the Lichess
   opening explorer (`/api/opening-explorer`).

Long-running analyses run as background jobs (`/api/jobs/[id]`) and are polled
by the client.

---

## Tech stack

| Layer | Tech |
| --- | --- |
| Web app | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS |
| Board viewer | chessground (Lichess's board) + chess.js |
| Data | SQLite via better-sqlite3 (schema auto-migrates on boot) |
| Analysis service | FastAPI, python-chess, Stockfish |
| OCR | Tesseract 5 |
| LLM | DeepSeek (default) or a LibreChat gateway endpoint |
| Game fetch | ChessAgent MCP server (optional; falls back to local fetch) |
| Auth | scrypt password hashing, HMAC-SHA256 session cookies, rate limiting |
| Billing | Stripe (optional; `BILLING_ENABLED`) |
| Deploy | Docker Compose (web + service) + native Cloudflare Tunnel |
| Mobile | PWA + Android TWA (Bubblewrap) |

---

## Getting started (development)

Prerequisites:

- **Node.js 18+** and npm
- **Python 3.9+**
- **Stockfish** engine on your `PATH` (or set `STOCKFISH_PATH`)
- **Tesseract OCR** binary (only needed for scoresheet photos), plus the
  Python packages in `requirements.txt`

```bash
# 1. Install JS dependencies
npm install

# 2. Install Python dependencies (recommended: a virtualenv)
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt

# 3. Copy env and fill in values
copy .env.example .env        # Windows

# 4. Start the Python pipeline service
npm run dev:service           # uvicorn service.main:app --reload --port 8000

# 5. In another terminal, start the web app
npm run dev                   # http://localhost:3000
```

Or run both at once:

```bash
npm run dev:all
```

## Environment variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_NAME` | Public site name shown in the UI |
| `DATABASE_PATH` | SQLite file path (`:memory:` for tests) |
| `AUTH_SECRET` | Signs login session cookies; empty = random per boot |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Admin account auto-created on first run |
| `PYTHON_SERVICE_URL` | Base URL of the FastAPI service (default `http://127.0.0.1:8000`) |
| `STOCKFISH_PATH` | Path to the Stockfish binary (default `stockfish`) |
| `AI_PROVIDER` | LLM provider: `deepseek` (default) or `librechat` |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` / `DEEPSEEK_BASE_URL` | DeepSeek endpoint settings |
| `LIBRECHAT_ENDPOINT` / `LIBRECHAT_API_KEY` / `LIBRECHAT_MODEL` | LibreChat gateway settings |
| `CHESS_AGENT_MCP_URL` | ChessAgent MCP server endpoint (game fetch/enrichment) |
| `BILLING_ENABLED` | Force funding on/off (auto-enables when Stripe keys are set) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID` | Stripe settings ($20/mo plan) |
| `FUNDING_CREDITS` | Credits granted each time the $20/mo plan is paid (default 20) |

## Billing & credits (Stripe)

Every account starts with one free report credit; each analysis then costs one
credit. Users fund their account from the Profile page through a $20/month
Stripe subscription — each paid month adds `FUNDING_CREDITS` (default 20)
credits, granted idempotently by the webhook. Admins can also grant credits
directly from the admin panel. To enable it, create a $20 recurring price in
the Stripe dashboard and set `STRIPE_PRICE_ID`, `STRIPE_SECRET_KEY`, and
`STRIPE_WEBHOOK_SECRET`. Test card: `4242 4242 4242 4242`.

## Deployment

Production runs two Docker Compose services — the Next.js web app (the only
public entrypoint) and the internal FastAPI service. HTTPS/DNS come from a
Cloudflare Tunnel that runs natively on the host (systemd `cloudflared`), not in
Docker. See `DEPLOY.md` for the full guide and `ANDROID.md` for building the
Android APK.

```bash
docker compose up -d --build
```

## Tests

```bash
pytest -q          # Python pipeline tests (mock HTTP + tesseract; no engine needed)
npm test           # vitest (API + migration tests)
npm run typecheck
npm run test:all   # pytest -q && vitest run
```

## Project layout

```
├── app/                      # Next.js App Router
│   ├── api/                  # Route handlers
│   │   ├── auth/             # register / login / logout / me
│   │   ├── kids/             # list + [id] (scoped to the logged-in user)
│   │   ├── admin/users/      # admin CRUD (+ [id])
│   │   ├── analyze/          # online-game analysis
│   │   ├── analyze-pgn/      # PGN analysis
│   │   ├── upload-scoresheet/# scoresheet photo → OCR → analyze
│   │   ├── ask/  report-ask/ # coach chat
│   │   ├── jobs/[id]/        # background job polling
│   │   ├── progress/[kidId]/ # drill follow-up history
│   │   ├── reports/          # list + [id] delete (ownership-scoped)
│   │   ├── train/            # mistake cards (GET due + POST review)
│   │   ├── puzzles/  puzzles/explain/  # Lichess daily puzzle + hints
│   │   ├── repertoires/      # repertoire CRUD + suggest + moves
│   │   ├── spar/             # Elo-scaled sparring move
│   │   ├── opening-explorer/ # Lichess opening database
│   │   ├── checkout/  webhooks/  # Stripe funding
│   ├── dashboard/  analyze/  progress/  profile/  reports/
│   ├── admin/  login/  report/[id]/  game/[id]/
│   ├── train/  puzzles/  repertoire/  repertoire/[id]/  sparring/  faq/
│   ├── onboard/  privacy/
│   ├── page.tsx              # landing
│   ├── layout.tsx  globals.css  manifest.ts
├── components/               # React components (client)
│   ├── AnalyzeForm.tsx       # scoresheet / online / PGN / ask form
│   ├── ScoreSheetUpload.tsx  # camera + gallery upload
│   ├── ChessGameViewer.tsx   # chessground review board (eval bar + best-move arrow)
│   ├── ReportChat.tsx        # interactive coach chat
│   ├── ProfileView.tsx       # kid + account management
│   ├── AdminPanel.tsx        # user/credit administration
│   ├── ReportsList.tsx       # report list + delete
│   ├── AddKidForm.tsx  KidList.tsx  ProgressView.tsx
│   ├── LoginForm.tsx  LogoutButton.tsx  PrintButton.tsx
│   ├── Sidebar.tsx  PageHeader.tsx  MobileNav.tsx  # app shell + shared header
│   └── ServiceWorkerRegister.tsx
├── lib/
│   ├── db.ts                 # SQLite schema + typed helpers (migrates on boot)
│   ├── persist.ts            # report persistence + memory loop
│   ├── python.ts             # FastAPI client
│   ├── lichess.ts            # Lichess opening explorer + daily puzzle
│   ├── auth.ts  password.ts  # sessions + scrypt hashing
│   ├── credits.ts  rateLimit.ts
│   ├── billing.ts  stripe.ts # funding gate + Stripe helpers
│   ├── jobs.ts  poll.ts      # background job helpers
│   ├── markdown.tsx          # XSS-safe markdown renderer
│   ├── validation.ts  types.ts
├── service/main.py           # FastAPI service (analyze, OCR, ask, puzzle-explain, repertoire-suggest, spar)
├── chessintel_clone.py       # analysis pipeline (fetch → engine → aggregate → report)
├── scoresheet_ocr.py         # scoresheet photo → PGN
├── chess_agent.py            # ChessAgent MCP client
├── llm.py                    # LLM provider (DeepSeek / LibreChat)
├── tests/                    # pytest + vitest suites
├── scripts/                  # Android icon + TWA build helpers
├── docker-compose.yml  web.Dockerfile  service.Dockerfile
├── requirements.txt          # pinned Python deps
├── package.json              # pinned JS deps
├── .env.example
├── PRIVACY.md  DEPLOY.md  ANDROID.md
└── README.md
```

## Privacy (COPPA / GDPR-K)

Child data is PII. Defaults are privacy-first: no analytics on child accounts,
per-player opt-in by a parent/guardian, and no email to minors. See
`PRIVACY.md` for the full policy.

## License

The project's own code is **MIT** — see `LICENSE`.

The frontend bundles [chessground](https://github.com/lichess-org/chessground)
(GPL-3.0-or-later) for the game-review board, so the distributed frontend as a
whole is licensed GPL-3.0-or-later. chessground's own license ships in
`node_modules/@lichess-org/chessground/LICENSE`.
