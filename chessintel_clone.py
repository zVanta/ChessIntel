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
import math
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
# Once the mover is already this far behind, later moves are noise — the game
# is decided, so don't flag them as fresh blunders.
DECISIVE_CP: int = 600

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
    # v2 PovScore has .pov(color) but no .score() method. Delegate to
    # python-chess's own Score.score(mate_score=...) conversion, which already
    # handles every mate case — including mate-in-0 (a delivered checkmate) —
    # with the correct sign: the mated side gets -10000, the winner +10000.
    if not (hasattr(score, "score") and callable(score.score)):
        return score.pov(color).score(mate_score=10000)

    # Raw score from White's perspective (v1 Score, or v2 Cp/Mate).
    if score.is_mate():
        # Score.mate(): positive => White mates, negative => Black mates.
        winner = chess.WHITE if score.mate() > 0 else chess.BLACK
        return 10000 if winner == color else -10000
    cp = score.score(mate_score=10000)
    return cp if color == chess.WHITE else -cp


# ---------------------------------------------------------------------------
# Move classification (winning-chances based)
#
# Thresholds and labels follow the Chesskit colour scheme as adopted by
# Macintosh-Fan/ChessIntelligence (MIT). A move's "advantage loss" is measured
# in winning-percentage points and bucketed into blunder / mistake / inaccuracy
# / okay / excellent / best. "Brilliant" and "perfect" require move-type
# detection and are intentionally omitted.
# ---------------------------------------------------------------------------

_CLASS_THRESHOLDS = [
    ("blunder", 20.0),
    ("mistake", 10.0),
    ("inaccuracy", 5.0),
    ("okay", 2.0),
    ("excellent", 0.0),
]


def _winning_chances(cp: float) -> float:
    """Map a centipawn score to a winning percentage (0–100)."""
    return 50.0 + 50.0 * (2.0 / (1.0 + math.exp(-0.00368208 * float(cp))) - 1.0)


def _classify_loss(loss_pct: float) -> str:
    """Classify an advantage loss (in win-% points) into a move-quality label."""
    for label, floor in _CLASS_THRESHOLDS:
        if loss_pct > floor:
            return label
    return "best"


def _accuracy_from_loss(loss_pct: float) -> float:
    """Map an advantage loss (win-%) to a 0–100 move accuracy (CAPS-style)."""
    acc = 103.1668 * math.exp(-0.04354 * max(0.0, float(loss_pct))) - 3.1669
    return max(0.0, min(100.0, acc))


# ---------------------------------------------------------------------------
# Tactical threat detection (hung pieces / forks) for blunder classification
# ---------------------------------------------------------------------------

_PIECE_VALUES = {"p": 1, "n": 3, "b": 3, "r": 5, "q": 9, "k": 0}


def _hanging_squares(board: chess.Board) -> List[chess.Square]:
    """Squares where the side that just moved has an en-prise piece.

    A piece is "hanging" when an enemy piece attacks it and it has fewer
    defenders than attackers (or no defender at all). Kings are excluded.
    """
    mover = not board.turn
    hanging: List[chess.Square] = []
    for square, piece in board.piece_map().items():
        if piece.color != mover or piece.piece_type == chess.KING:
            continue
        attackers = board.attackers(not mover, square)
        if not attackers:
            continue
        defenders = board.attackers(mover, square)
        if not defenders or len(defenders) < len(attackers):
            hanging.append(square)
    return hanging


# Value of a fork target when ranking forks. The king is priceless — a royal
# fork (a check that also attacks a piece) is the whole story, even though the
# king's material value is nil.
_FORK_TARGET_VALUE = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
    chess.KING: 100,
}


