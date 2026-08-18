"""Client for the ChessAgent MCP server (github.com/zVanta/chess-agent).

ChessAgent exposes cheat-detection / game tools for Lichess & Chess.com over the
Model Context Protocol using the streamable-HTTP transport. Its endpoint is
`http://<host>:8080/mcp` by default.

This module is a thin, lazy wrapper around the official `mcp` Python SDK so the
rest of the pipeline can call tools synchronously. Every call raises on
failure — callers are expected to fall back to the local pipeline.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Dict, List, Optional

CHESS_AGENT_MCP_URL: str = os.environ.get(
    "CHESS_AGENT_MCP_URL", "http://chess-agent:8080/mcp"
)


def _extract_text(result: Any) -> str:
    chunks: List[str] = []
    for block in getattr(result, "content", []) or []:
        if getattr(block, "type", None) == "text":
            chunks.append(block.text)
    return "".join(chunks)


async def _call_tool_async(tool: str, arguments: Dict[str, Any]) -> str:
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    async with streamablehttp_client(CHESS_AGENT_MCP_URL) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(tool, arguments)
            return _extract_text(result)


def call_tool(tool: str, arguments: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Call an MCP tool synchronously and parse its JSON text payload."""
    raw = asyncio.run(_call_tool_async(tool, arguments or {}))
    if not raw.strip():
        return {}
    return json.loads(raw)


def health_check() -> Dict[str, Any]:
    return call_tool("health_check")


def player_lookup(username: str) -> Dict[str, Any]:
    return call_tool(
        "player_lookup",
        {"username": username, "platforms": ["lichess", "chesscom"]},
    )


def fetch_user_games(username: str, platform: str, max_games: int = 50) -> List[Dict[str, Any]]:
    data = call_tool(
        "fetch_user_games",
        {"username": username, "platform": platform, "max_games": max_games},
    )
    return list(data.get("games") or [])


def calculate_crs(
    pgn: str,
    player_username: Optional[str] = None,
    player_rating: Optional[int] = None,
) -> Dict[str, Any]:
    arguments: Dict[str, Any] = {"pgn": pgn}
    if player_username:
        arguments["player_username"] = player_username
    if player_rating is not None:
        arguments["player_rating"] = player_rating
    return call_tool("calculate_crs", arguments)
