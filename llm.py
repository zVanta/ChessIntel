"""Shared LLM provider configuration — DeepSeek and/or LibreChat. No OpenAI.

The active provider is chosen with ``AI_PROVIDER``:

    AI_PROVIDER=deepseek   (default) → DeepSeek chat-completions API
    AI_PROVIDER=librechat            → LibreChat agent gateway (Responses API)

When LibreChat is selected and fails (or has no key), completions transparently
fall back to DeepSeek.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional, Tuple

import requests


def _load_dotenv(path: str) -> None:
    """Minimal .env loader so the Python service reads the same config as Next."""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("export "):
                    line = line[len("export "):]
                if "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
    except OSError:
        pass


for _env_candidate in (".env", os.path.join(os.path.dirname(__file__), ".env")):
    _load_dotenv(_env_candidate)


AI_PROVIDER: str = os.environ.get("AI_PROVIDER", "deepseek").lower()

# DeepSeek — OpenAI-compatible chat-completions API.
DEEPSEEK_API_KEY: Optional[str] = os.environ.get("DEEPSEEK_API_KEY")
DEEPSEEK_MODEL: str = os.environ.get("DEEPSEEK_MODEL", "deepseek-reasoner")
DEEPSEEK_BASE_URL: str = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1").rstrip("/")

# LibreChat — agent gateway using the OpenAI Responses API.
LIBRECHAT_ENDPOINT: str = os.environ.get("LIBRECHAT_ENDPOINT", "https://njxai.com").rstrip("/")
LIBRECHAT_API_KEY: Optional[str] = os.environ.get("LIBRECHAT_API_KEY")
LIBRECHAT_MODEL: str = os.environ.get("LIBRECHAT_MODEL", "")


def target() -> Tuple[str, Optional[str], str, bool]:
    """Return (endpoint, api_key, model, is_responses) for the active provider."""
    if AI_PROVIDER == "librechat":
        return (
            f"{LIBRECHAT_ENDPOINT}/api/agents/v1/responses",
            LIBRECHAT_API_KEY,
            LIBRECHAT_MODEL,
            True,
        )
    return (
        f"{DEEPSEEK_BASE_URL}/chat/completions",
        DEEPSEEK_API_KEY,
        DEEPSEEK_MODEL,
        False,
    )


def _deepseek_target() -> Tuple[str, Optional[str], str, bool]:
    return (f"{DEEPSEEK_BASE_URL}/chat/completions", DEEPSEEK_API_KEY, DEEPSEEK_MODEL, False)


def _parse_responses(data: Dict[str, Any]) -> str:
    """Extract text from an OpenAI Responses-API-style payload."""
    for item in data.get("output", []) or []:
        if not isinstance(item, dict):
            continue
        for part in item.get("content", []) or []:
            text = part.get("text") if isinstance(part, dict) else None
            if text:
                return str(text).strip()
        text = item.get("text")
        if isinstance(text, str) and text.strip():
            return text.strip()
    for key in ("output_text", "text", "response", "content"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    choices = data.get("choices") or []
    if choices:
        message = choices[0].get("message", {}) or {}
        text = message.get("content", "")
        if isinstance(text, str) and text.strip():
            return text.strip()
    raise ValueError("Unrecognized LLM response shape")


def chat(system: str, user: str, endpoint: str, key: str, model: str,
         is_responses: bool, temperature: float = 0.7) -> str:
    """One completion against an explicit endpoint."""
    headers = {"Authorization": f"Bearer {key}"}
    # deepseek-reasoner is a reasoning model: it ignores `temperature` and can
    # take much longer, so give it a bigger token budget and a longer timeout.
    is_reasoner = not is_responses and "reasoner" in (model or "").lower()
    timeout = 360 if is_reasoner else 30
    if is_responses:
        payload: Dict[str, Any] = {
            "input": f"{system}\n\n{user}",
            "stream": False,
            "max_output_tokens": 2000,
            "temperature": temperature,
        }
        if model:
            payload["model"] = model
    else:
        payload: Dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if is_reasoner:
            payload["max_tokens"] = 8000
        else:
            payload["temperature"] = temperature

    resp = requests.post(endpoint, headers=headers, json=payload, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
    if is_responses:
        return _parse_responses(data)
    return data["choices"][0]["message"]["content"].strip()


def complete(system: str, user: str, temperature: float = 0.7,
             api_key: Optional[str] = None,
             model: Optional[str] = None) -> str:
    """Run a completion against the active provider, falling back to DeepSeek.

    Pass ``model`` to override the active provider's default model for a single
    call (e.g. use the fast ``deepseek-chat`` for OCR repair).
    """
    endpoint, key, active_model, is_responses = target()
    key = api_key or key
    if not key:
        raise RuntimeError("No LLM API key configured")
    chosen = model or active_model
    try:
        return chat(system, user, endpoint, key, chosen, is_responses, temperature)
    except Exception:
        if is_responses and DEEPSEEK_API_KEY:
            ep2, k2, m2, _ = _deepseek_target()
            return chat(system, user, ep2, k2, model or m2, False, temperature)
        raise
