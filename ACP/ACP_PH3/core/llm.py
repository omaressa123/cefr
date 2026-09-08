"""
core.llm
========
Provider routing, message sanitisation, and JSON recovery.

Contains the fix for the Groq 400: Gradio's Chatbot(type="messages") hands back
dicts carrying `metadata`, `options` and occasionally `id`. Groq rejects unknown
keys on a chat message, so the history has to be reduced to {role, content}.

The sanitiser lives HERE, at the router boundary, not at the call sites. Every
path into a model goes through `complete()`, so no future caller — Gradio,
FastAPI, a WebRTC handler, a background worker — can reintroduce the bug by
forgetting to filter. That is the whole point of putting it at the choke point.
"""

import asyncio
import json
import logging
import re
from typing import Any, Callable, Iterable, Optional

import httpx
from groq import APIConnectionError, APIStatusError, AsyncGroq, RateLimitError

from .config import settings

log = logging.getLogger("cefr.llm")

VALID_ROLES = {"system", "user", "assistant"}

_groq: Optional[AsyncGroq] = (
    AsyncGroq(api_key=settings.groq_api_key, max_retries=1, timeout=25.0)
    if settings.has_groq
    else None
)


# ===========================================================================
# THE FIX — history sanitisation
# ===========================================================================

def sanitize_messages(messages: Iterable[Any]) -> list:
    """
    Reduce any message sequence to strictly [{"role": str, "content": str}].

    Handles every shape that has actually reached this function in practice:
      - Gradio dicts with `metadata`, `options`, `id`, `duration`
      - gradio.ChatMessage dataclass instances
      - dicts whose `content` is a gr.Component, a tuple (file, alt), or None
        (Gradio uses those for uploaded audio and image turns)
      - `metadata: {"title": "..."}` thinking blocks, which have no place in
        model history at all

    Anything that cannot be reduced to two strings is dropped rather than
    coerced, because a half-decoded message is worse than a missing one.
    """
    clean = []
    for message in messages or []:
        # gradio.ChatMessage and any other object exposing role/content
        if not isinstance(message, dict):
            role = getattr(message, "role", None)
            content = getattr(message, "content", None)
        else:
            role = message.get("role")
            content = message.get("content")

        if role not in VALID_ROLES:
            continue

        # Gradio wraps media turns as tuples or component payloads. There is no
        # sensible text for the model in those, so they are skipped.
        if not isinstance(content, str):
            continue

        content = content.strip()
        if not content:
            continue

        clean.append({"role": role, "content": content})

    return clean


def build_messages(
    system: str,
    history: Optional[Iterable[Any]] = None,
    user: Optional[str] = None,
    max_history: Optional[int] = None,
) -> list:
    """Assemble a request. History is sanitised and trimmed; system and user are
    constructed here so they cannot carry stray keys."""
    limit = settings.max_history_messages if max_history is None else max_history
    messages = [{"role": "system", "content": system}]
    if history:
        trimmed = sanitize_messages(history)
        if limit:
            trimmed = trimmed[-limit:]
        messages.extend(trimmed)
    if user:
        messages.append({"role": "user", "content": user})
    return messages


# ===========================================================================
# PROVIDERS
# ===========================================================================

class AllProvidersFailed(Exception):
    pass


FALLBACK_ERRORS = (
    RateLimitError,
    APIConnectionError,
    APIStatusError,
    asyncio.TimeoutError,
    TimeoutError,
)


async def _complete_local(messages: list, temperature: float, timeout: float, model: str) -> str:
    if not settings.local_assessor_url:
        raise RuntimeError("LOCAL_ASSESSOR_URL not configured")
    url = f"{settings.local_assessor_url.rstrip('/')}/chat/completions"
    payload = {
        "model": model or settings.local_assessor_model or "local-model",
        "messages": messages,
        "temperature": temperature,
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def _complete_groq(messages: list, temperature: float, timeout: float, model: str) -> str:
    if _groq is None:
        raise RuntimeError("GROQ_API_KEY not configured")

    kwargs: dict = {"model": model, "messages": messages, "temperature": temperature}
    if "gpt-oss" in model:
        kwargs["reasoning_effort"] = "medium" if model == settings.assessor_model else "low"

    response = await asyncio.wait_for(
        _groq.chat.completions.create(**kwargs), timeout=timeout
    )
    return response.choices[0].message.content or ""


async def _complete_gemini(messages: list, temperature: float, timeout: float, model: str) -> str:
    if not settings.has_gemini:
        raise RuntimeError("GEMINI_API_KEY not configured")

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=settings.gemini_api_key)

    system = ""
    contents = []
    for message in messages:
        if message["role"] == "system":
            system = message["content"]
            continue
        contents.append(
            types.Content(
                role="user" if message["role"] == "user" else "model",
                parts=[types.Part.from_text(text=message["content"])],
            )
        )

    response = await asyncio.wait_for(
        client.aio.models.generate_content(
            model=settings.gemini_model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system or None, temperature=temperature
            ),
        ),
        timeout=timeout,
    )
    return response.text or ""


