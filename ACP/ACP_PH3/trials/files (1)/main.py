"""
main.py — the strangler-fig trunk
=================================
FastAPI owns the process. Gradio is mounted at "/" as a legacy leaf that will
be pruned once the real frontend replaces it. Nothing in core/ knows either
framework exists.

ROUTE ORDERING IS LOAD-BEARING. Starlette matches routes in registration order,
and `gr.mount_gradio_app(..., path="/")` installs a catch-all Mount. Every
FastAPI route must therefore be declared BEFORE the mount call at the bottom of
this file, or Gradio will shadow it and you will get an HTML page where you
expected JSON. That is the single most common way this pattern is got wrong.

DEPLOYMENT NOTE FOR HUGGING FACE SPACES
A Space with `sdk: gradio` runs your file and launches the Blocks object
itself; it will not serve a FastAPI app. To run this you must switch the Space
to `sdk: docker` and use the supplied Dockerfile. That switch has one
consequence worth checking before you migrate: HF OAuth (`gr.LoginButton`)
behaves differently outside the gradio SDK. Verify sign-in still works on a
duplicated Space before pointing students at it, and keep the existing Space
running until it does.
"""

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from core import assessors, llm, verbatim
from core.config import CEFR_LEVELS, ERROR_TAGS, TAG_LABELS, VOICES, settings
from core.db import NotAuthorized, store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("cefr.main")

API = "/api/v1"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Three dead model IDs have already reached this project's runtime. Reading
    # the live catalogue at boot turns the fourth into a log line rather than a
    # student-facing 400.
    if settings.has_groq:
        await llm.verify_models()
    if not settings.has_db:
        log.warning("Supabase not configured — classroom features are disabled.")

    # Warm the acoustic model off the request path. Fire and forget: a slow
    # download must not delay readiness, and turns that arrive meanwhile skip
    # the cross-check rather than time out on it.
    warm_task = None
    if settings.acoustic_check_enabled:
        warm_task = asyncio.create_task(verbatim.warmup())
        log.info("Acoustic cross-check warming in the background.")

    yield

    if warm_task and not warm_task.done():
        warm_task.cancel()


app = FastAPI(
    title="CEFR Practice Partner",
    version="2.0.0",
    lifespan=lifespan,
    docs_url=f"{API}/docs",
    openapi_url=f"{API}/openapi.json",
)

# Tighten this before the real frontend ships. "*" is acceptable only while the
# only browser client is the same-origin Gradio UI.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(NotAuthorized)
async def _not_authorized(request, exc: NotAuthorized):
    log.warning("Tenancy violation blocked: %s", exc)
    return JSONResponse(status_code=403, content={"detail": "Not authorized for that classroom."})


# ===========================================================================
# AUTH — Hugging Face OAuth Verification
# ===========================================================================
# `gr.LoginButton` only works inside a Hugging Face Space. For API routes,
# we resolve the Bearer token against Hugging Face's whoami endpoint and then
# authorize against the teacher role in the database.

security = HTTPBearer()

# Token -> (username, expires_at). Without this, every teacher API call makes a
# live round trip to huggingface.co: a dashboard that fires six requests pays
# six external calls, and an HF outage takes the teacher UI down with it.
# Short TTL so a revoked token stops working quickly.
_WHOAMI_TTL = 300.0
_whoami_cache: dict = {}


def _whoami_cached(token: str):
    entry = _whoami_cache.get(token)
    if entry and entry[1] > time.monotonic():
        return entry[0]
    _whoami_cache.pop(token, None)
    return None


async def current_teacher(credentials: HTTPAuthorizationCredentials = Security(security)) -> str:
    token = credentials.credentials
    username = _whoami_cached(token)

    if username is None:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(
                    "https://huggingface.co/api/whoami-v2",
                    headers={"Authorization": f"Bearer {token}"},
                )
        except httpx.HTTPError as exc:
            # Distinguish "we cannot check" from "you are not allowed". A 503
            # tells the client to retry; a 401 tells them to log in again.
            log.warning("whoami unreachable: %s", exc)
            raise HTTPException(
                status_code=503, detail="Identity provider unreachable. Try again."
            ) from exc

        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid or expired Hugging Face token.")
        username = resp.json().get("name")
        if not username:
            raise HTTPException(status_code=401, detail="Could not resolve username from token.")
        if len(_whoami_cache) > 500:
            _whoami_cache.clear()
        _whoami_cache[token] = (username, time.monotonic() + _WHOAMI_TTL)

    profile = await store.get_profile(username)
    if not profile or profile.get("role") != "teacher":
        raise HTTPException(status_code=403, detail="Not a teacher account.")

    return username


# ===========================================================================
# ROUTES — all declared before the Gradio mount
# ===========================================================================

class ClassroomIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""


class AssignmentIn(BaseModel):
    classroom_id: str
    title: str = Field(min_length=1, max_length=200)
    cefr_level: str
    target_topic: str = Field(min_length=1, max_length=300)
    feedback_style: str = "auto"
    min_turns: int = Field(default=5, ge=1, le=50)
    due_at: str | None = None


