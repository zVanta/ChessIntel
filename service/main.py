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


class AnalyzeRequest(BaseModel):
    platform: str
    username: str
    kid_name: str = "Player"
    max_games: int = 50
    since_days: int = 30


class AnalyzePgnRequest(BaseModel):
    pgn: str
    kid_name: str = "Player"


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
    )


@app.post("/analyze-pgn")
def analyze_pgn(req: AnalyzePgnRequest) -> Dict[str, Any]:
    """Analyze a single PGN (used after scoresheet OCR) and build a report."""
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
    points_lost = round(report.get("points_lost", 0.0), 2)
    summary = chessintel_clone.generate_report(req.kid_name, top_habit, 1)

    return {
        "kid_name": req.kid_name,
        "platform": "scoresheet",
        "username": "",
        "game_count": 1,
        "habit": top_habit,
        "summary_text": summary,
        "drill": chessintel_clone._DRILLS.get(top_habit, chessintel_clone._DEFAULT_DRILL),
        "points_lost": points_lost,
        "games": [report],
    }


@app.post("/ocr")
async def ocr(image: UploadFile = File(...), kid_name: str = Form("")) -> Dict[str, str]:
    """Convert an uploaded scoresheet photo to PGN."""
    data = await image.read()
    pgn = scoresheet_ocr.scoresheet_to_pgn(data, kid_name=kid_name or None)
    return {"pgn": pgn}
