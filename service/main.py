"""FastAPI service that exposes the analysis + OCR pipeline to the Next.js app.

Run with:

    uvicorn service.main:app --reload --port 8000

The two pipeline modules (chessintel_clone.py, scoresheet_ocr.py) live in the
repo root, one directory above this file, so we prepend the repo root to
sys.path before importing them.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# Make the repo root importable so we can import the two pipeline modules.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import chessintel_clone  # noqa: E402
import scoresheet_ocr  # noqa: E402
from fastapi import FastAPI, File, Form, UploadFile  # noqa: E402
from pydantic import BaseModel  # noqa: E402

app = FastAPI(title="Chess Coach Report Pipeline", version="1.0.0")


class HistoryEntry(BaseModel):
    habit: str
    points_lost: float
    held: Optional[bool] = None
    date: Optional[str] = None


class AnalyzeRequest(BaseModel):
    platform: str
    username: str
    kid_name: str = "Player"
    max_games: int = 50
    since_days: int = 30
    notes: Optional[str] = None
    answers: Optional[List[str]] = None
    rating: Optional[int] = None
    history: Optional[List[HistoryEntry]] = None


class AnalyzePgnRequest(BaseModel):
    pgn: str
    kid_name: str = "Player"
    notes: Optional[str] = None
    answers: Optional[List[str]] = None
    side: Optional[str] = None  # "white" | "black" | None (auto-detect)
    usernames: Optional[List[str]] = None  # kid's platform usernames for auto-detect


class AskRequest(BaseModel):
    question: str
    kid_name: str = "Player"
    notes: Optional[str] = None


class PuzzleExplainRequest(BaseModel):
    fen: str = ""
    played_move: str
    solution_move: str = ""
    themes: List[str] = []
    kid_name: str = "Player"
    reveal: bool = False


class RepertoireSuggestRequest(BaseModel):
    fen: str
    num_moves: int = 5


class SparRequest(BaseModel):
    fen: str
    elo: int = 1200


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/analyze")
def analyze(req: AnalyzeRequest) -> Dict[str, Any]:
    """Run the full fetch -> engine -> aggregate -> report pipeline."""
    return chessintel_clone.run_analysis(
        req.platform,
        req.username,
        kid_name=req.kid_name,
        max_games=req.max_games,
        since_days=req.since_days,
        notes=req.notes,
        answers=req.answers,
        rating=req.rating,
        history=[h.model_dump() for h in req.history] if req.history else None,
    )


def _resolve_kid_color(report: Dict[str, Any], side: Optional[str],
                       usernames: Optional[List[str]]) -> Optional[str]:
    """Which side the kid played, from an explicit choice or a username match."""
    if side in ("white", "black"):
        return side
    white = (report.get("white") or "").strip().lower()
    black = (report.get("black") or "").strip().lower()
    for u in (usernames or []):
        u = (u or "").strip().lower()
        if not u:
            continue
        if u == white:
            return "white"
        if u == black:
            return "black"
    return None


@app.post("/analyze-pgn")
def analyze_pgn(req: AnalyzePgnRequest) -> Dict[str, Any]:
    """Analyze a single PGN (used after scoresheet OCR / paste) and build a report."""
    engine = chessintel_clone._open_engine()
    try:
        report = chessintel_clone.analyze_game(
            {"pgn": req.pgn, "source": "scoresheet", "external_id": ""},
            engine,
            chessintel_clone.ANALYSIS_DEPTH,
        )
    finally:
        try:
            engine.quit()
        except Exception:
            pass

    habits = chessintel_clone.aggregate_habits([report])
    top_habit = habits[0]["habit"] if habits else "Piece safety"
    kid_color = _resolve_kid_color(report, req.side, req.usernames)
    if kid_color == "white":
        points_lost = round(report.get("points_lost_white", 0.0), 2)
    elif kid_color == "black":
        points_lost = round(report.get("points_lost_black", 0.0), 2)
    else:
        points_lost = round(report.get("points_lost", 0.0), 2)
    context = chessintel_clone.build_report_context(
        [report], "scoresheet", "", top_habit, notes=req.notes, answers=req.answers,
        kid_color=kid_color,
    )
    markdown = chessintel_clone.generate_report(
        req.kid_name, top_habit, 1, context=context
    )

    return {
        "kid_name": req.kid_name,
        "platform": "scoresheet",
        "username": "",
        "kid_color": kid_color,
        "game_count": 1,
        "habit": top_habit,
        "summary_text": chessintel_clone._short_version(markdown),
        "report_markdown": markdown,
        "drill": chessintel_clone._make_drill(top_habit, context),
        "points_lost": points_lost,
        "games": [report],
    }


@app.post("/ask")
def ask(req: AskRequest) -> Dict[str, str]:
    """Answer a free-form chess question with no game required."""
    import llm  # noqa: F401

    system = (
        "You are a patient, expert chess coach for junior players and their "
        "parents. Answer clearly and concretely, under 250 words, in plain "
        "language. Use Markdown sparingly (bold, short lists)."
    )
    user = f"Player: {req.kid_name}.\nQuestion: {req.question}"
    if req.notes:
        user += f"\nContext: {req.notes}"
    try:
        answer = llm.complete(system, user)
        return {"answer": answer}
    except Exception as exc:  # pragma: no cover - depends on live keys
        return {"answer": f"Sorry — the coach is unreachable right now ({exc})."}


def _puzzle_explain_prompt(
    kid_name: str, themes: List[str], played_move: str, solution_move: str, reveal: bool
) -> str:
    """Build the coach prompt for a wrong puzzle move.

    Deliberately excludes the raw FEN: a language model cannot read a board
    position reliably. It gets the tactical themes (fork, skewer, mate, ...)
    and the move names, which is enough to explain the idea without inventing
    squares or pieces.
    """
    theme_text = ", ".join(themes) if themes else "tactics"
    if reveal:
        focus = (
            f"The correct move is {solution_move}. Explain the idea behind it and "
            f"why it works, using the theme(s): {theme_text}."
        )
    else:
        focus = (
            f"The correct idea is hidden. Give a hint toward the right idea using "
            f"the theme(s): {theme_text} — do NOT name the exact move."
        )
    return f"Player: {kid_name}.\nThey played {played_move}, which is not the solution.\n{focus}"


@app.post("/puzzle-explain")
def puzzle_explain(req: PuzzleExplainRequest) -> Dict[str, str]:
    """Explain a wrong move in a tactical puzzle (hint or full reveal)."""
    import llm  # noqa: F401

    system = (
        "You are a patient junior chess coach helping with a tactical puzzle. "
        "Be encouraging and concrete, under 120 words. Never invent a square, "
        "piece, or line that is not in the given moves or themes."
    )
    user = _puzzle_explain_prompt(
        req.kid_name, req.themes, req.played_move, req.solution_move, req.reveal
    )
    try:
        answer = llm.complete(system, user)
        return {"answer": answer}
    except Exception as exc:  # pragma: no cover - depends on live keys
        return {"answer": f"Sorry — the coach is unreachable right now ({exc})."}


@app.post("/repertoire-suggest")
def repertoire_suggest(req: RepertoireSuggestRequest) -> Dict[str, Any]:
    """Stockfish's top moves for a position, used by the repertoire builder."""
    try:
        board = chessintel_clone.chess.Board(req.fen)
    except Exception:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="invalid fen")
    engine = chessintel_clone._open_engine()
    try:
        moves = chessintel_clone.suggest_moves(
            engine, req.fen, chessintel_clone.ANALYSIS_DEPTH, num=req.num_moves
        )
    finally:
        try:
            engine.quit()
        except Exception:
            pass
    return {"fen": " ".join(board.fen().split()[:4]), "moves": moves}