def _opponent_forks(board: chess.Board) -> List[Dict[str, Any]]:
    """Opponent moves where the *moved* piece attacks two or more of the
    mover's pieces (a fork). Kings count, so a check that also attacks a piece
    is a royal fork. Sorted most valuable first.

    Only the moved piece's own attacks count. Counting every square the whole
    army attacks after the move is what turned every quiet move (even ``Kh1``)
    into a "fork" — the bishops, knights and pawns keep their old attacks on
    the board no matter what moved.
    """
    opp = board.turn
    mover = not opp
    forks: List[Dict[str, Any]] = []
    for move in board.legal_moves:
        try:
            san = board.san(move)
        except Exception:
            san = move.uci()
        board.push(move)
        targets: List[chess.Square] = []
        moved_sq = move.to_square
        if board.piece_at(moved_sq) is not None:
            for square, piece in board.piece_map().items():
                if piece.color == mover and moved_sq in board.attackers(opp, square):
                    targets.append(square)
        if len(targets) >= 2:
            targets.sort(
                key=lambda s: _FORK_TARGET_VALUE.get(board.piece_at(s).piece_type, 0),
                reverse=True,
            )
            value = sum(
                _FORK_TARGET_VALUE.get(board.piece_at(s).piece_type, 0)
                for s in targets
            )
            forks.append({
                "san": san,
                "squares": [chess.square_name(s) for s in targets],
                "value": value,
            })
        board.pop()
    forks.sort(key=lambda f: -f["value"])
    return forks


def _blunder_threat(board_after: chess.Board) -> Optional[str]:
    """Classify the immediate tactical damage of a just-played move.

    Returns a short label ("hung a piece", "walked into a fork") or None when
    the mistake is not one of those two clean motifs.
    """
    board_after = board_after.copy()
    if _hanging_squares(board_after):
        return "hung a piece"
    if _opponent_forks(board_after):
        return "walked into a fork"
    return None


def _threat_detail(board_after: chess.Board) -> Optional[str]:
    """Plain-language detail of the tactical damage, computed in code.

    Used by the report so the LLM never has to read a raw FEN and hallucinate
    piece positions.
    """
    board = board_after.copy()
    hung = _hanging_squares(board)
    if hung:
        square = hung[0]
        piece = board.piece_at(square)
        name = chess.piece_name(piece.piece_type) if piece else "piece"
        return f"left a {name} on {chess.square_name(square)} hanging"
    forks = _opponent_forks(board)
    if forks:
        f = forks[0]
        named = []
        for square_name in f["squares"][:2]:
            piece = board.piece_at(chess.parse_square(square_name))
            pname = chess.piece_name(piece.piece_type) if piece else "piece"
            named.append(f"the {pname} on {square_name}")
        return f"the reply {f['san']} attacks {' and '.join(named)}"
    return None


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
    params = {"max": max_games, "since": since_ms, "pgnInJson": "true", "opening": "true"}
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
        opening = data.get("opening") or {}
        games.append({
            "source": "lichess",
            "external_id": str(data.get("id") or ""),
            "pgn": pgn,
            "white": (players.get("white") or {}).get("user", {}).get("name", "White"),
            "black": (players.get("black") or {}).get("user", {}).get("name", "Black"),
            "result": _lichess_result(data),
            "played_at": data.get("createdAt"),
            "opening": (opening.get("name") or "").strip() or None,
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
                "opening": _chesscom_opening(g.get("eco")),
            })
    return games[:max_games]