async def complete(
    messages: list,
    temperature: float = 0.3,
    model: Optional[str] = None,
    timeout: Optional[float] = None,
) -> tuple:
    """
    Route a completion. Returns (text, provider).

    Messages are sanitised here unconditionally — callers may pass raw Gradio
    history and it will still be correct.
    """
    messages = sanitize_messages(messages) if messages else []
    if not messages or messages[0]["role"] != "system":
        log.debug("Request has no leading system message.")

    target_model = model or settings.partner_model
    attempts: list = [
        ("groq", _complete_groq, timeout or settings.groq_timeout, target_model)
    ]
    if settings.has_gemini:
        attempts.append(
            ("gemini", _complete_gemini, timeout or settings.gemini_timeout, settings.gemini_model)
        )
    if settings.uses_local_assessor:
        attempts.append(
            ("local", _complete_local, timeout or settings.local_assessor_timeout, settings.local_assessor_model)
        )

    failures = []
    for name, fn, deadline, model_id in attempts:
        try:
            text = await fn(messages, temperature, deadline, model_id)
            if text.strip():
                if name != "groq":
                    log.warning("Served by fallback provider: %s", name)
                return text, name
            failures.append(f"{name}: empty response")
        except FALLBACK_ERRORS as exc:
            log.warning("Provider %s failed (%s); trying next", name, exc.__class__.__name__)
            failures.append(f"{name}: {exc.__class__.__name__}")
        except Exception as exc:
            log.exception("Provider %s raised unexpectedly", name)
            failures.append(f"{name}: {exc.__class__.__name__}")

    raise AllProvidersFailed("; ".join(failures))


# ===========================================================================
# BOOT-TIME MODEL VERIFICATION
# Three dead model IDs have already reached production in this project
# (GitHub Models 410, gemini-1.5-flash 404, llama3-70b-8192 400). Reading the
# live catalogue at startup turns the fourth one into a log line instead of a
# student-facing failure.
# ===========================================================================

async def verify_models() -> dict:
    result = {"ok": [], "missing": [], "checked": False}
    if settings.uses_local_assessor:
        result["checked"] = True
        result["ok"].append(settings.local_assessor_model or "local-model")
        return result
    if _groq is None:
        return result
    try:
        catalogue = await _groq.models.list()
        available = {m.id for m in catalogue.data}
        result["checked"] = True
        for model_id in (settings.stt_model, settings.partner_model, settings.assessor_model):
            (result["ok"] if model_id in available else result["missing"]).append(model_id)
        if result["missing"]:
            log.error(
                "Configured Groq models not in the live catalogue: %s. "
                "Check https://console.groq.com/docs/deprecations",
                ", ".join(result["missing"]),
            )
    except Exception as exc:
        log.warning("Could not verify Groq model catalogue: %s", exc)
    return result


# ===========================================================================
# JSON RECOVERY — no API-level JSON mode, by standing decision
# ===========================================================================

REASONING_BLOCK = re.compile(
    r"(<think>.*?</think>|<\|channel\|>analysis.*?<\|(?:end|message)\|>)", re.S | re.I
)


def _balanced_json_blocks(raw: str):
    """Yield every balanced {...} region, respecting string literals and escapes.

    A greedy `\\{.*\\}` spans from the first brace to the last, so a single brace
    in a reasoning preamble swallows the real object. This does not.
    """
    depth, start, in_string, escaped = 0, None, False, False
    for index, char in enumerate(raw):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            if depth == 0:
                start = index
            depth += 1
        elif char == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start is not None:
                    yield raw[start : index + 1]
                    start = None


def extract_json(raw: str, require_keys: Iterable[str] = ()) -> Optional[dict]:
    """Last valid object containing all `require_keys`, else last valid object."""
    cleaned = REASONING_BLOCK.sub(" ", raw or "")
    required = set(require_keys)
    preferred = None
    fallback = None
    for block in _balanced_json_blocks(cleaned):
        try:
            candidate = json.loads(block)
        except json.JSONDecodeError:
            continue
        if not isinstance(candidate, dict):
            continue
        fallback = candidate
        if required.issubset(candidate.keys()):
            preferred = candidate
    return preferred if preferred is not None else fallback


def strip_reasoning(raw: str) -> str:
    return REASONING_BLOCK.sub("", raw or "").strip()
