"""Analysis pipeline for junior chess coach reports.

This module fetches recent games from Lichess or chess.com, runs a Stockfish
engine analysis on each game, aggregates recurring mistakes ("habits"), and
produces a coach-style report (optionally via an OpenAI-compatible LLM).

Environment variables
---------------------
STOCKFISH_PATH  : path to the Stockfish binary (default: "stockfish")
OPENAI_API_KEY  : optional, enables LLM-generated report summaries
LLM_MODEL       : LLM model name (default: "gpt-4o-mini")
LLM_BASE_URL    : OpenAI-compatible base URL ending in /v1
                  (default: "https://api.openai.com/v1"; set to your
                  LibreChat endpoint, e.g. "http://localhost:3080/v1")
LLM_ENDPOINT    : optional full endpoint URL. When set, it overrides
                  LLM_BASE_URL. Supports /chat/completions and /responses.

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
OPENAI_API_KEY: Optional[str] = os.environ.get("OPENAI_API_KEY")
LLM_MODEL: str = os.environ.get("LLM_MODEL", "gpt-4o-mini")
LLM_BASE_URL: str = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
LLM_ENDPOINT: Optional[str] = os.environ.get("LLM_ENDPOINT")

# chess.com requires a descriptive User-Agent; the requests default is 403'd.
USER_AGENT: str = "CheckmateCoach/1.0 (https://github.com/zVanta/ChessIntel)"

ANALYSIS_DEPTH: int = 18
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
        board.push(move)
        try:
            info_after = engine.analyse(board, chess.engine.Limit(depth=depth))
            score_after = _score_to_cp(info_after["score"], mover)
        except Exception:
            score_after = score_before

        cp_loss = score_before - score_after
        if cp_loss >= BLUNDER_THRESHOLD_CP:
            phase = phase_of(ply)
            blunders.append({
                "ply": ply,
                "san": san,
                "phase": phase,
                "cp_loss": cp_loss,
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
        "Before each game, rehearse your first ten moves against your two most "
        "common openings and write down the move you would play before checking "
        "the book answer."
    ),
    "Piece safety": (
        "Before every move, pause and scan for undefended pieces on both sides. "
        "Do 10 'hang check' puzzles a day until the scan becomes automatic."
    ),
    "Endgame technique": (
        "Practice king-and-pawn endings and simple rook endings against the "
        "engine until you can win a winning position three times in a row."
    ),
}

_DEFAULT_DRILL = (
    "Review the games from this report and re-play the key mistake moments on a "
    "board, writing down a safer alternative for each one."
)


def _llm_endpoint() -> str:
    """Return the LLM endpoint URL, preferring an explicit LLM_ENDPOINT."""
    explicit = os.environ.get("LLM_ENDPOINT")
    if explicit:
        return explicit
    return f"{LLM_BASE_URL}/chat/completions"


def _parse_responses(data: Dict[str, Any]) -> str:
    """Extract text from an OpenAI Responses-API-style payload."""
    for item in data.get("output", []) or []:
        if not isinstance(item, dict):
            continue
        # Standard shape: {"type": "message", "content": [{"type": "output_text", "text": ...}]}
        for part in item.get("content", []) or []:
            text = part.get("text") if isinstance(part, dict) else None
            if text:
                return str(text).strip()
        # Some servers return the text directly on the output item.
        text = item.get("text")
        if isinstance(text, str) and text.strip():
            return text.strip()
    for key in ("output_text", "text", "response", "content"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    choices = data.get("choices") or []
    if choices:
        message = choices[0].get("message", {}) or {}
        text = message.get("content", "")
        if isinstance(text, str) and text.strip():
            return text.strip()
    raise ValueError("Unrecognized LLM response shape")


def _call_llm(system: str, user: str, key: str) -> str:
    """Call an OpenAI-compatible endpoint (chat completions or responses)."""
    endpoint = _llm_endpoint()
    is_responses = endpoint.rstrip("/").endswith("/responses")
    headers = {"Authorization": f"Bearer {key}"}

    if is_responses:
        payload: Dict[str, Any] = {
            "input": f"{system}\n\n{user}",
            "stream": False,
            "max_output_tokens": 2000,
            "temperature": 0.7,
        }
        if LLM_MODEL:
            payload["model"] = LLM_MODEL
    else:
        payload = {
            "model": LLM_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.7,
        }

    resp = requests.post(endpoint, headers=headers, json=payload, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if is_responses:
        return _parse_responses(data)
    return data["choices"][0]["message"]["content"].strip()


def generate_report(kid_name: str, habit: str, game_count: int,
                    api_key: Optional[str] = None) -> str:
    """Generate a coach-style summary for a kid.

    Uses an OpenAI-compatible chat completion when ``api_key`` is provided;
    otherwise returns a deterministic fallback summary (no network needed).
    """
    drill = _DRILLS.get(habit, _DEFAULT_DRILL)
    fallback = (
        f"{kid_name} played {game_count} game{'s' if game_count != 1 else ''} in this "
        f"report period. The most recurring pattern was \"{habit}\". Suggested drill: "
        f"{drill}"
    )

    key = api_key or OPENAI_API_KEY
    if not key:
        return fallback

    try:
        text = _call_llm(
            "You write encouraging, specific coach reports for the parents "
            "of junior chess players. Keep it warm, concrete and under 120 words.",
            f"Kid: {kid_name}. Games reviewed: {game_count}. "
            f"Most recurring habit: {habit}. Suggested drill: {drill}. "
            f"Write a short parent-facing report.",
            key,
        )
        return text
    except Exception:
        return fallback


# ---------------------------------------------------------------------------
# Pipeline orchestration
# ---------------------------------------------------------------------------

def _open_engine(path: str = STOCKFISH_PATH) -> chess.engine.SimpleEngine:
    return chess.engine.SimpleEngine.popen_uci(path)


def run_analysis(platform: str, username: str, kid_name: str = "Player",
                 max_games: int = 50, since_days: int = 30,
                 engine: Optional[chess.engine.SimpleEngine] = None) -> Dict[str, Any]:
    """Run the full intake pipeline and return a structured result.

    The result contains the summary text, top recurring habit, suggested drill,
    total points lost and a per-game analysis list, ready to be persisted by
    the web app.
    """
    if platform == "lichess":
        games = fetch_lichess_games(username, max_games=max_games, since_days=since_days)
    elif platform == "chesscom":
        games = fetch_chesscom_games(username, max_games=max_games, since_days=since_days)
    else:
        raise ValueError(f"Unknown platform: {platform}")

    owns_engine = engine is None
    if owns_engine:
        engine = _open_engine()
    try:
        reports = [analyze_game(g, engine, ANALYSIS_DEPTH) for g in games]
    finally:
        if owns_engine and engine is not None:
            try:
                engine.quit()
            except Exception:
                pass

    habits = aggregate_habits(reports)
    top_habit = habits[0]["habit"] if habits else "Piece safety"
    points_lost = round(sum(r.get("points_lost", 0.0) for r in reports), 2)
    summary = generate_report(kid_name, top_habit, len(reports))

    return {
        "kid_name": kid_name,
        "platform": platform,
        "username": username,
        "game_count": len(reports),
        "habit": top_habit,
        "summary_text": summary,
        "drill": _DRILLS.get(top_habit, _DEFAULT_DRILL),
        "points_lost": points_lost,
        "games": reports,
    }


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