def _chesscom_opening(eco_url: Any) -> Optional[str]:
    """Extract a human opening name from a chess.com ``eco`` URL slug."""
    if not eco_url or not isinstance(eco_url, str):
        return None
    slug = eco_url.rstrip("/").rsplit("/", 1)[-1]
    words: List[str] = []
    for part in slug.split("-"):
        # The move sequence begins at the first token starting with a digit.
        if part and part[0].isdigit():
            break
        if part:
            words.append(part)
    name = " ".join(words).strip()
    return name or None


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

    def _header(key: str) -> Optional[str]:
        """A cleaned PGN header value, or None when absent or '?'."""
        if node is None:
            return None
        val = (node.headers.get(key) or "").strip()
        return val if val and val != "?" else None

    white = (game or {}).get("white") or _header("White")
    black = (game or {}).get("black") or _header("Black")
    result = (game or {}).get("result") or _header("Result")
    empty: Dict[str, Any] = {
        "source": (game or {}).get("source"),
        "external_id": (game or {}).get("external_id"),
        "white": white,
        "black": black,
        "result": result,
        "played_at": (game or {}).get("played_at"),
        "opening": (game or {}).get("opening"),
        "pgn": pgn,
        "blunders": [],
        "phase_blunders": {"opening": 0, "middlegame": 0, "endgame": 0},
        "points_lost": 0.0,
        "moves": 0,
        "acpl": 0,
        "evals": [],
        "class_counts": {},
        "class_counts_white": {},
        "class_counts_black": {},
        "accuracy": 0,
        "accuracy_white": 0,
        "accuracy_black": 0,
        "habit_tags": [],
    }
    if node is None:
        return empty

    board = chess.Board()
    blunders: List[Dict[str, Any]] = []
    total_cp_lost = 0
    total_cp_lost_all = 0
    total_moves = 0
    evals: List[List[Any]] = []
    class_counts: Dict[str, int] = {}
    class_white: Dict[str, int] = {}
    class_black: Dict[str, int] = {}
    accuracies: List[float] = []
    acc_white: List[float] = []
    acc_black: List[float] = []

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
        best_uci = None
        pv_line = None
        fen_before = board.fen()
        try:
            pv = info_before.get("pv") if isinstance(info_before, dict) else None
            if pv:
                best_san = board.san(pv[0])
                best_uci = pv[0].uci()
                tmp = board.copy()
                pv_sans = []
                for m in pv[:4]:
                    pv_sans.append(tmp.san(m))
                    tmp.push(m)
                pv_line = " ".join(pv_sans)
        except Exception:
            best_san = None
            best_uci = None
            pv_line = None
        board.push(move)
        try:
            info_after = engine.analyse(board, chess.engine.Limit(depth=depth))
            score_after = _score_to_cp(info_after["score"], mover)
        except Exception:
            score_after = score_before

        cp_loss = score_before - score_after
        # Playing the engine's own top move is never a blunder. Guard against
        # mate-score sign flips: delivering the mate Stockfish also found makes
        # score_after read as Mate(0), which would otherwise look like a loss.
        if best_uci is not None and move.uci() == best_uci:
            cp_loss = 0
        total_moves += 1
        total_cp_lost_all += max(0, cp_loss)
        evals.append([ply, score_after, best_uci])
        loss_pct = max(0.0, _winning_chances(score_before) - _winning_chances(score_after))
        class_label = _classify_loss(loss_pct)
        class_counts[class_label] = class_counts.get(class_label, 0) + 1
        bucket = class_white if mover == chess.WHITE else class_black
        bucket[class_label] = bucket.get(class_label, 0) + 1
        move_accuracy = _accuracy_from_loss(loss_pct)
        accuracies.append(move_accuracy)
        (acc_white if mover == chess.WHITE else acc_black).append(move_accuracy)
        if cp_loss >= BLUNDER_THRESHOLD_CP and score_before > -DECISIVE_CP:
            phase = phase_of(ply)
            # NOTE: board.san(move) already includes the correct check (+) /
            # checkmate (#) annotation, so never append another one.
            blunders.append({
                "ply": ply,
                "san": san,
                "best": best_san,
                "phase": phase,
                "cp_loss": cp_loss,
                "loss_pct": round(loss_pct, 1),
                "class": class_label,
                "fen": fen_before,
                "line": pv_line,
                "threat": _blunder_threat(board),
                "threat_detail": _threat_detail(board),
            })
            total_cp_lost += cp_loss

    phase_blunders = {"opening": 0, "middlegame": 0, "endgame": 0}
    for b in blunders:
        phase_blunders[b["phase"]] += 1

    return {
        "source": (game or {}).get("source"),
        "external_id": (game or {}).get("external_id"),
        "white": white,
        "black": black,
        "result": result,
        "played_at": (game or {}).get("played_at"),
        "opening": (game or {}).get("opening"),
        "pgn": pgn,
        "blunders": blunders,
        "phase_blunders": phase_blunders,
        "points_lost": round(total_cp_lost / 100.0, 2),
        "moves": total_moves,
        "acpl": round(total_cp_lost_all / max(1, total_moves)),
        "evals": evals,
        "class_counts": class_counts,
        "class_counts_white": class_white,
        "class_counts_black": class_black,
        "accuracy": round(sum(accuracies) / len(accuracies)) if accuracies else 0,
        "accuracy_white": round(sum(acc_white) / len(acc_white)) if acc_white else 0,
        "accuracy_black": round(sum(acc_black) / len(acc_black)) if acc_black else 0,
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
        threat = b.get("threat")
        if threat == "hung a piece":
            tags.append("Hung pieces")
        elif threat == "walked into a fork":
            tags.append("Fork awareness")
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
    "Hung pieces": (
        "Before every move, run a three-second 'is anything hanging?' scan over "
        "every piece you own — do 10 hang-check puzzles a day until it's automatic."
    ),
    "Fork awareness": (
        "After each opponent move, name every square their pieces attack; the "
        "moment one move hits two of your pieces at once, say 'fork!' and defend "
        "before touching anything."
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
        if best and best != san:
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


def _safe_best(moment: Dict[str, Any]) -> Optional[str]:
    """The engine's preferred move, or None when it equals the played move."""
    best = moment.get("best")
    return best if best and best != (moment.get("san") or "") else None

# Report document branding. Kept separate from any third-party product name —
# this is the app's own brand.
SITE_NAME: str = os.environ.get("SITE_NAME", "Checkmate Coach")
SITE_URL: str = os.environ.get("SITE_URL", "chess.njxai.com")
SITE_CONTACT: str = os.environ.get("SITE_CONTACT", "info@checkmatecoach.app")

_REPORT_DISCLOSURE = (
    "*Positions analyzed by Stockfish · coaching notes written by an AI assistant.*"
)


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
                         answers: Optional[List[str]] = None,
                         rating: Optional[int] = None,
                         history: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
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
            "opening": r.get("opening") or "",
            "points_lost": r.get("points_lost") or 0.0,
            "acpl": r.get("acpl") or 0,
            "accuracy": r.get("accuracy") or 0,
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
                "threat": b.get("threat"),
                "threat_detail": b.get("threat_detail"),
                "candidates": b.get("candidates") or [],
            })
        played = _played_date(r.get("played_at"))
        if played:
            dates.append(played)

    moments = sorted(moments, key=lambda m: -m["cp_loss"])[:4]
    acpl_values = [g["acpl"] for g in games_brief if g.get("acpl")]
    avg_acpl = round(sum(acpl_values) / len(acpl_values)) if acpl_values else 0
    acc_values = [g["accuracy"] for g in games_brief if g.get("accuracy")]
    avg_accuracy = round(sum(acc_values) / len(acc_values)) if acc_values else 0
    openings = sorted({g["opening"] for g in games_brief if g.get("opening")})

    # Which side of the board the kid plays (when the platform username tells us).
    uname = (username or "").strip().lower()
    kid_color: Optional[str] = None
    if uname:
        for r in reports:
            if (r.get("white") or "").strip().lower() == uname:
                kid_color = "white"
                break
            if (r.get("black") or "").strip().lower() == uname:
                kid_color = "black"
                break

    # Accuracy and move-quality, split by colour. A kid's report must never
    # claim the opponent's good moves as their own.
    acc_w = [r.get("accuracy_white") or 0 for r in reports]
    acc_b = [r.get("accuracy_black") or 0 for r in reports]
    accuracy_white = round(sum(acc_w) / len(acc_w)) if acc_w else 0
    accuracy_black = round(sum(acc_b) / len(acc_b)) if acc_b else 0

    class_counts: Dict[str, int] = {}
    class_white: Dict[str, int] = {}
    class_black: Dict[str, int] = {}
    for r in reports:
        for label, count in (r.get("class_counts") or {}).items():
            class_counts[label] = class_counts.get(label, 0) + int(count)
        for label, count in (r.get("class_counts_white") or {}).items():
            class_white[label] = class_white.get(label, 0) + int(count)
        for label, count in (r.get("class_counts_black") or {}).items():
            class_black[label] = class_black.get(label, 0) + int(count)

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
        "acpl": avg_acpl,
        "avg_accuracy": avg_accuracy,
        "kid_color": kid_color,
        "accuracy_white": accuracy_white,
        "accuracy_black": accuracy_black,
        "rating": rating,
        "openings": openings,
        "class_counts": class_counts,
        "class_counts_white": class_white,
        "class_counts_black": class_black,
        "games_brief": games_brief,
        "moments": moments,
        "notes": (notes or "").strip(),
        "answers": [str(a).strip() for a in (answers or []) if a and str(a).strip()],
        "history": history or [],
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
    "- NEVER describe the board or invent pieces, squares, or material. You have "
    "no board view — only the facts given (the played move, the engine's preferred "
    "move and line, the cost, and the 'what happened' note). Explain using exactly "
    "those facts; never add a square or piece that is not in them.\n"
    "- VARY YOUR WRITING: never repeat the same sentence opener, the same "
    "'Fix:' formula, or the same drill template twice. Every moment should read "
    "like a different paragraph, not a re-filled form. Vary how you deliver the "
    "takeaway — sometimes bold, sometimes a sentence, sometimes a question.\n"
    "- Be energetic and specific: short punchy sentences, occasional "
    "exclamation, real chess slang. No filler like 'chess is a game of...'.\n"
    "- Write so a kid and their parent can both follow it.\n"
    "- Never invent moves, names, ratings, dates, or match results; stick to "
    "the facts given. If a game's outcome is unknown, state the raw score "
    "(e.g. 'ended 1-0') — never claim a draw or a win that is not in the facts.\n"
    "- When a rating is given, pitch the vocabulary and depth to that level — "
    "simple words for beginners, sharper shorthand for stronger kids.\n"
    "- Use every extra fact you are given: move accuracy, the type of mistake "
    "(hung piece, fork), and alternative moves with their evaluations. Show "
    "the player what else was on the table.\n"
    "- The played move and the engine's preferred move are FIXED facts. Quote "
    "them exactly as given — never change, re-annotate, or invent a move, and "
    "never write the same move on both sides of 'instead of'. The moment "
    "headings already name the moves, so do not rename them, and never reuse "
    "the same moment for Moment 1 and Moment 2.\n"
    "- When past progress is given, reference it — name what improved and what "
    "came back, so the player sees their own trajectory across reports.\n"
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
        f"Recurring habit: {habit}",
        f"Suggested drill: {drill}",
    ]
    wins, losses, draws = ctx.get("wins") or 0, ctx.get("losses") or 0, ctx.get("draws") or 0
    if wins or losses or draws:
        facts.append(f"Results: {wins} wins, {losses} losses, {draws} draws")
    # Accuracy split by colour: the kid is never credited with the opponent's
    # good moves. When their side is unknown, show both colours honestly.
    kid_color = ctx.get("kid_color")
    acc_w = ctx.get("accuracy_white") or 0
    acc_b = ctx.get("accuracy_black") or 0
    if kid_color == "white" and acc_w:
        facts.append(f"Move accuracy (yours, playing White): {acc_w}%")
    elif kid_color == "black" and acc_b:
        facts.append(f"Move accuracy (yours, playing Black): {acc_b}%")
    elif acc_w or acc_b:
        facts.append(f"Move accuracy — White: {acc_w}%, Black: {acc_b}%")
    elif ctx.get("avg_accuracy"):
        facts.append(f"Average move accuracy (both sides): {ctx.get('avg_accuracy')}%")
    if ctx.get("rating"):
        facts.append(f"Player rating: ~{ctx['rating']}")
    openings = ctx.get("openings") or []
    if openings:
        facts.append("Openings played: " + ", ".join(openings[:6]))
    order = ["blunder", "mistake", "inaccuracy", "okay", "excellent", "best"]

    def _class_summary(counts: Dict[str, int]) -> str:
        return (
            ", ".join(f"{label}s: {counts.get(label, 0)}" for label in order if counts.get(label))
            or "no classified moves"
        )

    cc_w = ctx.get("class_counts_white") or {}
    cc_b = ctx.get("class_counts_black") or {}
    if cc_w or cc_b:
        if kid_color == "white":
            facts.append("Move quality (yours, playing White): " + _class_summary(cc_w))
        elif kid_color == "black":
            facts.append("Move quality (yours, playing Black): " + _class_summary(cc_b))
        else:
            facts.append(
                "Move quality — White: " + _class_summary(cc_w)
                + "; Black: " + _class_summary(cc_b)
            )
    elif ctx.get("class_counts"):
        facts.append(
            "Move quality across the set (both sides): "
            + _class_summary(ctx.get("class_counts") or {})
        )
    brief = ctx.get("games_brief") or []
    if brief:
        game_parts = []
        for g in brief[:12]:
            outcome = g.get("outcome")
            result = g.get("result") or "*"
            # 'unknown' means we cannot tell which side the kid played — state
            # the raw result rather than letting the writer invent win/loss/draw.
            outcome_txt = outcome if outcome and outcome != "unknown" else f"result {result}"
            seg = f"vs {g['opponent']} ({outcome_txt})"
            if g.get("opening"):
                seg += f", {g['opening']}"
            game_parts.append(seg)
        facts.append("Games: " + "; ".join(game_parts))
    moments = ctx.get("moments") or []
    if moments:
        facts.append("Key mistake moments (engine line included):")
        for m in moments:
            parts = [f"- {m['san']} at ply {m['ply']} ({m['phase']}, lost ~{m['cp_loss']} pawns)"]
            if m.get("best"):
                parts.append(f"engine preferred {m['best']}")
            if m.get("threat_detail"):
                parts.append(f"what happened: {m['threat_detail']}")
            elif m.get("threat"):
                parts.append(f"mistake type: {m['threat']}")
            candidates = m.get("candidates") or []
            if candidates:
                parts.append("alternative moves: " + ", ".join(
                    f"{c['san']} ({c['cp'] / 100.0:+.1f})" for c in candidates
                ))
            if m.get("line"):
                parts.append(f"engine line: {m['line']}")
            parts.append(f"opponent: {m['opponent']}")
            facts.append("; ".join(parts))
    if ctx.get("notes"):
        facts.append(f"Parent note: {ctx['notes']}")
    if ctx.get("answers"):
        facts.append("What the kid said after the game:")
        for i, a in enumerate(ctx["answers"], 1):
            facts.append(f"  {i}. {a}")
    history = ctx.get("history") or []
    if history:
        facts.append("Past progress across previous reports (oldest first):")
        for h in history:
            held = h.get("held")
            if held is True:
                status = "drill held at the next check"
            elif held is False:
                status = "drill came back at the next check"
            else:
                status = "not re-checked yet"
            when = f" ({h.get('date')})" if h.get("date") else ""
            facts.append(
                f"- {h.get('habit', '?')}{when}: {h.get('points_lost', 0)} points lost — {status}"
            )

    # Pre-fill the move placeholders with the actual facts so the LLM can only
    # write prose around them, never invent or misattribute a move.
    def _moment_label(m: Dict[str, Any]) -> str:
        label = m.get("san") or "?"
        best = m.get("best")
        opponent = m.get("opponent") or "your opponent"
        if best and best != (m.get("san") or ""):
            label += f" instead of {best}"
        return f"{label} (vs {opponent})"

    top_moment = moments[0] if moments else None
    second_moment = moments[1] if len(moments) > 1 else None
    seen_in = (
        f"Yes — {_moment_label(top_moment)}" if top_moment
        else "not this set — keep watching"
    )
    moment1 = _moment_label(top_moment) if top_moment else "— (no moments in this set)"
    moment2 = _moment_label(second_moment) if second_moment else "— (skip this heading)"

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
        "**Seen in this game:** {seen_in}  ",
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
        "### Moment 1 — {moment1}",
        "",
        "(Analyze this exact position like a coach: what was on the board, why "
        "the played move hurt, why the engine's move was better in concrete "
        "chess terms, and what to do differently next time. Phrase the takeaway "
        "naturally — don't reuse a fixed 'Fix:' formula.)",
        "",
        "### Moment 2 — {moment2}",
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
        _REPORT_DISCLOSURE,
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
    body = body.replace("{seen_in}", seen_in)
    body = body.replace("{moment1}", moment1)
    body = body.replace("{moment2}", moment2)

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
    """Deterministic markdown report used when no LLM is configured.

    Reads like a coach's letter, not a filled-in form: each moment is phrased
    differently, and a move is never pitted against itself.
    """
    platform = ctx.get("platform") or "online"
    date_range = ctx.get("date_range") or "recent games"
    wins = ctx.get("wins", 0)
    losses = ctx.get("losses", 0)
    draws = ctx.get("draws", 0)
    moments = ctx.get("moments") or []
    openings = ctx.get("openings") or []
    avg_accuracy = ctx.get("avg_accuracy") or 0

    def _plural(n: int, word: str) -> str:
        if n == 1:
            return f"1 {word}"
        return f"{n} {word}es" if word.endswith("s") else f"{n} {word}s"

    results = f"{_plural(wins, 'win')}, {_plural(losses, 'loss')}, {_plural(draws, 'draw')}"

    # ---- Short version ------------------------------------------------------
    if moments:
        top = moments[0]
        best_move = _safe_best(top)
        key = f"{top['san']}" + (f" (Stockfish preferred {best_move})" if best_move else "")
        short = (
            f"{kid_name} played {game_count} game{'s' if game_count != 1 else ''} this set — "
            f"{results}. The one pattern behind the points lost is \"{habit}\", and the "
            f"clearest example is {key} vs {top['opponent']}. This week is about a single "
            f"trainable habit: {habit}"
        )
    else:
        short = (
            f"{kid_name} played {game_count} game{'s' if game_count != 1 else ''} this set — "
            f"{results}. The pattern to track is \"{habit}\". This week is about one habit: {habit}"
        )

    # ---- What's working ------------------------------------------------------
    if openings:
        positives = (
            f"**The openings are a strength.** {kid_name} reached {', '.join(openings[:3])} "
            f"and played them confidently, and the {_plural(wins, 'win')} were converted "
            "cleanly. That foundation is real — it is exactly what the next habit builds on."
        )
    else:
        positives = (
            f"**Finishing wins.** {kid_name} converted {_plural(wins, 'winning game')} "
            "without giving the point back. That is a real skill, and the foundation to build on."
        )

    # ---- Moments, each phrased differently ----------------------------------
    moment_intros = [
        "The moment that shows the pattern most clearly.",
        "A second example, from a different game, tells the same story.",
        "One more — the same habit, in a different phase of the game.",
    ]
    moment_takeaways = [
        "The fix is the pause: before moving, name what the move actually improves.",
        "Same lesson, new shape — check what you leave behind before you commit.",
        "It keeps coming back to one thing: have a reason for the move, not just a move.",
    ]
    moment_blocks = []
    for i, m in enumerate(moments[:3]):
        san = m.get("san") or "?"
        best_move = _safe_best(m)
        opp = m.get("opponent") or "your opponent"
        phase = m.get("phase") or "middlegame"
        cost = m.get("cp_loss") or 0
        ply = m.get("ply")
        at = f" at ply {ply}" if ply else ""
        engine_part = f" Stockfish wanted {best_move} there." if best_move else ""
        moment_blocks.append(
            f"### {i + 1}. {moment_intros[i]}\n\n"
            f"In the {phase} against {opp}, {san}{at} cost about {cost} pawns.{engine_part} "
            f"{moment_takeaways[i]}"
        )

    # ---- Drill ----------------------------------------------------------------
    if moments:
        top = moments[0]
        best_move = _safe_best(top)
        if best_move:
            drill_steps = (
                f"**{habit} — the 15-minute sharpener**\n\n"
                f"1. Set up the position just before {top['san']} against {top['opponent']}.\n"
                f"2. Find the engine's move ({best_move}) and say out loud why it is safer.\n"
                f"3. Do the same for the other moments below.\n\n"
                f"**Got it when:** you name the safer move in under 10 seconds, 3 in a row.\n\n"
                f"{drill}"
            )
        else:
            drill_steps = (
                f"**{habit} — the 15-minute sharpener**\n\n"
                f"1. Set up the position just before {top['san']} against {top['opponent']}.\n"
                f"2. Name what the move leaves undefended.\n"
                f"3. Write down the safer alternative.\n\n"
                f"**Got it when:** you spot the hang before you move, 3 times in a row.\n\n"
                f"{drill}"
            )
    else:
        drill_steps = (
            f"**{habit} — the 15-minute sharpener**\n\n"
            f"1. Re-play each key moment on a board.\n"
            f"2. Name what the move leaves behind.\n"
            f"3. Write down the safer alternative.\n\n"
            f"**Got it when:** you can explain the fix in one sentence.\n\n"
            f"{drill}"
        )

    coach_brief = f"Pre-lesson brief: {kid_name}'s recurring leak is \"{habit}\"."
    if moments:
        coach_brief += " It showed up in: " + "; ".join(
            f"{m['san']} (ply {m['ply']}) vs {m['opponent']}" for m in moments[:3]
        ) + "."
    phase_word = "endgame" if (moments and moments[0].get("phase") == "endgame") else "middlegame"
    coach_brief += (
        f" At the next lesson, show a few {phase_word} positions and ask {kid_name} "
        "to name the danger squares before moving — ten focused minutes."
    )

    accuracy_note = f"Move accuracy averaged {avg_accuracy}%." if avg_accuracy else ""

    return "\n\n---\n\n".join([
        f"# {kid_name} — Game Set Report",
        f"{game_count} Online Games · {platform} · {date_range}",
        "## Short version",
        short,
        f"**Baseline read:** {game_count} recent online games  \n"
        f"**Pattern found:** {habit}  \n"
        f"**The habit to train:** {habit}  \n"
        "**Tracking:** Begins with this report",
        "## First, the wide view",
        (
            f"Across this set — {results} — the thing costing the most points is \"{habit}\". "
            f"{accuracy_note} It is a habit, not a talent ceiling, and habits are the most "
            "fixable thing in chess."
        ),
        "## What's working",
        positives,
        "## The patterns costing you points",
        *moment_blocks,
        "## Your bottleneck right now",
        (
            f"If you fix one thing this month, fix \"{habit}\". Everything else is already "
            "good enough to win; this is the one leak that shows up move after move."
        ),
        "## One drill for this week",
        drill_steps,
        "## For your coach",
        coach_brief,
        f"Questions? Email [{SITE_CONTACT}](mailto:{SITE_CONTACT})  \n"
        f"— The {SITE_NAME} team",
        _REPORT_DISCLOSURE,
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
    user_prompt = _report_user_prompt(kid_name, habit, game_count, drill, ctx)

    # Try the configured model first, then the fast DeepSeek model, and only
    # then the deterministic template. deepseek-reasoner can exceed the request
    # timeout on long prompts, and a failed or empty answer must never silently
    # downgrade the whole report to the formulaic fallback.
    for model in (None, "deepseek-chat"):
        try:
            text = llm.complete(
                _REPORT_SYSTEM,
                user_prompt,
                temperature=0.4,
                api_key=api_key,
                model=model,
            )
            cleaned = (text or "").strip()
            if cleaned:
                return cleaned
        except Exception:
            continue
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


def _analyze_candidates(engine: chess.engine.SimpleEngine, fen: str,
                        depth: int) -> List[Dict[str, Any]]:
    """Top alternative moves (Multi-PV) for a position, from the side to move."""
    try:
        board = chess.Board(fen)
    except Exception:
        return []
    turn = board.turn
    try:
        result = engine.analyse(board, chess.engine.Limit(depth=depth), multipv=3)
    except Exception:
        return []
    lines = result if isinstance(result, list) else [result]
    candidates: List[Dict[str, Any]] = []
    for info in lines:
        pv = info.get("pv") or []
        if not pv:
            continue
        try:
            san = board.san(pv[0])
        except Exception:
            san = pv[0].uci()
        candidates.append({
            "san": san,
            "uci": pv[0].uci(),
            "cp": _score_to_cp(info.get("score"), turn),
        })
    return candidates[:3]


def _enrich_blunders(reports: List[Dict[str, Any]],
                     engine: chess.engine.SimpleEngine, depth: int,
                     top_n: int = 4) -> None:
    """Attach candidate moves to the most costly blunders across the set."""
    blunders = [b for r in reports for b in (r.get("blunders") or [])]
    blunders.sort(key=lambda b: -(b.get("cp_loss") or 0))
    for b in blunders[:top_n]:
        fen = b.get("fen")
        if not fen:
            continue
        b["candidates"] = _analyze_candidates(engine, fen, depth)


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
                 answers: Optional[List[str]] = None,
                 rating: Optional[int] = None,
                 history: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
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
        try:
            _enrich_blunders(reports, engine, ANALYSIS_DEPTH)
        except Exception:
            pass
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
        reports, platform, username, top_habit, notes=notes, answers=answers,
        rating=rating, history=history,
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
