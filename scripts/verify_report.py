"""Truth-check a game against the report pipeline.

Replays a PGN (or raw move list) through chessintel_clone.analyze_game with a
real Stockfish, then prints a truth table for every flagged blunder:

  - the move (standard move number + SAN)
  - the eval loss in pawns
  - the program's own tactical label (threat / threat_detail)
  - Stockfish's best move before the move and its best reply after
  - an independent SEE cross-check of what the opponent's reply actually
    attacks (did the move really hang a piece / pin / fork something?)

This is the tool to re-run whenever a report's explanation looks wrong: it
shows the engine's ground truth next to whatever the pipeline claimed.

Usage:
  python scripts/verify_report.py "<1. d4 d5 2. ...>" [--stockfish PATH]
  python scripts/verify_report.py game.pgn [--stockfish PATH] [--depth 16]
"""

import io
import os
import sys

# Make the project root importable when run as scripts/verify_report.py.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import chess
import chess.engine
import chess.pgn

import chessintel_clone as cc

DEFAULT_STOCKFISH = r"C:\Users\vince\AppData\Local\Temp\stockfish\stockfish\stockfish-windows-x86-64-avx2.exe"


def _parse(text: str):
    node = chess.pgn.read_game(io.StringIO(text))
    if node is not None:
        return node
    wrapped = (
        '[Event "verify"]\n[White "?"]\n[Black "?"]\n[Result "*"]\n\n'
        + text.strip()
        + " *\n"
    )
    return chess.pgn.read_game(io.StringIO(wrapped))


def _en_prise(board: chess.Board, color: bool):
    """Squares of ``color``'s pieces the enemy can win outright (SEE > 0)."""
    return [
        chess.square_name(sq)
        for sq, p in board.piece_map().items()
        if p.color == color
        and p.piece_type != chess.KING
        and cc._see(board, sq, not color) > 0
    ]


def main() -> int:
    argv = [a for a in sys.argv[1:]]
    if not argv or "--help" in argv or "-h" in argv:
        print(__doc__)
        return 0

    arg = argv[0]
    sf_path = DEFAULT_STOCKFISH
    depth = 14
    if "--stockfish" in argv:
        sf_path = argv[argv.index("--stockfish") + 1]
    if "--depth" in argv:
        depth = int(argv[argv.index("--depth") + 1])

    if not os.path.exists(sf_path):
        print(f"Stockfish not found at: {sf_path}")
        print("Download one from https://github.com/official-stockfish/Stockfish/releases")
        print("and pass it with --stockfish PATH.")
        return 2

    text = arg
    if os.path.exists(arg):
        with open(arg, "r", encoding="utf-8") as fh:
            text = fh.read()

    node = _parse(text)
    if node is None:
        print("Could not parse the PGN / move list.")
        return 3

    white = node.headers.get("White", "White") or "White"
    black = node.headers.get("Black", "Black") or "Black"
    result = node.headers.get("Result", "*")

    # Replay once to map each ply to the board AFTER that move.
    board = chess.Board()
    boards_after = {}
    moves_by_ply = {}
    for ply, child in enumerate(
        (c for c in node.mainline() if c.move is not None), start=1
    ):
        moves_by_ply[ply] = child.move
        board.push(child.move)
        boards_after[ply] = board.copy()

    engine = chess.engine.SimpleEngine.popen_uci(sf_path)
    try:
        report = cc.analyze_game({"pgn": str(node)}, engine, depth=depth)

        blunders = report.get("blunders") or []
        print(f"Game: {white} vs {black}  result {result}  "
              f"plies {report.get('moves')}  blunders {len(blunders)}\n")

        for b in sorted(blunders, key=lambda x: -(x.get("cp_loss") or 0)):
            ply = b.get("ply")
            move_no = cc._move_number(ply)
            color = b.get("color", "?")
            san = b.get("san", "?")
            cp = (b.get("cp_loss") or 0) / 100.0
            label = b.get("threat_detail") or b.get("threat") or "(no tactical label)"
            best = b.get("best") or "?"

            print(f"{move_no:>5} {san:<8} ({color}, lost ~{cp:.1f} pawns)")
            print(f"        program says: {label}")
            print(f"        engine best before: {best}")

            ba = boards_after.get(ply)
            if ba is not None:
                try:
                    info = engine.analyse(ba, chess.engine.Limit(depth=depth))
                    pv = info.get("pv") if isinstance(info, dict) else None
                    reply = pv[0] if pv else None
                    if reply is not None:
                        reply_san = ba.san(reply)
                        ba2 = ba.copy()
                        ba2.push(reply)
                        mover = chess.WHITE if ply % 2 == 1 else chess.BLACK
                        hung = _en_prise(ba2, mover)
                        print(f"        engine best reply after: {reply_san} "
                              f"({reply.uci()})")
                        print(f"        after reply, mover's en-prise pieces: "
                              f"{hung or 'none'}")
                except Exception as exc:  # noqa: BLE001
                    print(f"        (reply cross-check failed: {exc})")
            print()
    finally:
        engine.quit()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
