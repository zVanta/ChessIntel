"""Generate PWA/TWA app icons with no third-party dependencies.

Writes a chessboard-pattern PNG at several sizes into public/icons/.
Pure stdlib (zlib + struct), so it runs anywhere Python 3 runs.
"""

from __future__ import annotations

import os
import struct
import zlib

EMERALD = (4, 120, 87)   # #047857 (brand green)
LIGHT = (248, 250, 252)  # #f8fafc (near-white squares)


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path: str, size: int, pixel) -> None:
    rows = []
    for y in range(size):
        row = bytearray(b"\x00")  # filter type 0 (None)
        for x in range(size):
            r, g, b, a = pixel(x, y)
            row.extend((r, g, b, a))
        rows.append(bytes(row))
    raw = b"".join(rows)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(raw, 9))
        + _chunk(b"IEND", b"")
    )
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", os.path.relpath(path))


def checkerboard(size: int, margin: float) -> "object":
    """Return a pixel function drawing an 8x8 board with `margin` padding."""

    def pixel(x: int, y: int):
        lo = size * margin
        hi = size * (1.0 - margin)
        if x < lo or x >= hi or y < lo or y >= hi:
            return EMERALD + (255,)
        cell = (hi - lo) / 8.0
        col = int((x - lo) // cell)
        row = int((y - lo) // cell)
        color = LIGHT if (row + col) % 2 == 0 else EMERALD
        return color + (255,)

    return pixel


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.normpath(os.path.join(here, "..", "public", "icons"))

    for size in (192, 512):
        write_png(os.path.join(out, f"icon-{size}.png"), size, checkerboard(size, 0.0))
        # Maskable icons keep the board inside the circular safe zone.
        write_png(
            os.path.join(out, f"icon-maskable-{size}.png"),
            size,
            checkerboard(size, 0.18),
        )


if __name__ == "__main__":
    main()
