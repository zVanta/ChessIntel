"""Unit tests for scoresheet_ocr.py.

The heavy pipeline stages (OpenCV/numpy/tesseract) are mocked so the tests run
without those binaries installed. ``_replay_validate`` is tested directly for
illegal-move flagging.
"""

import io

import chess.pgn

import scoresheet_ocr as so


def test_replay_validate_flags_illegal_move():
    # After 1. e4 e5 2. Nf3, Black's Kd7 is illegal (d7 is occupied).
    turns = [("e4", "e5"), ("Nf3", "Kd7")]
    pgn, illegal = so._replay_validate(turns)
    assert illegal == [2]
    # The PGN should only contain the legal prefix.
    assert "e4" in pgn
    assert "Nf3" in pgn
    assert "Kd7" not in pgn


def test_replay_validate_all_legal_returns_valid_pgn():
    turns = [("e4", "e5"), ("Nf3", "Nc6"), ("Bb5", "a6")]
    pgn, illegal = so._replay_validate(turns)
    assert illegal == []
    game = chess.pgn.read_game(io.StringIO(pgn))
    assert game is not None
    # Replay the produced PGN and confirm it contains all six plies.
    board = game.board()
    played = 0
    for move in game.mainline_moves():
        board.push(move)
        played += 1
    assert played == 6
    assert board.fullmove_number == 4


def test_ocr_cell_mocked_tesseract(monkeypatch):
    class FakeTesseract:
        def image_to_string(self, img, config=None):
            return "  Nf3  \n"

    monkeypatch.setattr(so, "pytesseract", FakeTesseract())
    assert so._ocr_cell("dummy-cell") == "Nf3"


def test_scoresheet_to_pgn_returns_valid_pgn(monkeypatch):
    monkeypatch.setattr(so, "_preprocess", lambda image: object())
    monkeypatch.setattr(so, "_locate_cells", lambda img: ["num", "white", "black"])
    monkeypatch.setattr(
        so, "_cluster", lambda cells: [["num-cell", "white-cell", "black-cell"]]
    )
    monkeypatch.setattr(so, "_crop_cell", lambda img, box: box)

    ocr_results = iter(["e4", "e5"])
    monkeypatch.setattr(so, "_ocr_cell", lambda cell: next(ocr_results))

    pgn = so.scoresheet_to_pgn(b"fake-image-bytes")
    game = chess.pgn.read_game(io.StringIO(pgn))
    assert game is not None
    moves = []
    board = game.board()
    for move in game.mainline_moves():
        moves.append(board.san(move))
        board.push(move)
    assert moves == ["e4", "e5"]