@app.get("/healthz")
async def healthz():
    """Liveness. Deliberately does no network I/O so it cannot be made to fail
    by a third party being down."""
    return {"status": "ok", "version": app.version}


@app.get(f"{API}/readyz")
async def readyz():
    """Readiness. Reports dependency configuration without leaking secrets."""
    return {
        "groq": settings.has_groq,
        "gemini_fallback": settings.has_gemini,
        "database": store.enabled,
        "assessors": await assessors.health(),
        "acoustic_check": verbatim.readiness(),
        "pronunciation": {
            "clarity": True,                       # always available
            "alignment": settings.alignment_enabled,
            "azure": settings.has_azure_speech,
        },
        "models": {
            "stt": settings.stt_model,
            "partner": settings.partner_model,
            "assessor": settings.assessor_model,
            "assessor_prompt": settings.assessor_prompt_variant,
        },
    }


@app.get(f"{API}/meta")
async def meta():
    """Everything a frontend needs to render pickers without hardcoding them."""
    return {
        "cefr_levels": CEFR_LEVELS,
        "voices": VOICES,
        "error_tags": [{"tag": t, "label": TAG_LABELS[t]} for t in ERROR_TAGS],
        "feedback_styles": ["auto", "explicit", "guided"],
    }


# ---- student -------------------------------------------------------------

@app.get(f"{API}/students/{{username}}/assignments")
async def student_assignments(username: str):
    return {"assignments": await store.open_assignments_for_student(username)}


@app.get(f"{API}/students/{{username}}/progress")
async def student_progress(username: str):
    return {
        "sessions": await store.student_sessions(username),
        "error_profile": await store.student_error_profile(username),
    }


@app.post(f"{API}/students/{{username}}/join")
async def join_classroom(username: str, join_code: str):
    classroom = await store.join_classroom(username, join_code)
    if not classroom:
        raise HTTPException(status_code=404, detail="No open classroom with that code.")
    return {"classroom": classroom}


# ---- teacher (gated) -----------------------------------------------------

@app.get(f"{API}/teacher/classrooms")
async def list_classrooms(teacher: str = Depends(current_teacher)):
    return {"classrooms": await store.list_classrooms_for_teacher(teacher)}


@app.post(f"{API}/teacher/classrooms")
async def create_classroom(body: ClassroomIn, teacher: str = Depends(current_teacher)):
    return {"classroom": await store.create_classroom(teacher, body.name, body.description)}


@app.get(f"{API}/teacher/classrooms/{{classroom_id}}/roster")
async def roster(classroom_id: str, teacher: str = Depends(current_teacher)):
    return {"roster": await store.roster(teacher, classroom_id)}


@app.get(f"{API}/teacher/classrooms/{{classroom_id}}/errors")
async def classroom_errors(classroom_id: str, teacher: str = Depends(current_teacher)):
    """The lesson-planning view: which of the eleven categories dominate this
    cohort, so the next lesson comes from evidence rather than impression."""
    profile = await store.classroom_error_profile(teacher, classroom_id)
    return {
        "classroom_id": classroom_id,
        "profile": [{**row, "label": TAG_LABELS.get(row["tag"], row["tag"])} for row in profile],
    }


@app.post(f"{API}/teacher/assignments")
async def create_assignment(body: AssignmentIn, teacher: str = Depends(current_teacher)):
    if body.cefr_level not in CEFR_LEVELS:
        raise HTTPException(status_code=422, detail="Unknown CEFR level.")
    return {
        "assignment": await store.create_assignment(
            teacher,
            body.classroom_id,
            body.title,
            body.cefr_level,
            body.target_topic,
            body.feedback_style,
            body.min_turns,
            body.due_at,
        )
    }


@app.get(f"{API}/teacher/assignments/{{assignment_id}}/progress")
async def assignment_progress(
    assignment_id: str, classroom_id: str, teacher: str = Depends(current_teacher)
):
    return {"progress": await store.assignment_progress(teacher, classroom_id, assignment_id)}


# ===========================================================================
# GRADIO MOUNT — must stay last
# ===========================================================================
# The import is deferred so that `import main` in a test does not pull in
# Gradio and build the whole UI. It also keeps the API importable in a worker
# process that has no display layer at all.

def _mount_gradio() -> None:
    import gradio as gr

    from ui.gradio_app import build_demo  # the refactored app.py

    demo = build_demo()
    gr.mount_gradio_app(app, demo, path="/")
    log.info("Gradio UI mounted at / (legacy leaf).")


if os.environ.get("DISABLE_GRADIO", "").lower() not in ("1", "true"):
    try:
        _mount_gradio()
    except Exception as exc:
        # The API must survive a broken UI. If Gradio fails to build, the
        # classroom endpoints still serve.
        log.error("Gradio failed to mount; API continues without it: %s", exc)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 7860)),
        reload=bool(os.environ.get("DEV")),
    )