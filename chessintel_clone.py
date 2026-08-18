"""Analysis pipeline for junior chess coach reports.

This module fetches recent games from Lichess or chess.com, runs a Stockfish
engine analysis on each game, aggregates recurring mistakes ("habits"), and
produces a coach-style report (optionally via DeepSeek or LibreChat).

Environment variables
---------------------
STOCKFISH_PATH  : path to the Stockfish binary (default: "stockfish")
AI_PROVIDER     : "deepseek" (default) or "librechat". See llm.py for the
                  DEEPSEEK_* and LIBRECHAT_* connection variables.

CLI
---
    python chessintel_clone.py --platform lichess --username eric-rosen \
        --games 25 --kid Alice
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

import chess
import chess.engine
import chess.pgn
import llm
import requests


def _load_dotenv(path: str) -> None:
    """Minimal .env loader so the Python service reads the same config as Next."""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("export "):
                    line = line[len("export "):]
                if "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
    except OSError:
        pass


for _env_candidate in (".env", os.path.join(os.path.dirname(__file__), ".env")):
    _load_dotenv(_env_candidate)


STOCKFISH_PATH: str = os.environ.get("STOCKFISH_PATH", "stockfish")

# chess.com requires a descriptive User-Agent; the requests default is 403'd.
USER_AGENT: str = "CheckmateCoach/1.0 (https://github.com/zVanta/ChessIntel)"

ANALYSIS_DEPTH: int = int(os.environ.get("ANALYSIS_DEPTH", "14"))
BLUNDER_THRESHOLD_CP: int = 250

LICHESS_GAMES_URL: str = "https://lichess.org/api/games/user/{username}"
CHESSCOM_ARCHIVES_URL: str = "https://api.chess.com/pub/player/{username}/games/archives"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def phase_of(ply: int) -> str:
    """Return the game phase for a ply count.

    Opening: ply <= 20, endgame: ply >= 70, everything else is the middlegame.
    """
    if ply <= 20:
        return "opening"
    if ply >= 70:
        return "endgame"
    return "middlegame"


def _score_to_cp(score: Any, color: chess.Color) -> int:
    """Return an engine score in centipawns from ``color``'s perspective.

    Compatible with python-chess v1 (``Score`` with ``.white()``/``.score()``)
    and the v2 rewrite (``PovScore`` with ``.pov()``, and ``Cp``/``Mate``).
    """
    # v2 PovScore has .pov(color) but no .score() method.
    if not (hasattr(score, "score") and callable(score.score)):
        relative = score.pov(color)
        if relative.is_mate():
            return 10000 if relative.mate() > 0 else -10000
        return relative.score(mate_score=10000)

    # Raw score from White's perspective (v1 Score, or v2 Cp/Mate).
    if score.is_mate():
        # Score.mate(): positive => White mates, negative => Black mates.
        winner = chess.WHITE if score.mate() > 0 else chess.BLACK
        return 10000 if winner == color else -10000
    cp = score.score(mate_score=10000)
    return cp if color == chess.WHITE else -cp


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Game fetching
# ---------------------------------------------------------------------------

def fetch_lichess_games(username: str, max_games: int = 50, since_days: int = 30) -> List[Dict[str, Any]]:
    """Fetch recent games for a Lichess user.

    Returns a list of game dicts with keys: source, external_id, pgn, white,
    black, result, played_at.
    """
    since_ms = int((_now_utc() - timedelta(days=since_days)).timestamp() * 1000)
    url = LICHESS_GAMES_URL.format(username=username)
    params = {"max": max_games, "since": since_ms, "pgnInJson": "true"}
    resp = requests.get(
        url,
        params=params,
        headers={"Accept": "application/x-ndjson", "User-Agent": USER_AGENT},
        timeout=30,
    )
    resp.raise_for_status()

    games: List[Dict[str, Any]] = []
    for line in resp.text.splitlines():
        line = line.strip()
        if not line:
            continue
        data = json.loads(line)
        pgn = data.get("pgn") or data.get("moves") or ""
        if not pgn:
            continue
        players = data.get("players", {}) or {}
        games.append({
            "source": "lichess",
            "external_id": str(data.get("id") or ""),
            "pgn": pgn,
            "white": (players.get("white") or {}).get("user", {}).get("name", "White"),
            "black": (players.get("black") or {}).get("user", {}).get("name", "Black"),
            "result": _lichess_result(data),
            "played_at": data.get("createdAt"),
        })
        if len(games) >= max_games:
            break
    return games


def _lichess_result(data: Dict[str, Any]) -> str:
    status = data.get("status") or ""
    winner = data.get("winner")
    if status == "draw":
        return "1/2-1/2"
    if winner == "white":
        return "1-0"
    if winner == "black":
        return "0-1"
    return "*"


def fetch_chesscom_games(username: str, max_games: int = 50, since_days: int = 30) -> List[Dict[str, Any]]:
    """Fetch recent games for a chess.com user.

    Returns a list of game dicts with keys: source, external_id, pgn, white,
    black, result, played_at.
    """
    archives_resp = requests.get(
        CHESSCOM_ARCHIVES_URL.format(username=username),
        headers={"User-Agent": USER_AGENT},
        timeout=30,
    )
    archives_resp.raise_for_status()
    archives = archives_resp.json().get("archives", [])

    cutoff = _now_utc() - timedelta(days=since_days)
    games: List[Dict[str, Any]] = []
    # Archives are oldest-first; walk newest-first so we stop early.
    for archive_url in reversed(archives):
        if len(games) >= max_games:
            break
        month_resp = requests.get(archive_url, headers={"User-Agent": USER_AGENT}, timeout=30)
        month_resp.raise_for_status()
        month_games = month_resp.json().get("games", [])
        for g in reversed(month_games):
            if len(games) >= max_games:
                break
            end_time = g.get("end_time")
            if end_time:
                played = datetime.utcfromtimestamp(int(end_time)).replace(tzinfo=timezone.utc)
                if played < cutoff:
                    continue
            pgn = g.get("pgn") or ""
            if not pgn:
                continue
            games.append({
                "source": "chesscom",
                "external_id": str(g.get("url") or g.get("uuid") or ""),
                "pgn": pgn,
                "white": (g.get("white") or {}).get("username", "White"),
                "black": (g.get("black") or {}).get("username", "Black"),
                "result": _chesscom_result(g),
                "played_at": end_time,
            })
    return games[:max_games]


def _chesscom_result(g: Dict[str, Any]) -> str:
    white = (g.get("white") or {}).get("result")
    black = (g.get("black") or {}).get("result")
    if white == "win":
        return "1-0"
    if black == "win":
        return "0-1"
    if white in ("agreed", "repetition", "stalemate", "insufficient", "timevsinsufficient") or \
            black in ("agreed", "repetition", "stalemate", "insufficient", "timevsinsufficient"):
        return "1/2-1/2"
    return "*"


# ---------------------------------------------------------------------------
# Engine analysis
# ---------------------------------------------------------------------------

def analyze_game(game: Dict[str, Any], engine: chess.engine.SimpleEngine,
                 depth: int = ANALYSIS_DEPTH) -> Dict[str, Any]:
    """Analyze a single game (dict with a ``pgn`` key) with a chess engine.

    Returns a "report" dict describing blunders, phase breakdown, points lost
    and habit tags for this game.
    """
    pgn = (game or {}).get("pgn") or ""
    node = chess.pgn.read_game(io.StringIO(pgn))
    empty: Dict[str, Any] = {
        "source": (game or {}).get("source"),
        "external_id": (game or {}).get("external_id"),
        "white": (game or {}).get("white"),
        "black": (game or {}).get("black"),
        "result": (game or {}).get("result"),
        "played_at": (game or {}).get("played_at"),
        "pgn": pgn,
        "blunders": [],
        "phase_blunders": {"opening": 0, "middlegame": 0, "endgame": 0},
        "points_lost": 0.0,
        "habit_tags": [],
    }
    if node is None:
        return empty

    board = chess.Board()
    blunders: List[Dict[str, Any]] = []
    total_cp_lost = 0

    for ply, move in enumerate(node.mainline_moves(), start=1):
        mover = board.turn
        try:
            san = board.san(move)
        except Exception:
            san = str(move)
        try:
            info_before = engine.analyse(board, chess.engine.Limit(depth=depth))
            score_before = _score_to_cp(info_before["score"], mover)
        except Exception:
            score_before = 0
        best_san = None
        pv_line = None
        fen_before = board.fen()
        try:
            pv = info_before.get("pv") if isinstance(info_before, dict) else None
            if pv:
                best_san = board.san(pv[0])
                tmp = board.copy()
                pv_sans = []
                for m in pv[:4]:
                    pv_sans.append(tmp.san(m))
                    tmp.push(m)
                pv_line = " ".join(pv_sans)
        except Exception:
            best_san = None
            pv_line = None
        board.push(move)
        try:
            info_after = engine.analyse(board, chess.engine.Limit(depth=depth))
            score_after = _score_to_cp(info_after["score"], mover)
        except Exception:
            score_after = score_before

        cp_loss = score_before - score_after
        if cp_loss >= BLUNDER_THRESHOLD_CP:
            phase = phase_of(ply)
            # NOTE: board.san(move) already includes the correct check (+) /
            # checkmate (#) annotation, so never append another one.
            blunders.append({
                "ply": ply,
                "san": san,
                "best": best_san,
                "phase": phase,
                "cp_loss": cp_loss,
                "fen": fen_before,
                "line": pv_line,
            })
            total_cp_lost += cp_loss

    phase_blunders = {"opening": 0, "middlegame": 0, "endgame": 0}
    for b in blunders:
        phase_blunders[b["phase"]] += 1

    return {
        "source": (game or {}).get("source"),
        "external_id": (game or {}).get("external_id"),
        "white": (game or {}).get("white"),
        "black": (game or {}).get("black"),
        "result": (game or {}).get("result"),
        "played_at": (game or {}).get("played_at"),
        "pgn": pgn,
        "blunders": blunders,
        "phase_blunders": phase_blunders,
        "points_lost": round(total_cp_lost / 100.0, 2),
        "habit_tags": _tag_blunders(blunders),
    }


def _tag_blunders(blunders: List[Dict[str, Any]]) -> List[str]:
    """Map blunders to coarse habit tags (deterministic, no LLM needed)."""
    tags: List[str] = []
    for b in blunders:
        phase = b.get("phase", "middlegame")
        if phase == "opening":
            tags.append("Opening preparation")
        elif phase == "endgame":
            tags.append("Endgame technique")
        else:
            tags.append("Piece safety")
    # De-duplicate while preserving frequency order for aggregation.
    seen = set()
    result = []
    for t in tags:
        if t not in seen:
            seen.add(t)
            result.append(t)
    return result


# ---------------------------------------------------------------------------
# Habit aggregation
# ---------------------------------------------------------------------------

def aggregate_habits(reports: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Aggregate habit tags across per-game reports.

    Returns a list of {"habit": str, "count": int} dicts sorted by descending
    count (then alphabetically for determinism).
    """
    counts: Dict[str, int] = {}
    for report in reports:
        for tag in report.get("habit_tags", []) or []:
            counts[tag] = counts.get(tag, 0) + 1
    return [
        {"habit": habit, "count": count}
        for habit, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

_DRILLS: Dict[str, str] = {
    "Opening preparation": (
        "Rehearse your first ten moves in your two most common openings and write "
        "them down before checking the book — you pass when you nail all ten from "
        "memory."
    ),
    "Piece safety": (
        "Before every move, do a one-second 'hang check' for undefended pieces on "
        "both sides. Do 10 hang-check puzzles a day until the scan is automatic."
    ),
    "Endgame technique": (
        "Practice king-and-pawn endings and simple rook endings against the engine "
        "until you can win the same winning position three times in a row without "
        "slipping."
    ),
}

_DEFAULT_DRILL = (
    "Re-play the key mistake moments from this report on a board and write down a "
    "safer alternative for each one — you pass when you can spot the fix in under "
    "ten seconds."
)


def _make_drill(habit: str, ctx: Dict[str, Any]) -> str:
    """Build a player-specific drill from this report's actual key moments.

    Falls back to the generic habit drill only when there are no moments to
    reference (e.g. a game with no detected blunders).
    """
    moments = ctx.get("moments") or []
    if moments:
        top = moments[0]
        opponent = top.get("opponent") or "your opponent"
        san = top.get("san") or "that move"
        best = top.get("best")
        if best:
            return (
                f"In the game vs {opponent}, rewind to {san} and play {best} instead — "
                f"then say out loud why it's safer. Repeat for the other key moments "
                f"in this report until the check is automatic."
            )
        return (
            f"Set up the position just before {san} vs {opponent}, name what the move "
            f"left undefended, and find the safer alternative. Repeat for each key "
            f"moment in this report."
        )
    return _DRILLS.get(habit, _DEFAULT_DRILL)

# Report document branding. Kept separate from any third-party product name —
# this is the app's own brand.
SITE_NAME: str = os.environ.get("SITE_NAME", "Checkmate Coach")
SITE_URL: str = os.environ.get("SITE_URL", "chess.njxai.com")
SITE_CONTACT: str = os.environ.get("SITE_CONTACT", "info@checkmatecoach.app")


def _played_date(played_at: Any) -> Optional[datetime]:
    """Normalise an epoch (ms) or ISO timestamp to a timezone-aware datetime."""
    if played_at is None:
        return None
    if isinstance(played_at, (int, float)):
        try:
            seconds = float(played_at) / 1000.0 if float(played_at) > 1e12 else float(played_at)
            return datetime.utcfromtimestamp(seconds).replace(tzinfo=timezone.utc)
        except Exception:
            return None
    if isinstance(played_at, str):
        for fmt in ("%Y.%m.%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(played_at, fmt).replace(tzinfo=timezone.utc)
            except Exception:
                continue
    return None


def _outcome_for(report: Dict[str, Any], username: str) -> str:
    """Return 'win', 'loss', 'draw' or 'unknown' from the kid's perspective."""
    result = (report.get("result") or "").strip()
    if result == "1/2-1/2":
        return "draw"
    white = (report.get("white") or "").strip()
    black = (report.get("black") or "").strip()
    uname = (username or "").strip().lower()
    is_white = bool(uname) and white.lower() == uname
    is_black = bool(uname) and black.lower() == uname
    if result in ("1-0", "0-1"):
        if (result == "1-0" and is_white) or (result == "0-1" and is_black):
            return "win"
        if is_white or is_black:
            return "loss"
    return "unknown"


def _opponent_for(report: Dict[str, Any], username: str) -> str:
    white = (report.get("white") or "").strip()
    black = (report.get("black") or "").strip()
    uname = (username or "").strip().lower()
    if uname and black.lower() == uname:
        return white or "Opponent"
    return black or white or "Opponent"


def _date_range(dates: List[datetime]) -> str:
    if not dates:
        return "recent games"
    start, end = min(dates), max(dates)
    if start.date() == end.date():
        return start.strftime("%B %d, %Y")
    if start.year == end.year and start.month == end.month:
        return f"{start.strftime('%B')} {start.day}–{end.day}, {start.year}"
    if start.year == end.year:
        return f"{start.strftime('%B %d')} – {end.strftime('%B %d, %Y')}"
    return f"{start.strftime('%B %d, %Y')} – {end.strftime('%B %d, %Y')}"


def build_report_context(reports: List[Dict[str, Any]], platform: str,
                         username: str, habit: str,
                         notes: Optional[str] = None,
                         answers: Optional[List[str]] = None) -> Dict[str, Any]:
    """Summarise analysed games into a compact, LLM-ready context dict."""
    wins = losses = draws = 0
    games_brief: List[Dict[str, str]] = []
    moments: List[Dict[str, Any]] = []
    dates: List[datetime] = []

    for r in reports:
        outcome = _outcome_for(r, username)
        if outcome == "win":
            wins += 1
        elif outcome == "loss":
            losses += 1
        elif outcome == "draw":
            draws += 1
        opponent = _opponent_for(r, username)
        games_brief.append({
            "opponent": opponent,
            "outcome": outcome,
            "result": r.get("result") or "*",
        })
        for b in sorted(r.get("blunders") or [], key=lambda b: -(b.get("cp_loss") or 0))[:2]:
            moments.append({
                "san": b.get("san") or "?",
                "best": b.get("best"),
                "ply": b.get("ply"),
                "phase": b.get("phase") or "middlegame",
                "cp_loss": round((b.get("cp_loss") or 0) / 100.0, 1),
                "opponent": opponent,
                "fen": b.get("fen"),
                "line": b.get("line"),
            })
        played = _played_date(r.get("played_at"))
        if played:
            dates.append(played)

    moments = sorted(moments, key=lambda m: -m["cp_loss"])[:4]
    platform_label = {
        "chesscom": "Chess.com",
        "lichess": "Lichess",
    }.get(platform, platform or "online")

    return {
        "platform": platform_label,
        "game_count": len(reports),
        "wins": wins,
        "losses": losses,
        "draws": draws,
        "date_range": _date_range(dates),
        "habit": habit,
        "games_brief": games_brief,
        "moments": moments,
        "notes": (notes or "").strip(),
        "answers": [str(a).strip() for a in (answers or []) if a and str(a).strip()],
    }


_REPORT_SYSTEM = (
    "You are the head coach at {site_name} — a strong, plain-spoken chess coach "
    "who explains ideas the way a GM would: concrete, positional, and grounded "
    "in the actual position. You make kids better AND keep it fun, but you never "
    "write generic encouragement or fill in a form.\n\n"
    "Rules:\n"
    "- Ground every claim in the facts (played move, engine's preferred move, "
    "the engine's line, the position FEN, the cost in pawns, the opponent).\n"
    "- Copy move notation EXACTLY as given (+ / # / x / O-O / O-O-O). Never "
    "guess, add, or change it.\n"
    "- Read the FEN: describe the position truthfully — name squares, pawn "
    "structure, piece coordination, king activity, open files. Explain WHY the "
    "engine's move is better in concrete chess terms, not just that it is.\n"
    "- VARY YOUR WRITING: never repeat the same sentence opener, the same "
    "'Fix:' formula, or the same drill template twice. Every moment should read "
    "like a different paragraph, not a re-filled form. Vary how you deliver the "
    "takeaway — sometimes bold, sometimes a sentence, sometimes a question.\n"
    "- Be energetic and specific: short punchy sentences, occasional "
    "exclamation, real chess slang. No filler like 'chess is a game of...'.\n"
    "- Write so a kid and their parent can both follow it.\n"
    "- Never invent moves, names, ratings, or dates; stick to the facts given.\n"
    "- Write in Markdown, keep every heading and the '---' rules exactly as "
    "given, and vary the prose between them. Keep the report under ~700 words."
).replace("{site_name}", SITE_NAME)


def _report_user_prompt(kid_name: str, habit: str, game_count: int,
                        drill: str, ctx: Dict[str, Any]) -> str:
    facts = [
        f"Player: {kid_name}",
        f"Games reviewed: {game_count}",
        f"Platform: {ctx.get('platform')}",
        f"Date range: {ctx.get('date_range')}",
        f"Results: {ctx.get('wins')} wins, {ctx.get('losses')} losses, "
        f"{ctx.get('draws')} draws",
        f"Recurring habit: {habit}",
        f"Suggested drill: {drill}",
    ]
    brief = ctx.get("games_brief") or []
    if brief:
        facts.append("Games: " + "; ".join(
            f"vs {g['opponent']} ({g['outcome']}, {g['result']})"
            for g in brief[:12]
        ))
    moments = ctx.get("moments") or []
    if moments:
        facts.append("Key mistake moments (position + engine line included):")
        for m in moments:
            parts = [f"- {m['san']} at ply {m['ply']} ({m['phase']}, lost ~{m['cp_loss']} pawns)"]
            if m.get("best"):
                parts.append(f"engine preferred {m['best']}")
            if m.get("line"):
                parts.append(f"engine line: {m['line']}")
            if m.get("fen"):
                parts.append(f"position before move (FEN): {m['fen']}")
            parts.append(f"opponent: {m['opponent']}")
            facts.append("; ".join(parts))
    if ctx.get("notes"):
        facts.append(f"Parent note: {ctx['notes']}")
    if ctx.get("answers"):
        facts.append("What the kid said after the game:")
        for i, a in enumerate(ctx["answers"], 1):
            facts.append(f"  {i}. {a}")

    template = [
        "# {kid} — Game Set Report",
        "",
        "{count} Online Games · {platform} · {date_range}",
        "",
        "---",
        "",
        "## Short version",
        "",
        "(2–4 punchy sentences: open with a hook about this set, name the one "
        "pattern, and name the habit to build. Make it feel like a coach hyping "
        "their player before a training session.)",
        "",
        "---",
        "",
        "**Baseline read:** {count} recent online games  ",
        "**Pattern found:** {habit}  ",
        "**Seen in this game:** Yes — <move> vs <opponent> (or “not this set” if it didn't fire)  ",
        "**The habit to train:** <one punchy, concrete sentence>  ",
        "**Tracking:** Begins with this report  ",
        "",
        "---",
        "",
        "## First, the wide view",
        "",
        "(Two short paragraphs: what the player is genuinely good at, then where "
        "points slip away. Name real games/moves from the facts, and say it with "
        "energy — a scouting report, not a form letter.)",
        "",
        "---",
        "",
        "## Now, the games you sent us",
        "",
        "(One paragraph on this set's results and time controls — call out the "
        "best win and the loss that mattered.)",
        "",
        "---",
        "",
        "## What's working",
        "",
        "(Two or three bold-led short paragraphs naming real strengths with game "
        "examples, written like a coach high-fiving the kid.)",
        "",
        "---",
        "",
        "## The pattern: {habit}",
        "",
        "The baseline showed this, and it fired again in this set.",
        "",
        "### Moment 1 — <bad move> instead of <better move> (vs <opponent>)",
        "",
        "(Analyze this exact position like a coach: what was on the board, why "
        "the played move hurt, why the engine's move was better in concrete "
        "chess terms, and what to do differently next time. Phrase the takeaway "
        "naturally — don't reuse a fixed 'Fix:' formula.)",
        "",
        "### Moment 2 — <bad move> instead of <better move> (vs <opponent>)",
        "",
        "(Analyze a different moment from the facts, written differently from "
        "Moment 1. Skip this heading entirely if there is only one moment.)",
        "",
        "---",
        "",
        "## The recurring weakness across the set",
        "",
        "(Summarise the pattern across the set in plain language and name the "
        "simple fix — one sentence the kid can repeat to themselves.)",
        "",
        "---",
        "",
        "## One drill for this week",
        "",
        "**<Drill title — make it sound fun>**",
        "",
        "(A short, concrete, game-specific drill. Steps are fine, but phrase "
        "them naturally and tie them to this report's actual moments. Add a way "
        "to know it worked.)",
        "",
        "---",
        "",
        "## For your coach",
        "",
        "(A pre-lesson brief for the coach: the student's recurring pattern, the "
        "specific games/moves where it appeared, what to watch for at the next "
        "lesson, and one 10-minute exercise to run first.)",
        "",
        "---",
        "",
        "Questions? Email [" + SITE_CONTACT + "](mailto:" + SITE_CONTACT + ")",
        "— The " + SITE_NAME + " team",
        "",
        "---",
        "",
        "*One more thing: online games show habits, but tournament games are where "
        "they cost points. Photograph a scoresheet or paste a PGN on the Analyze "
        "page and the next report reads the real over-the-board play.*",
    ]

    body = "\n".join(template).replace("{kid}", kid_name).replace("{count}", str(game_count))
    body = body.replace("{platform}", ctx.get("platform") or "online")
    body = body.replace("{date_range}", ctx.get("date_range") or "recent games")
    body = body.replace("{habit}", habit)

    return (
        "\n".join(facts)
        + "\n\nOutput ONLY Markdown. Keep every heading, the '---' rules and the "
        "bullet labels exactly as given; fill the prose between them. Replace the "
        "<...> placeholders with specifics from the facts. End each '**Label:**' "
        "stat line with two trailing spaces so it renders on its own line.\n\n"
        + body
    )


def _build_markdown_report(kid_name: str, habit: str, game_count: int,
                           drill: str, ctx: Dict[str, Any]) -> str:
    """Deterministic markdown report used when no LLM is configured."""
    platform = ctx.get("platform") or "online"
    date_range = ctx.get("date_range") or "recent games"
    wins = ctx.get("wins", 0)
    losses = ctx.get("losses", 0)
    draws = ctx.get("draws", 0)
    brief = ctx.get("games_brief") or []
    moments = ctx.get("moments") or []

    if moments:
        top = moments[0]
        best = f" instead of {top['best']}" if top.get("best") else ""
        seen_line = f"Yes — {top['san']}{best} vs {top['opponent']}"
    else:
        seen_line = "Not in this set — keep watching"

    opponent_lines = "  \n".join(
        f"vs {g['opponent']} — {g['result']}" for g in brief[:12]
    ) or "No game details available."

    moment_blocks = []
    for i, m in enumerate(moments[:3], 1):
        best_heading = f" instead of {m['best']}" if m.get("best") else ""
        best_body = f" The engine wanted {m['best']}." if m.get("best") else ""
        fix_line = (
            f"**Fix:** before you play a move like {m['san']}, stop and name what it "
            f"leaves behind — then find {m['best']}." if m.get("best") else
            f"**Fix:** before you play {m['san']}, pause and name the piece it leaves "
            "undefended."
        )
        moment_blocks.append(
            f"### Moment {i} — {m['san']}{best_heading} (vs {m['opponent']})\n\n"
            f"In the {m['phase']} against {m['opponent']}, {m['san']} at ply "
            f"{m['ply']} cost about {m['cp_loss']} pawns.{best_body} That's the "
            f"kind of move that feels fine and then quietly loses the game.\n\n"
            f"{fix_line}"
        )

    # Build a drill that references this game's actual key moment.
    if moments:
        top = moments[0]
        if top.get("best"):
            drill_steps = (
                f"**{habit} — the 15-minute sharpener**\n\n"
                f"1. Set up the position just before {top['san']} in this game.\n"
                f"2. Find the engine's move ({top['best']}) and say out loud why it's safer.\n"
                f"3. Do the same for the other moments below.\n\n"
                f"**Got it when:** you name the safer move in under 10 seconds, 3 in a row.\n\n"
                f"{drill}"
            )
        else:
            drill_steps = (
                f"**{habit} — the 15-minute sharpener**\n\n"
                f"1. Set up the position just before {top['san']} in this game.\n"
                f"2. Name what the move leaves undefended.\n"
                f"3. Write down the safer alternative.\n\n"
                f"**Got it when:** you spot the hang before you move, 3 times in a row.\n\n"
                f"{drill}"
            )
    else:
        drill_steps = (
            f"**{habit} — the 15-minute sharpener**\n\n"
            f"1. Re-play each key mistake moment on a board.\n"
            f"2. Name what the move leaves behind.\n"
            f"3. Write down the safer alternative.\n\n"
            f"**Got it when:** you can explain the fix in one sentence.\n\n"
            f"{drill}"
        )

    short_top = ""
    if moments:
        m = moments[0]
        short_top = (
            f" The key moment: {m['san']}"
            + (f" instead of {m['best']}" if m.get("best") else "")
            + f" vs {m['opponent']}."
        )

    return "\n\n---\n\n".join([
        f"# {kid_name} — Game Set Report",
        f"{game_count} Online Games · {platform} · {date_range}",
        (
            "## Short version"
        ),
        (
            f"{kid_name} played {game_count} game{'s' if game_count != 1 else ''} this set — "
            f"{wins} win{'s' if wins != 1 else ''}, {losses} loss{'es' if losses != 1 else ''}, "
            f"{draws} draw{'s' if draws != 1 else ''}. The big pattern: \"{habit}\"."
            f"{short_top} This week is about one simple habit: {drill}"
        ),
        (
            f"**Baseline read:** {game_count} recent online games  \n"
            f"**Pattern found:** {habit}  \n"
            f"**Seen in this game:** {seen_line}  \n"
            f"**The habit to train:** {drill}  \n"
            "**Tracking:** Begins with this report"
        ),
        (
            "## First, the wide view"
        ),
        (
            f"Before this set we reviewed {game_count} of {kid_name}'s recent games. "
            f"The good news: the wins are real and the finishes are clean. The thing "
            f"costing the most points is \"{habit}\" — and it shows up move after move, "
            "which means it's a habit, not a talent ceiling. Habits are fixable, and "
            "that's exactly what we train this week."
        ),
        (
            "## Now, the games you sent us"
        ),
        (
            f"This set covers {game_count} games ({platform}, {date_range}). "
            f"Results: {wins} win{'s' if wins != 1 else ''}, "
            f"{losses} loss{'es' if losses != 1 else ''}, "
            f"{draws} draw{'s' if draws != 1 else ''}.\n\n"
            f"Opponents:\n\n{opponent_lines}"
        ),
        (
            "## What's working"
        ),
        (
            "**Converting wins.** When the position is good, the finish is clean — "
            f"{kid_name} converted {wins} winning game{'s' if wins != 1 else ''} without "
            "giving the point back. That's a real skill, and it's the foundation we "
            "build on."
        ),
        (
            f"## The pattern: {habit}"
        ),
        (
            "The baseline showed this, and it's the pattern to track going forward."
        ),
        *moment_blocks,
        (
            "## The recurring weakness across the set"
        ),
        (
            f"\"{habit}\" is the habit that costs the most points. The fix is simple "
            "in concept: before every move, take one second to check what the move "
            "leaves behind. One second, every move — that's the whole assignment."
        ),
        (
            "## One drill for this week"
        ),
        (
            drill_steps
        ),
        (
            "## For your coach"
        ),
        (
            f"Pre-lesson brief: {kid_name}'s recurring leak is \"{habit}\". "
            + (
                " It showed up in: " + "; ".join(
                    f"{m['san']} (ply {m['ply']}) vs {m['opponent']}" for m in moments[:3]
                ) + "."
                if moments else ""
            )
            + " At the start of the next lesson, show a few middlegame positions and ask "
            f"{kid_name} to name the danger squares before moving — ten focused minutes "
            "will sharpen the reflex."
        ),
        (
            f"Questions? Email [{SITE_CONTACT}](mailto:{SITE_CONTACT})  \n"
            f"— The {SITE_NAME} team"
        ),
        (
            "*One more thing: online games show habits, but tournament games are where "
            "they cost points. Photograph a scoresheet or paste a PGN on the Analyze "
            "page and the next report reads the real over-the-board play.*"
        ),
    ])


def generate_report(kid_name: str, habit: str, game_count: int,
                    api_key: Optional[str] = None,
                    context: Optional[Dict[str, Any]] = None) -> str:
    """Generate a full markdown coach report for a kid.

    Uses the configured LLM provider (DeepSeek by default, or LibreChat — see
    llm.py); otherwise returns a deterministic fallback report.
    """
    ctx = context or {
        "platform": "online",
        "date_range": "recent games",
        "wins": 0,
        "losses": 0,
        "draws": 0,
        "games_brief": [],
        "moments": [],
        "notes": "",
        "answers": [],
    }
    drill = _make_drill(habit, ctx)
    fallback = _build_markdown_report(kid_name, habit, game_count, drill, ctx)

    try:
        text = llm.complete(
            _REPORT_SYSTEM,
            _report_user_prompt(kid_name, habit, game_count, drill, ctx),
            temperature=0.4,
            api_key=api_key,
        )
        cleaned = (text or "").strip()
        return cleaned or fallback
    except Exception:
        return fallback


# ---------------------------------------------------------------------------
# Pipeline orchestration
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# ChessAgent MCP integration (best-effort)
# ---------------------------------------------------------------------------

def _mcp_game_to_internal(game: Dict[str, Any]) -> Dict[str, Any]:
    white = game.get("white") or {}
    black = game.get("black") or {}
    return {
        "source": game.get("platform") or "unknown",
        "external_id": str(game.get("id") or game.get("url") or ""),
        "pgn": game.get("pgn") or "",
        "white": white.get("username", "White") if isinstance(white, dict) else "White",
        "black": black.get("username", "Black") if isinstance(black, dict) else "Black",
        "result": game.get("result", "*"),
        "played_at": game.get("utc_date") or game.get("end_time"),
    }


def _try_mcp_fetch(username: str, platform: str, max_games: int) -> Optional[List[Dict[str, Any]]]:
    """Fetch games via ChessAgent MCP; return None so callers can fall back."""
    try:
        import chess_agent  # type: ignore

        games = chess_agent.fetch_user_games(username, platform, max_games=max_games)
        mapped = [
            _mcp_game_to_internal(g)
            for g in games
            if isinstance(g, dict) and (g.get("pgn") or "").strip()
        ]
        if mapped:
            return mapped
    except Exception:
        pass
    return None


def _try_mcp_player(username: str) -> Optional[Dict[str, Any]]:
    try:
        import chess_agent  # type: ignore

        return chess_agent.player_lookup(username)
    except Exception:
        return None


def _open_engine(path: str = STOCKFISH_PATH) -> chess.engine.SimpleEngine:
    return chess.engine.SimpleEngine.popen_uci(path)


def _short_version(markdown: str) -> str:
    """Pull the '## Short version' paragraph out of a generated report."""
    marker = "## Short version"
    idx = markdown.find(marker)
    if idx == -1:
        return markdown.strip().splitlines()[0] if markdown.strip() else ""
    rest = markdown[idx + len(marker):]
    parts = rest.split("\n---")
    para = " ".join(
        line.strip() for line in parts[0].splitlines()
        if line.strip() and not line.strip().startswith("#")
    )
    return para or markdown.strip().splitlines()[0]


def run_analysis(platform: str, username: str, kid_name: str = "Player",
                 max_games: int = 50, since_days: int = 30,
                 engine: Optional[chess.engine.SimpleEngine] = None,
                 notes: Optional[str] = None,
                 answers: Optional[List[str]] = None) -> Dict[str, Any]:
    """Run the full intake pipeline and return a structured result.

    The result contains the full markdown report, a short summary text, the top
    recurring habit, suggested drill, total points lost and a per-game analysis
    list, ready to be persisted by the web app.
    """
    mcp_used = False
    games = _try_mcp_fetch(username, platform, max_games)
    if games:
        mcp_used = True
    elif platform == "lichess":
        games = fetch_lichess_games(username, max_games=max_games, since_days=since_days)
    elif platform == "chesscom":
        games = fetch_chesscom_games(username, max_games=max_games, since_days=since_days)
    else:
        raise ValueError(f"Unknown platform: {platform}")

    owns_engine = engine is None
    if owns_engine:
        engine = _open_engine()
    reports: List[Dict[str, Any]] = []
    try:
        for g in games:
            try:
                reports.append(analyze_game(g, engine, ANALYSIS_DEPTH))
            except Exception:
                # One unanalysable game should not fail the whole report.
                continue
    finally:
        if owns_engine and engine is not None:
            try:
                engine.quit()
            except Exception:
                pass

    habits = aggregate_habits(reports)
    top_habit = habits[0]["habit"] if habits else "Piece safety"
    points_lost = round(sum(r.get("points_lost", 0.0) for r in reports), 2)
    context = build_report_context(
        reports, platform, username, top_habit, notes=notes, answers=answers
    )
    markdown = generate_report(kid_name, top_habit, len(reports), context=context)

    result: Dict[str, Any] = {
        "kid_name": kid_name,
        "platform": platform,
        "username": username,
        "game_count": len(reports),
        "habit": top_habit,
        "summary_text": _short_version(markdown),
        "report_markdown": markdown,
        "drill": _make_drill(top_habit, context),
        "points_lost": points_lost,
        "games": reports,
        "mcp_used": mcp_used,
    }

    # Best-effort enrichment from ChessAgent (player profile + ratings).
    player = _try_mcp_player(username)
    if player:
        result["player"] = player

    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Generate a junior chess coach report.")
    parser.add_argument("--platform", required=True, choices=["lichess", "chesscom"])
    parser.add_argument("--username", required=True)
    parser.add_argument("--games", type=int, default=50)
    parser.add_argument("--kid", default="Player")
    parser.add_argument("--json", action="store_true", default=False,
                        help="Print the full result as JSON (default prints the summary).")
    args = parser.parse_args(argv)

    result = run_analysis(args.platform, args.username, kid_name=args.kid, max_games=args.games)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(result["summary_text"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