@app.get("/daily-puzzle")
def daily_puzzle() -> Dict[str, Any]:
    """Today's puzzle. Lichess first; chess.com as a fallback.

    The browser must not call these APIs directly (ad-blockers and the VPS
    egress both mangle such requests), so this endpoint proxies them. Lichess
    is sometimes challenged from data-center IPs; chess.com is the reliable
    fallback (the game-fetch path already reaches it).
    """
    try:
        return _lichess_daily_puzzle()
    except Exception:
        return _chesscom_daily_puzzle()


def _lichess_daily_puzzle() -> Dict[str, Any]:
    import requests as _requests

    try:
        resp = _requests.get(
            "https://lichess.org/api/puzzle/daily",
            headers={"User-Agent": chessintel_clone.USER_AGENT},
            timeout=8,
        )
    except Exception as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail=f"Could not reach Lichess: {exc}")

    if resp.status_code != 200:
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail=f"Lichess returned {resp.status_code}")

    try:
        data = resp.json()
    except Exception:
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail="Lichess returned a non-JSON response")

    puzzle = data.get("puzzle") or {}
    game = data.get("game") or {}
    fen = puzzle.get("fen") or chessintel_clone._puzzle_fen(
        game.get("pgn") or "", puzzle.get("initialPly") or 0
    )
    solution = puzzle.get("solution") or []
    if not fen or not solution:
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail="Unexpected Lichess payload")

    return {
        "id": puzzle.get("id") or "",
        "rating": puzzle.get("rating") or 0,
        "themes": puzzle.get("themes") or [],
        "fen": fen,
        "solution": solution,
        "plays": puzzle.get("plays") or 0,
    }


def _chesscom_daily_puzzle() -> Dict[str, Any]:
    import requests as _requests

    try:
        resp = _requests.get(
            "https://api.chess.com/pub/puzzle",
            headers={"User-Agent": chessintel_clone.USER_AGENT},
            timeout=8,
        )
    except Exception as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail=f"Could not reach chess.com: {exc}")

    if resp.status_code != 200:
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail=f"chess.com returned {resp.status_code}")

    try:
        data = resp.json()
    except Exception:
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail="chess.com returned a non-JSON response")

    fen = (data.get("fen") or "").strip()
    solution = chessintel_clone._chesscom_puzzle_solution(data.get("pgn") or "")
    if not fen or not solution:
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail="Unexpected chess.com puzzle payload")

    return {
        "id": "chesscom-" + str(data.get("publish_time") or "daily"),
        "rating": 0,
        "themes": [data.get("title") or "daily"],
        "fen": fen,
        "solution": solution,
        "plays": 0,
    }


@app.post("/spar")
def spar(req: SparRequest) -> Dict[str, Any]:
    """One move for a human-like sparring partner at roughly ``req.elo``."""
    try:
        board = chessintel_clone.chess.Board(req.fen)
    except Exception:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="invalid fen")
    if board.is_game_over():
        return {"move_uci": None, "move_san": None, "game_over": True}
    engine = chessintel_clone._open_engine()
    try:
        move = chessintel_clone.spar_move(engine, req.fen, elo=req.elo)
    finally:
        try:
            engine.quit()
        except Exception:
            pass
    if move is None:
        return {"move_uci": None, "move_san": None, "game_over": True}
    return {"move_uci": move.uci(), "move_san": board.san(move), "game_over": False}


@app.post("/ocr")
async def ocr(image: UploadFile = File(...), kid_name: str = Form("")) -> Dict[str, str]:
    """Convert an uploaded scoresheet photo to PGN."""
    data = await image.read()
    pgn = scoresheet_ocr.scoresheet_to_pgn(data, kid_name=kid_name or None)
    return {"pgn": pgn}
