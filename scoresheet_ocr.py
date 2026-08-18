"""Scoresheet photo -> PGN.

Turns a photograph of a handwritten chess scoresheet into a PGN string using
OpenCV preprocessing + Tesseract OCR + a python-chess legality replay. If an
LLM API key is configured (DeepSeek or LibreChat — see llm.py), illegible or
illegal move cells are repaired via the configured provider.

Environment variables
---------------------
AI_PROVIDER     : "deepseek" (default) or "librechat". See llm.py for the
                  DEEPSEEK_* and LIBRECHAT_* connection variables.

Heavy dependencies (opencv-python-headless, numpy, pytesseract) are imported
lazily so the module can be imported and unit-tested without them.
"""

from __future__ import annotations

import os
import sys
from typing import Any, List, Optional, Sequence, Tuple

import llm
import requests

# Guarded import so the module imports cleanly when pytesseract is not present.
try:
    import pytesseract
except ImportError:  # pragma: no cover - exercised only without tesseract
    pytesseract = None  # type: ignore[assignment]

_TESSERACT_CONFIG = "-c tessedit_char_whitelist=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-=xO# --psm 6"


# ---------------------------------------------------------------------------
# Image pipeline
# ---------------------------------------------------------------------------

def _preprocess(image: Any) -> Any:
    """Load (bytes or path) and binarize the scoresheet image.

    Returns a binary image as a numpy array suitable for contour detection.
    """
    import cv2
    import numpy as np

    if isinstance(image, (str, os.PathLike)):
        img = cv2.imread(str(image), cv2.IMREAD_GRAYSCALE)
    else:
        buf = np.frombuffer(image, dtype=np.uint8)
        img = cv2.imdecode(buf, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError("Could not read scoresheet image")
    img = cv2.GaussianBlur(img, (3, 3), 0)
    return cv2.adaptiveThreshold(img, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                 cv2.THRESH_BINARY_INV, 11, 2)


def _locate_cells(img: Any) -> List[Tuple[int, int, int, int]]:
    """Find candidate table cells as (x, y, w, h) boxes via contour detection."""
    import cv2

    contours, _ = cv2.findContours(img, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cells: List[Tuple[int, int, int, int]] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if w >= 15 and h >= 15:
            cells.append((int(x), int(y), int(w), int(h)))
    cells.sort(key=lambda box: (box[1], box[0]))
    return cells


def _cluster(cells: Sequence[Tuple[int, int, int, int]]) -> List[List[Tuple[int, int, int, int]]]:
    """Group cells into rows (move rows) by vertical proximity.

    Each returned row is a list of cell boxes sorted left-to-right:
    [move-number, white-move, black-move].
    """
    rows: List[List[Tuple[int, int, int, int]]] = []
    current: List[Tuple[int, int, int, int]] = []
    last_y: Optional[int] = None
    for box in cells:
        y = box[1]
        if last_y is None or abs(y - last_y) <= 25:
            current.append(box)
        else:
            if current:
                rows.append(current)
            current = [box]
        last_y = y
    if current:
        rows.append(current)
    return [sorted(row, key=lambda box: box[0]) for row in rows]


def _crop_cell(img: Any, box: Tuple[int, int, int, int]) -> Any:
    x, y, w, h = box
    return img[y:y + h, x:x + w]


# ---------------------------------------------------------------------------
# OCR + validation
# ---------------------------------------------------------------------------

def _ocr_cell(cell_img: Any) -> str:
    """OCR a single cell image and return cleaned text."""
    if pytesseract is None:
        raise RuntimeError("pytesseract is not installed; install it and the tesseract binary")
    text = pytesseract.image_to_string(cell_img, config=_TESSERACT_CONFIG)
    return " ".join(text.split())


def _build_pgn(legal_sans: Sequence[str]) -> str:
    """Build a valid PGN string from a list of legal SAN moves."""
    body_parts: List[str] = []
    num = 1
    i = 0
    while i < len(legal_sans):
        body_parts.append(f"{num}.")
        body_parts.append(legal_sans[i])
        if i + 1 < len(legal_sans):
            body_parts.append(legal_sans[i + 1])
        i += 2
        num += 1
    body = " ".join(body_parts) + " *" if body_parts else "*"
    return '[Event "Scoresheet"]\n[White "?"]\n[Black "?"]\n[Result "*"]\n\n' + body


def _replay_validate(turns: Sequence[Sequence[str]]) -> Tuple[str, List[int]]:
    """Replay turns with python-chess and flag illegal move numbers.

    ``turns`` is a sequence of (white_san, black_san) pairs. Returns
    ``(pgn, illegal_numbers)`` where ``pgn`` is built from the legal prefix and
    ``illegal_numbers`` lists the 1-based move numbers that failed replay.
    """
    import chess

    board = chess.Board()
    legal_sans: List[str] = []
    illegal: List[int] = []
    for num, turn in enumerate(turns, start=1):
        white = turn[0] if len(turn) > 0 else ""
        black = turn[1] if len(turn) > 1 else ""
        if white:
            try:
                board.push_san(white)
                legal_sans.append(white)
            except Exception:
                illegal.append(num)
                break
        if black:
            try:
                board.push_san(black)
                legal_sans.append(black)
            except Exception:
                illegal.append(num)
                break
    return _build_pgn(legal_sans), illegal


def _llm_repair(pgn: str, illegal_numbers: Sequence[int]) -> str:
    """Best-effort LLM repair of a PGN with flagged illegal moves."""
    try:
        repaired = llm.complete(
            "You repair chess PGN transcripts. Fix the flagged illegal moves, "
            "keeping legal moves unchanged. Return only the PGN text.",
            f"PGN:\n{pgn}\n\nFlagged move numbers: {list(illegal_numbers)}",
            temperature=0.0,
        )
        return repaired or pgn
    except Exception:
        return pgn


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def scoresheet_to_pgn(image: Any, kid_name: Optional[str] = None) -> str:
    """Convert a scoresheet photo (bytes or file path) to a PGN string."""
    img = _preprocess(image)
    cells = _locate_cells(img)
    rows = _cluster(cells)
    turns: List[Tuple[str, str]] = []
    for row in rows:
        if len(row) < 2:
            continue
        white = _ocr_cell(_crop_cell(img, row[1]))
        black = _ocr_cell(_crop_cell(img, row[2])) if len(row) >= 3 else ""
        if white or black:
            turns.append((white, black))
    pgn, illegal = _replay_validate(turns)
    if illegal:
        pgn = _llm_repair(pgn, illegal)
    return pgn


def main(argv: Optional[List[str]] = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    if not argv:
        print("usage: python scoresheet_ocr.py <image_path>", file=sys.stderr)
        return 2
    print(scoresheet_to_pgn(argv[0]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
