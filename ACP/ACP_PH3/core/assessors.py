"""
core.assessors
==============
Pluggable backends for the clause-sweep assessor.

THE CONTRACT
    A backend does exactly one thing: turn (system, user) into raw text.
    It does not parse, validate, cap, or verify anything.

    Every guardrail — the 11-tag closed taxonomy, the per-clause verdict sweep,
    `_substring_match` verbatim verification, the level-aware reporting caps —
    lives in `engine.coerce_assessment`, which runs on whatever a backend
    returns. That is deliberate and structural: a local 3B model is far more
    likely to invent a quote or a twelfth tag than gpt-oss-120b is, so the
    verification must sit outside the swappable part. Backends get less trust
    as they get smaller; the guardrails do not move.

    A test in test_core.py asserts no backend imports the coercion path.

ON EXPECTATIONS
    Building the seam is worth it — you can A/B, you can fail over, you stop
    being hostage to one vendor's deprecation calendar. Expecting a small local
    model to MATCH gpt-oss-120b here is a different claim, and an unmeasured
    one. The assessor does 11-way classification, verbatim span extraction,
    correction generation and CCQ authoring across six CEFR levels
    simultaneously — precisely the workload where small models degrade first.
    `tools/eval_assessor.py` exists so you can find out rather than assume.
"""

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Optional, Protocol

from .config import settings

log = logging.getLogger("cefr.assessors")


class AssessorUnavailable(Exception):
    """No configured backend could produce a response."""


@dataclass
class AssessorResponse:
    raw: str
    provider: str
    model: str
    latency_ms: int = 0


class AssessorBackend(Protocol):
    name: str

    @property
    def available(self) -> bool: ...

    async def generate(self, system: str, user: str, temperature: float) -> str: ...


# ===========================================================================
# CLOUD — Groq primary, Gemini fallback, via the existing router
# ===========================================================================

class CloudAssessor:
    """Delegates to core.llm.complete, keeping provider fallback intact."""

    name = "cloud"

    def __init__(self, model: Optional[str] = None):
        self.model = model or settings.assessor_model

    @property
    def available(self) -> bool:
        return settings.has_groq or settings.has_gemini

    async def generate(self, system: str, user: str, temperature: float) -> str:
        from . import llm  # local import keeps the module graph acyclic

        messages = llm.build_messages(system, user=user, max_history=0)
        raw, _provider = await llm.complete(
            messages,
            temperature=temperature,
            model=self.model,
            timeout=settings.assessor_timeout,
        )
        return raw


# ===========================================================================
# LOCAL — any OpenAI-compatible endpoint (Ollama, vLLM, LM Studio, TGI)
# ===========================================================================

class LocalAssessor:
    """
    Speaks the OpenAI chat-completions dialect, which Ollama (`/v1`), vLLM,
    llama.cpp's server and LM Studio all expose. That means one adapter for
    every plausible local runtime instead of one per vendor SDK.

    Deliberately uses httpx directly rather than the openai SDK: the surface
    used here is one POST, and adding a client library for it would pull a
    dependency into `core/` for no benefit.

    NOTE ON DEPLOYMENT. This does not run on the free Hugging Face Space. A 3B
    model needs a GPU or a beefy always-on CPU box, so ASSESSOR_BACKEND=local
    means "point at a machine I control", not "run it in the Space". Keeping
    that explicit avoids the failure where someone flips the flag in production
    and every turn times out.
    """

    name = "local"

    def __init__(self):
        self.base_url = settings.local_assessor_url.rstrip("/")
        self.model = settings.local_assessor_model
        self.api_key = settings.local_assessor_api_key or "not-needed"

    @property
    def available(self) -> bool:
        return bool(self.base_url and self.model)

    async def generate(self, system: str, user: str, temperature: float) -> str:
        import httpx  # noqa: PLC0415

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
            "max_tokens": settings.local_assessor_max_tokens,
            "stream": False,
        }
        # No response_format here, matching the standing decision not to use
        # API-level JSON mode. Small models are the WORST case for it: many
        # local runtimes accept the parameter and silently ignore it, so you
        # get the constraint's cost with none of its guarantee. The balanced
        # brace scanner in llm.extract_json handles the output either way.

        async with httpx.AsyncClient(timeout=settings.local_assessor_timeout) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            response.raise_for_status()
            body = response.json()

        try:
            return body["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise AssessorUnavailable(f"Malformed local assessor response: {exc}") from exc


# ===========================================================================
# REGISTRY AND DISPATCH
# ===========================================================================

_BACKENDS: dict = {}


def register(name: str, backend) -> None:
    _BACKENDS[name] = backend


def get_backend(name: Optional[str] = None):
    name = (name or settings.assessor_backend).lower()
    if name not in _BACKENDS:
        raise AssessorUnavailable(f"Unknown assessor backend: {name}")
    return _BACKENDS[name]


register("cloud", CloudAssessor())
register("local", LocalAssessor())


async def run_assessor(
    system: str,
    user: str,
    temperature: Optional[float] = None,
    backend: Optional[str] = None,
) -> AssessorResponse:
    """
    Dispatch with fallback. The configured backend is tried first; if it is
    unavailable or fails and `assessor_fallback_to_cloud` is on, the cloud
    router takes over.

    The fallback direction is one-way on purpose. Falling back from cloud to a
    local model would mean quietly downgrading assessment quality during an
    outage without anyone noticing — worse than showing "assessment
    unavailable" for one turn, which the engine already handles.
    """
    temperature = settings.assessor_temperature if temperature is None else temperature
    order = []

    try:
        primary = get_backend(backend)
        if primary.available:
            order.append(primary)
        else:
            log.warning("Assessor backend %r is configured but not available.", primary.name)
    except AssessorUnavailable as exc:
        log.error("%s", exc)

    if settings.assessor_fallback_to_cloud:
        cloud = _BACKENDS["cloud"]
        if cloud.available and cloud not in order:
            order.append(cloud)

    failures = []
    for candidate in order:
        started = asyncio.get_running_loop().time()
        try:
            raw = await candidate.generate(system, user, temperature)
            if raw and raw.strip():
                if candidate.name != (backend or settings.assessor_backend):
                    log.warning("Assessment served by fallback backend: %s", candidate.name)
                return AssessorResponse(
                    raw=raw,
                    provider=candidate.name,
                    model=getattr(candidate, "model", ""),
                    latency_ms=int((asyncio.get_running_loop().time() - started) * 1000),
                )
            failures.append(f"{candidate.name}: empty response")
        except Exception as exc:
            log.warning("Assessor backend %s failed: %s", candidate.name, exc.__class__.__name__)
            failures.append(f"{candidate.name}: {exc.__class__.__name__}")

    raise AssessorUnavailable("; ".join(failures) or "no assessor backend available")


async def health() -> dict:
    """Which backends are configured and reachable. Surfaced by /api/v1/readyz."""
    report = {}
    for name, backend in _BACKENDS.items():
        entry = {"configured": backend.available, "model": getattr(backend, "model", "")}
        if name == "local" and backend.available:
            try:
                import httpx  # noqa: PLC0415

                async with httpx.AsyncClient(timeout=5.0) as client:
                    response = await client.get(f"{backend.base_url}/models")
                entry["reachable"] = response.status_code < 500
            except Exception:
                entry["reachable"] = False
        report[name] = entry
    report["active"] = settings.assessor_backend
    return report
