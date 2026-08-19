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


def test_analyze_game_san_never_double_annotates_checkmate():
    # Scholar's mate ends with Qxf7# — board.san() already adds the '#', so the
    # report must not append another one (regression for "Qxf7##").
    pgn = '[Event "T"]\n[White "A"]\n[Black "B"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# *'
    report = cc.analyze_game({"pgn": pgn, "source": "x", "external_id": "1"}, FakeEngine(), depth=1)
    sans = [b["san"] for b in report["blunders"]]
    assert any(s.endswith("#") for s in sans)
    for s in sans:
        assert "##" not in s
        assert "++" not in s


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


# ---------------------------------------------------------------------------
# accuracy + threat detection
# ---------------------------------------------------------------------------

def test_accuracy_from_loss_is_bounded_and_monotonic():
    assert cc._accuracy_from_loss(0) == pytest.approx(100, abs=0.1)
    assert cc._accuracy_from_loss(5) < cc._accuracy_from_loss(0)
    assert 0 < cc._accuracy_from_loss(50) < 100
    assert cc._accuracy_from_loss(5000) == 0


def test_hanging_squares_detects_en_prise_piece():
    # Black knight on b4 is attacked by the white a3 pawn and undefended.
    board = chess.Board("6k1/8/8/8/1n6/P7/8/4K3 w - - 0 1")
    names = [chess.square_name(s) for s in cc._hanging_squares(board)]
    assert "b4" in names


def test_opponent_forks_detects_knight_fork():
    # White knight on d5 can play Nc7, forking both black rooks (a8, e8).
    board = chess.Board("r3r1k1/8/8/3N4/8/8/8/7K w - - 0 1")
    forks = cc._opponent_forks(board)
    assert any(f["san"] == "Nc7" for f in forks)


def test_blunder_threat_labels():
    hung = chess.Board("6k1/8/8/8/1n6/P7/8/4K3 w - - 0 1")
    assert cc._blunder_threat(hung) == "hung a piece"
    fork = chess.Board("r3r1k1/8/8/3N4/8/8/8/7K w - - 0 1")
    assert cc._blunder_threat(fork) == "walked into a fork"
    assert cc._blunder_threat(chess.Board()) is None


# ---------------------------------------------------------------------------
# report prompt pre-fills the real moves (no hallucinated placeholders)
# ---------------------------------------------------------------------------

def test_report_prompt_prefills_move_facts():
    ctx = {
        "platform": "Lichess",
        "date_range": "recent games",
        "wins": 1, "losses": 0, "draws": 0,
        "acpl": 40, "avg_accuracy": 80,
        "openings": ["Italian Game"],
        "class_counts": {"mistake": 2},
        "games_brief": [{
            "opponent": "Alice", "outcome": "win", "result": "1-0",
            "opening": "Italian Game", "acpl": 40, "accuracy": 80,
        }],
        "moments": [
            {"san": "Nf3", "best": "Nc3", "ply": 5, "phase": "middlegame",
             "cp_loss": 1.2, "opponent": "Alice", "fen": None, "line": "Nc3 d5",
             "threat": None, "candidates": []},
            {"san": "Re1", "best": "Re1#", "ply": 23, "phase": "endgame",
             "cp_loss": 3.0, "opponent": "Alice", "fen": None, "line": "Re1#",
             "threat": None, "candidates": []},
        ],
        "notes": "", "answers": [],
    }
    prompt = cc._report_user_prompt("Alex", "Piece safety", 3, "a drill", ctx)
    assert "Moment 1 — Nf3 instead of Nc3 (vs Alice)" in prompt
    assert "Moment 2 — Re1 instead of Re1# (vs Alice)" in prompt
    assert "Yes — Nf3 instead of Nc3 (vs Alice)" in prompt
    assert "<bad move>" not in prompt
    assert "<better move>" not in prompt
    assert "<move> vs <opponent>" not in prompt


def test_report_prompt_includes_history():
    ctx = {
        "platform": "Lichess", "date_range": "recent games",
        "wins": 1, "losses": 0, "draws": 0,
        "acpl": 40, "avg_accuracy": 80, "openings": [], "class_counts": {},
        "games_brief": [], "moments": [], "notes": "", "answers": [],
        "history": [
            {"habit": "Hung pieces", "points_lost": 3.2, "held": True,
             "date": "2026-07-01"},
            {"habit": "Fork awareness", "points_lost": 2.1, "held": None,
             "date": "2026-08-01"},
        ],
    }
    prompt = cc._report_user_prompt("Alex", "Fork awareness", 3, "a drill", ctx)
    assert "Past progress across previous reports" in prompt
    assert "Hung pieces" in prompt
    assert "drill held at the next check" in prompt
    assert "Fork awareness" in prompt
    assert "not re-checked yet" in prompt

