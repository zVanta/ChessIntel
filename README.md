# Checkmate Coach

Automated coach reports for junior chess players — an original product (no
third-party branding, logos, copy, or design). Parents connect a kid's
chess.com / Lichess account (or upload a paper scoresheet photo), and the app
produces a plain-language report identifying one recurring habit, a focused
drill, and whether that drill "held" in later games.

**Business model:** first report per player is free (no card), then **$15/month
with no auto-renew**.

---

## Architecture

```
                 ┌──────────────────────────────────────────┐
                 │               Next.js app               │
                 │  pages: /  /dashboard  /onboard          │
                 │         /progress  /game/:id  /privacy   │
                 │  routes: /api/kids /api/analyze          │
                 │          /api/upload-scoresheet          │
                 │          /api/progress/[kidId]           │
                 │          /api/checkout /api/webhooks     │
                 └───────┬───────────────┬──────────────────┘
                         │ better-sqlite3│  HTTP (PYTHON_SERVICE_URL)
                         ▼               ▼
                    SQLite file    ┌─────────────────────────────┐
                    (DATABASE_PATH)│  FastAPI service            │
                                   │  service/main.py            │
                                   │  ┌───────────────────────┐  │
                                   │  │ chessintel_clone.py   │──┼──► Stockfish engine
                                   │  │  (fetch → analyze →   │  │
                                   │  │   aggregate → report) │  │
                                   │  ├───────────────────────┤  │
                                   │  │ scoresheet_ocr.py     │──┼──► Tesseract OCR
                                   │  │  (photo → PGN)        │  │
                                   │  └───────────────────────┘  │
                                   └─────────────────────────────┘
```

### How the pipeline connects

1. `POST /api/analyze` → Next calls the FastAPI service `POST /analyze`
   (`lib/python.ts`). The service imports `chessintel_clone.run_analysis`,
   which fetches recent games (Lichess or chess.com), runs Stockfish
   (`ANALYSIS_DEPTH=18`, `BLUNDER_THRESHOLD_CP=250`), aggregates recurring
   habits, and generates a summary (OpenAI-compatible if `OPENAI_API_KEY` is
   set, otherwise a deterministic fallback).
2. The result is persisted by `lib/persist.ts`: a `reports` row, one `games`
   row per game, and — via the **memory loop** — a `drill_followups` row
   comparing the kid's new report against their most recent prior report with
   the same habit (`held = points_lost stayed the same or improved`).
3. `POST /api/upload-scoresheet` → multipart photo is forwarded to the FastAPI
   service `POST /ocr` (`scoresheet_ocr.scoresheet_to_pgn`), then the PGN is
   analyzed via `POST /analyze-pgn` and persisted through the same path.
4. If the FastAPI service is unreachable, `lib/python.ts` falls back to
   spawning `python chessintel_clone.py --platform … --username … --games …
   --kid … --json` and parsing its stdout (analyze path only — OCR always
   needs the service).

---

## Prerequisites

- **Node.js 18+** and npm
- **Python 3.9+**
- **Stockfish** engine on your `PATH` (or set `STOCKFISH_PATH`)
- **Tesseract OCR** binary (only needed for scoresheet photos), plus the
  Python packages in `requirements.txt`

## Setup

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
| `PYTHON_SERVICE_URL` | Base URL of the FastAPI service (default `http://127.0.0.1:8000`) |
| `PYTHON_BIN` | Optional override for the `python` executable (CLI fallback) |
| `STOCKFISH_PATH` | Path to the Stockfish binary (default `stockfish`) |
| `OPENAI_API_KEY` | Optional — enables LLM summaries/repair; leave empty for deterministic output |
| `LLM_MODEL` | LLM model name (default `gpt-4o-mini`) |
| `STRIPE_SECRET_KEY` | Stripe secret key (test mode) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_PRICE_ID` | Recurring price ID for the $15/month subscription |

## Billing (Stripe, test mode)

1. In the Stripe dashboard, create a **recurring** price of $15/month and copy
   its `price_…` ID into `STRIPE_PRICE_ID`.
2. Set `STRIPE_SECRET_KEY` (starts with `sk_test_`).
3. Forward webhooks locally:

   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks
   ```

   Copy the printed `whsec_…` secret into `STRIPE_WEBHOOK_SECRET`.

4. **Test card:** `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.

The checkout route creates a Checkout session with `mode=subscription`,
`payment_behavior=allow_incomplete`, and `subscription_data.cancel_at_period_end
= true` — so the $15 plan **does not auto-renew**. A kid becomes `active` after
`checkout.session.completed` / `invoice.payment_succeeded` and is set to
`canceled` on `customer.subscription.deleted`. The first report per kid is
always free; later reports require an active subscription (`402` otherwise).

## Tests

```bash
# Python unit tests (mock HTTP + tesseract; no engine/binary needed)
pytest -q

# Next.js route test (POST /api/kids validation)
npm test          # vitest run

# Everything, in one command (requires pytest on PATH)
npm run test:all  # pytest -q && vitest run
```

## Project layout

```
├── app/                      # Next.js App Router
│   ├── api/                  # Route handlers
│   │   ├── analyze/route.ts
│   │   ├── checkout/route.ts
│   │   ├── kids/route.ts
│   │   ├── progress/[kidId]/route.ts
│   │   ├── upload-scoresheet/route.ts
│   │   └── webhooks/route.ts
│   ├── dashboard/page.tsx
│   ├── game/[id]/page.tsx    # chessboard game review
│   ├── onboard/page.tsx
│   ├── progress/page.tsx
│   ├── privacy/page.tsx
│   ├── page.tsx              # landing
│   ├── layout.tsx
│   └── globals.css
├── components/               # React components (client)
│   ├── ChessGameViewer.tsx
│   ├── AddKidForm.tsx
│   ├── KidList.tsx
│   ├── ProgressView.tsx
│   └── ScoreSheetUpload.tsx
├── lib/
│   ├── db.ts                 # SQLite schema + typed helpers (migrates on boot)
│   ├── persist.ts            # report persistence + memory loop
│   ├── python.ts             # FastAPI client (+ CLI fallback)
│   ├── billing.ts            # first-report-free / subscription gate
│   ├── stripe.ts
│   ├── validation.ts
│   └── types.ts
├── service/main.py           # FastAPI service wrapping the two pipeline modules
├── chessintel_clone.py       # analysis pipeline (fetch → engine → aggregate → report)
├── scoresheet_ocr.py         # scoresheet photo → PGN
├── tests/                    # pytest + vitest suites
├── requirements.txt          # pinned Python deps
├── package.json              # pinned JS deps
├── .env.example
├── PRIVACY.md
└── README.md
```

## Privacy (COPPA / GDPR-K)

Child data is PII. Defaults are privacy-first: no analytics on child accounts,
per-player opt-in by a parent/guardian, and no email to minors. See
`PRIVACY.md` for the full policy.
