"""Unit tests for chessintel_clone.py.

HTTP calls to Lichess/chess.com are mocked, so no network or engine binary is
required. ``phase_of`` and ``aggregate_habits`` are tested directly.
"""

import json
import time

import chess
import chess.engine
import pytest

import chessintel_clone as cc


# ---------------------------------------------------------------------------
# phase_of
# ---------------------------------------------------------------------------

def test_phase_of_boundaries():
    assert cc.phase_of(1) == "opening"
    assert cc.phase_of(20) == "opening"
    assert cc.phase_of(21) == "middlegame"
    assert cc.phase_of(69) == "middlegame"
    assert cc.phase_of(70) == "endgame"
    assert cc.phase_of(200) == "endgame"


# ---------------------------------------------------------------------------
# aggregate_habits
# ---------------------------------------------------------------------------

def test_aggregate_habits_groups_and_sorts():
    reports = [
        {"habit_tags": ["Piece safety", "Opening preparation"]},
        {"habit_tags": ["Piece safety"]},
        {"habit_tags": []},
        {"habit_tags": None},
        {"habit_tags": ["Endgame technique", "Piece safety"]},
    ]
    habits = cc.aggregate_habits(reports)
    assert habits[0] == {"habit": "Piece safety", "count": 3}
    assert {"habit": "Opening preparation", "count": 1} in habits
    assert {"habit": "Endgame technique", "count": 1} in habits


def test_aggregate_habits_empty():
    assert cc.aggregate_habits([]) == []
    assert cc.aggregate_habits([{"habit_tags": []}]) == []


# ---------------------------------------------------------------------------
# fetch_lichess_games (mocked HTTP)
# ---------------------------------------------------------------------------

def test_fetch_lichess_games(monkeypatch):
    payload = {
        "id": "abc123",
        "pgn": '[Event "Test"]\n[White "Alice"]\n[Black "Bob"]\n[Result "1-0"]\n\n1. e4 e5 *',
        "players": {
            "white": {"user": {"name": "Alice"}},
            "black": {"user": {"name": "Bob"}},
        },
        "status": "mate",
        "winner": "white",
        "createdAt": int(time.time() * 1000),
    }
    empty = {"id": "no-pgn", "pgn": ""}

    class FakeResp:
        text = json.dumps(payload) + "\n" + json.dumps(empty) + "\n"

        def raise_for_status(self):
            pass

    monkeypatch.setattr(cc.requests, "get", lambda *a, **k: FakeResp())
    games = cc.fetch_lichess_games("alice", max_games=10)
    assert len(games) == 1
    assert games[0]["source"] == "lichess"
    assert games[0]["external_id"] == "abc123"
    assert games[0]["result"] == "1-0"
    assert games[0]["white"] == "Alice"
    assert "1. e4" in games[0]["pgn"]


# ---------------------------------------------------------------------------
# fetch_chesscom_games (mocked HTTP)
# ---------------------------------------------------------------------------

def test_fetch_chesscom_games(monkeypatch):
    archives = {"archives": ["https://api.chess.com/pub/player/alice/games/2026/08"]}
    month = {
        "games": [
            {
                "url": "https://www.chess.com/game/live/1",
                "pgn": '[Event "T"]\n\n1. d4 d5 *',
                "white": {"username": "Alice", "result": "win"},
                "black": {"username": "Bob", "result": "checkmated"},
                "end_time": int(time.time()),  # recent, within the since_days window
            }
        ]
    }

    class FakeResp:
        def __init__(self, data):
            self._data = data

        def raise_for_status(self):
            pass

        def json(self):
            return self._data

    def fake_get(url, **kwargs):
        if "archives" in url:
            return FakeResp(archives)
        return FakeResp(month)

    monkeypatch.setattr(cc.requests, "get", fake_get)
    games = cc.fetch_chesscom_games("alice", max_games=10)
    assert len(games) == 1
    assert games[0]["source"] == "chesscom"
    assert games[0]["external_id"] == "https://www.chess.com/game/live/1"
    assert games[0]["result"] == "1-0"
    assert "1. d4" in games[0]["pgn"]


# ---------------------------------------------------------------------------
# analyze_game (fake engine)
# ---------------------------------------------------------------------------

def make_score(cp: int, mate: int = None):
    """Build a White-perspective score compatible with python-chess v1 and v2."""
    if hasattr(chess.engine, "Cp"):  # python-chess v2 rewrite
        if mate is not None:
            return chess.engine.Mate(mate)
        return chess.engine.Cp(cp)
    # python-chess v1
    return chess.engine.Score(cp=cp, mate=mate)


class FakeEngine:
    """Returns +3.00 for White on "before" calls and 0.00 on "after" calls."""

    def __init__(self):
        self.calls = 0

    def analyse(self, board, limit):
        self.calls += 1
        cp = 300 if self.calls % 2 == 1 else 0
        return {"score": make_score(cp)}


def test_analyze_game_detects_blunders():
    pgn = '[Event "T"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 *'
    report = cc.analyze_game({"pgn": pgn, "source": "test", "external_id": "1"}, FakeEngine(), depth=1)
    assert len(report["blunders"]) >= 1
    assert report["blunders"][0]["phase"] == "opening"
    assert report["blunders"][0]["cp_loss"] >= cc.BLUNDER_THRESHOLD_CP
    assert report["phase_blunders"]["opening"] >= 1
    assert report["points_lost"] > 0


def test_analyze_game_handles_unparseable_pgn():
    report = cc.analyze_game({"pgn": "not a game"}, FakeEngine(), depth=1)
    assert report["blunders"] == []
    assert report["points_lost"] == 0.0


# ---------------------------------------------------------------------------
# generate_report fallback (no API key)
# ---------------------------------------------------------------------------

def test_generate_report_fallback_without_key(monkeypatch):
    import llm
    monkeypatch.setattr(llm, "DEEPSEEK_API_KEY", None)
    monkeypatch.setattr(llm, "LIBRECHAT_API_KEY", None)
    text = cc.generate_report("Alex", "Piece safety", 3, api_key=None)
    assert "Alex" in text
    assert "Piece safety" in text
    assert "3" in text
