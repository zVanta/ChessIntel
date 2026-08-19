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



@app.post("/ocr")
async def ocr(image: UploadFile = File(...), kid_name: str = Form("")) -> Dict[str, str]:
    """Convert an uploaded scoresheet photo to PGN."""
    data = await image.read()
    pgn = scoresheet_ocr.scoresheet_to_pgn(data, kid_name=kid_name or None)
    return {"pgn": pgn}
