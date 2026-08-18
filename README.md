# Checkmate Coach

**Stockfish-powered coaching reports for junior chess players.**

Checkmate Coach is an original, self-hostable web app that turns a kid's real
games into a plain-language coach report. A parent connects a chess.com or
Lichess account, uploads a photo of a paper scoresheet, or pastes a PGN — and
the app runs every game through Stockfish, finds the one recurring habit that's
costing points, and writes a GM-style report with player-specific drills. A
"memory loop" then checks whether each drill actually held in later games.

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
- **Recurring-habit detection** — aggregates across a player's recent games to
  name the one pattern that keeps costing points.
- **Drill follow-up ("did it hold?")** — each new report compares against the
  kid's most recent prior report for the same habit.
- **Ask the coach** — an interactive chat on each report for follow-up
  questions.
- **Kid profiles** — age, USCF/FIDE/online ratings, focus notes, and linked
  chess.com / Lichess usernames.
- **Accounts & credits** — parent login, an admin panel for managing users, and
  a credit system where each analysis consumes a credit (admins grant them).
- **Optional billing** — Stripe, $15/month with **no auto-renew**; the first
  report per kid is free.
- **Android app** — ships as a PWA plus a Trusted Web Activity (APK).
- **Privacy-first** — COPPA / GDPR-K aware; no analytics on child accounts.

---

## How it works

```
                  ┌──────────────────────────────────────────────┐
                  │               Next.js app (web)              │
                  │  pages: /  /login /dashboard /analyze        │
                  │         /progress /profile /admin            │
                  │         /report/[id] /game/[id] /onboard     │
                  │  routes: /api/auth/* /api/kids/*             │
                  │          /api/analyze /api/analyze-pgn       │
                  │          /api/upload-scoresheet /api/ask     │
                  │          /api/jobs/* /api/progress/*         │
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
   centipawns), aggregate recurring habits, and write the report with an LLM
   (`deepseek-chat` by default, or a LibreChat gateway model).
2. **Persist** — `lib/persist.ts` stores a `reports` row, one `games` row per
   game, and — via the **memory loop** — a `drill_followups` row comparing the
   new report to the kid's most recent prior report with the same habit
   (`held = points lost stayed the same or improved`).
3. **Scoresheet** — `POST /api/upload-scoresheet` forwards the photo to
   `POST /ocr` (`scoresheet_ocr.scoresheet_to_pgn`, Tesseract), then analyzes
   the resulting PGN through the same path.
4. **Ask the coach** — `POST /api/ask` answers a question about a report using
   the same LLM provider.

Long-running analyses run as background jobs (`/api/jobs/[id]`) and are polled
by the client.

---

## Tech stack

| Layer | Tech |
| --- | --- |
| Web app | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS |
| Data | SQLite via better-sqlite3 (schema auto-migrates on boot) |
| Analysis service | FastAPI, python-chess, Stockfish |
| OCR | Tesseract 5 |
| LLM | DeepSeek (default) or a LibreChat gateway endpoint |
| Game fetch | ChessAgent MCP server (optional; falls back to local fetch) |
| Auth | scrypt password hashing, HMAC-SHA256 session cookies, rate limiting |
| Billing | Stripe (optional; `BILLING_ENABLED`) |
| Deploy | Docker Compose (web + service + cloudflared), Cloudflare Tunnel |
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
| `BILLING_ENABLED` | Force paywall on/off (auto-enables when Stripe keys are set) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID` | Stripe billing settings |

## Billing (Stripe)

Billing is optional and off by default. When enabled, each kid's first report
is free and later reports require an active $15/month subscription that **does
not auto-renew** (the webhook sets `cancel_at_period_end` on subscription
creation). To enable it, create a recurring $15 price in the Stripe dashboard
and set `STRIPE_PRICE_ID`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`.
Test card: `4242 4242 4242 4242`.

## Deployment

Production runs as three Docker Compose services — the Next.js web app (the only
public entrypoint), the internal FastAPI service, and a Cloudflare Tunnel that
provides DNS + TLS with no inbound ports. See `DEPLOY.md` for the full guide and
`ANDROID.md` for building the Android APK.

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
│   │   ├── checkout/  webhooks/  # Stripe billing
│   ├── dashboard/  analyze/  progress/  profile/
│   ├── admin/  login/  report/[id]/  game/[id]/
│   ├── onboard/  privacy/
│   ├── page.tsx              # landing
│   ├── layout.tsx  globals.css  manifest.ts
├── components/               # React components (client)
│   ├── AnalyzeForm.tsx       # scoresheet / online / PGN / ask form
│   ├── ScoreSheetUpload.tsx  # camera + gallery upload
│   ├── ChessGameViewer.tsx   # chessboard game review
│   ├── ReportChat.tsx        # interactive coach chat
│   ├── ProfileView.tsx       # kid + account management
│   ├── AdminPanel.tsx        # user/credit administration
│   ├── AddKidForm.tsx  KidList.tsx  ProgressView.tsx
│   ├── LoginForm.tsx  LogoutButton.tsx  PrintButton.tsx
│   └── ServiceWorkerRegister.tsx
├── lib/
│   ├── db.ts                 # SQLite schema + typed helpers (migrates on boot)
│   ├── persist.ts            # report persistence + memory loop
│   ├── python.ts             # FastAPI client
│   ├── auth.ts  password.ts  # sessions + scrypt hashing
│   ├── credits.ts  rateLimit.ts
│   ├── billing.ts  stripe.ts # first-report-free / subscription gate
│   ├── jobs.ts  poll.ts      # background job helpers
│   ├── markdown.tsx          # XSS-safe markdown renderer
│   ├── validation.ts  types.ts
├── service/main.py           # FastAPI service wrapping the pipeline
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

MIT — see `LICENSE`.
