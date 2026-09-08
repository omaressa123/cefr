"""
core.db
=======
Data access for the multi-tenant classroom model.

Two design decisions worth stating explicitly:

1. supabase-py's client is synchronous. Every call is pushed onto a worker
   thread with `asyncio.to_thread`, so the event loop is never blocked. This is
   version-agnostic and does not depend on the async client surface staying
   stable across releases.

2. TENANCY IS ENFORCED HERE, NOT BY RLS. Hugging Face OAuth yields a username,
   not a Supabase JWT, so `auth.uid()` is NULL and RLS cannot tell a teacher
   from a student. The service_role key bypasses RLS by design, which makes
   THIS FILE the security boundary. Every teacher-facing read passes through
   `_assert_owns_classroom` first. Adding a new teacher query without that
   check is a data leak between classrooms, not a style problem.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from .config import settings

log = logging.getLogger("cefr.db")


class NotAuthorized(Exception):
    """Raised when a caller asks for data belonging to another tenant."""


class Store:
    def __init__(self) -> None:
        self._client = None
        if settings.has_db:
            try:
                from supabase import create_client

                self._client = create_client(
                    settings.supabase_url, settings.supabase_service_key
                )
                log.info("Supabase persistence enabled.")
            except Exception as exc:
                log.error("Supabase init failed; running without persistence: %s", exc)
        else:
            log.info("Supabase not configured; sessions will not be saved.")

    @property
    def enabled(self) -> bool:
        return self._client is not None

    async def _run(self, fn: Callable) -> Any:
        return await asyncio.to_thread(fn)

    def _table(self, name: str):
        return self._client.table(name)

    # ---------------------------------------------------------------- guards

    async def _assert_owns_classroom(self, teacher: str, classroom_id: str) -> None:
        """The tenancy boundary. Call before any teacher-scoped read or write."""
        result = await self._run(
            lambda: self._table("classrooms")
            .select("id")
            .eq("id", classroom_id)
            .eq("teacher", teacher)
            .limit(1)
            .execute()
        )
        if not result.data:
            raise NotAuthorized(
                f"{teacher} does not own classroom {classroom_id}"
            )

    # --------------------------------------------------------------- profiles

    async def upsert_profile(
        self,
        username: str,
        display_name: str = "",
        avatar_url: str = "",
        role: Optional[str] = None,
    ) -> dict:
        """Upsert on sign-in. `role` is only written when explicitly supplied,
        so a routine sign-in can never silently demote a teacher to student."""
        if not self.enabled:
            return {}
        row = {
            "hf_username": username,
            "display_name": display_name or username,
            "avatar_url": avatar_url or None,
            "last_seen_at": datetime.now(timezone.utc).isoformat(),
        }
        if role in ("teacher", "student"):
            row["role"] = role
        result = await self._run(
            lambda: self._table("profiles")
            .upsert(row, on_conflict="hf_username")
            .execute()
        )
        return (result.data or [{}])[0]

    async def get_profile(self, username: str) -> Optional[dict]:
        if not self.enabled:
            return None
        result = await self._run(
            lambda: self._table("profiles")
            .select("*")
            .eq("hf_username", username)
            .limit(1)
            .execute()
        )
        return (result.data or [None])[0]

    async def set_role(self, username: str, role: str) -> None:
        if not self.enabled or role not in ("teacher", "student"):
            return
        await self._run(
            lambda: self._table("profiles")
            .update({"role": role})
            .eq("hf_username", username)
            .execute()
        )

    # ------------------------------------------------------------- classrooms

    async def create_classroom(self, teacher: str, name: str, description: str = "") -> dict:
        if not self.enabled:
            return {}
        result = await self._run(
            lambda: self._table("classrooms")
            .insert({"teacher": teacher, "name": name, "description": description or None})
            .execute()
        )
        return (result.data or [{}])[0]

    async def list_classrooms_for_teacher(self, teacher: str) -> list:
        if not self.enabled:
            return []
        result = await self._run(
            lambda: self._table("classrooms")
            .select("*")
            .eq("teacher", teacher)
            .eq("archived", False)
            .order("created_at", desc=True)
            .execute()
        )
        return result.data or []

    async def join_classroom(self, student: str, join_code: str) -> Optional[dict]:
        """Students join by code. Returns the classroom, or None if the code is
        wrong — deliberately indistinguishable from an archived classroom so the
        codes cannot be enumerated."""
        if not self.enabled:
            return None
        found = await self._run(
            lambda: self._table("classrooms")
            .select("*")
            .eq("join_code", join_code.strip().upper())
            .eq("archived", False)
            .limit(1)
            .execute()
        )
        classroom = (found.data or [None])[0]
        if not classroom:
            return None
        await self._run(
            lambda: self._table("enrollments")
            .upsert(
                {"classroom_id": classroom["id"], "student": student, "active": True},
                on_conflict="classroom_id,student",
            )
            .execute()
        )
        return classroom

    async def list_classrooms_for_student(self, student: str) -> list:
        if not self.enabled:
            return []
        result = await self._run(
            lambda: self._table("enrollments")
            .select("classroom_id, classrooms(id, name, teacher)")
            .eq("student", student)
            .eq("active", True)
            .execute()
        )
        return [row["classrooms"] for row in (result.data or []) if row.get("classrooms")]

    async def roster(self, teacher: str, classroom_id: str) -> list:
        await self._assert_owns_classroom(teacher, classroom_id)
        result = await self._run(
            lambda: self._table("enrollments")
            .select("student, joined_at, profiles(display_name, default_cefr_level)")
            .eq("classroom_id", classroom_id)
            .eq("active", True)
            .execute()
        )
        return result.data or []

    # ------------------------------------------------------------ assignments

    async def create_assignment(
        self,
        teacher: str,
        classroom_id: str,
        title: str,
        cefr_level: str,
        target_topic: str,
        feedback_style: str = "auto",
        min_turns: int = 5,
        due_at: Optional[str] = None,
    ) -> dict:
        await self._assert_owns_classroom(teacher, classroom_id)
        row = {
            "classroom_id": classroom_id,
            "title": title,
            "cefr_level": cefr_level,
            "target_topic": target_topic,
            "feedback_style": feedback_style,
            "min_turns": min_turns,
            "due_at": due_at,
        }
        result = await self._run(lambda: self._table("assignments").insert(row).execute())
        return (result.data or [{}])[0]

    async def open_assignments_for_student(self, student: str) -> list:
        """Assignments in every classroom the student is enrolled in that are
        currently open. Drives the 'what should I practise' prompt in the UI."""
        if not self.enabled:
            return []
        classrooms = await self.list_classrooms_for_student(student)
        ids = [c["id"] for c in classrooms if c]
        if not ids:
            return []
        now = datetime.now(timezone.utc).isoformat()
        result = await self._run(
            lambda: self._table("assignments")
            .select("*, classrooms(name)")
            .in_("classroom_id", ids)
            .lte("opens_at", now)
            .order("due_at", desc=False)
            .execute()
        )
        return result.data or []

    # --------------------------------------------------------------- sessions

    async def open_session(
        self,
        student: str,
        cefr_level: str,
        target_topic: str,
        voice: str,
        assignment_id: Optional[str] = None,
        classroom_id: Optional[str] = None,
    ) -> Optional[str]:
        """assignment_id may be None — free practice is a first-class case."""
        if not self.enabled:
            return None
        row = {
            "student": student,
            "cefr_level": cefr_level,
            "target_topic": (target_topic or "").strip() or "everyday conversation",
            "voice": voice,
            "assignment_id": assignment_id,
            "classroom_id": classroom_id,
        }
        result = await self._run(
            lambda: self._table("practice_sessions").insert(row).execute()
        )
        return (result.data or [{}])[0].get("id")

    async def log_exchange(self, session_id: str, turn_index: int, payload: dict) -> None:
        """Written per turn. A student closing the tab mid-session keeps
        everything they said up to that point."""
        if not self.enabled or not session_id:
            return
        row = {"session_id": session_id, "turn_index": turn_index, **payload}
        await self._run(lambda: self._table("exchanges").insert(row).execute())

    async def close_session(self, session_id: str, report_markdown: Optional[str] = None) -> None:
        if not self.enabled or not session_id:
            return
        patch: dict = {"ended_at": datetime.now(timezone.utc).isoformat()}
        if report_markdown:
            patch["report_markdown"] = report_markdown
        await self._run(
            lambda: self._table("practice_sessions")
            .update(patch)
            .eq("id", session_id)
            .execute()
        )

    # -------------------------------------------------------------- analytics

    async def student_sessions(self, student: str, limit: int = 12) -> list:
        if not self.enabled:
            return []
        result = await self._run(
            lambda: self._table("practice_sessions")
            .select("id, started_at, cefr_level, target_topic, turn_count, target_accuracy, error_count")
            .eq("student", student)
            .gt("turn_count", 0)
            .order("started_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []

    async def student_error_profile(self, student: str, limit: int = 11) -> list:
        """Per-category counts. Grouping on the tag rather than the corrected
        string is what makes 'I have went' and 'she have gone' finally count as
        one recurring problem instead of two unrelated strings."""
        if not self.enabled:
            return []
        result = await self._run(
            lambda: self._table("v_student_error_profile")
            .select("*")
            .eq("student", student)
            .order("occurrences", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []

    async def recent_error_tags(self, student: str, limit: int = 4) -> list:
        """The categories this learner keeps failing, most frequent first.

        Fed to the assessor as priming. Directing a search at the four things
        this student actually gets wrong beats telling a model to try harder --
        and it is only possible because errors are stored as tags rather than
        as free-text strings.
        """
        rows = await self.student_error_profile(student, limit=limit)
        return [r["tag"] for r in rows if r.get("tag")]

    async def classroom_error_profile(self, teacher: str, classroom_id: str) -> list:
        """The teacher's planning view: which categories dominate the cohort."""
        await self._assert_owns_classroom(teacher, classroom_id)
        result = await self._run(
            lambda: self._table("v_classroom_error_profile")
            .select("*")
            .eq("classroom_id", classroom_id)
            .order("occurrences", desc=True)
            .execute()
        )
        return result.data or []

    async def assignment_progress(self, teacher: str, classroom_id: str, assignment_id: str) -> list:
        await self._assert_owns_classroom(teacher, classroom_id)
        result = await self._run(
            lambda: self._table("v_assignment_progress")
            .select("*")
            .eq("assignment_id", assignment_id)
            .execute()
        )
        return result.data or []


store = Store()


# ===========================================================================
# BACKGROUND WRITES
# Persistence must never sit on the critical path of a turn, and must never be
# a bare create_task: an unreferenced task can be garbage-collected before it
# finishes and its exception is swallowed silently.
# ===========================================================================

_background: set = set()


def fire_and_forget(coro) -> None:
    task = asyncio.create_task(coro)
    _background.add(task)

    def _done(t: asyncio.Task) -> None:
        _background.discard(t)
        if not t.cancelled() and t.exception():
            log.warning("Background write failed: %s", t.exception())

    task.add_done_callback(_done)


def exchange_payload(result, turn_index: int) -> dict:
    """Map a core.engine.TurnResult onto an `exchanges` row."""
    assessment = result.assessment
    timings = result.timings
    return {
        "student_text": result.transcript,
        "partner_text": result.reply,
        "used_target": assessment.get("target_used", False),
        "target_evidence": assessment.get("target_evidence") or None,
        "errors": assessment.get("errors", []),
        "did_well": assessment.get("did_well", []),
        "level_impression": assessment.get("level_impression") or None,
        "target_rule": assessment.get("target_rule") or None,
        "uncertain": assessment.get("uncertain", []),
        "clauses": assessment.get("clauses", []),
        "assessor_model": assessment.get("assessor_model") or None,
        "clarity_flags": [
            {"text": s.text, "severity": s.severity} for s in (result.clarity or [])
        ],
        "feedback_style": result.feedback_style,
        "partner_provider": result.partner_provider,
        "assessor_provider": result.assessor_provider,
        "degraded": bool(assessment.get("degraded")),
        "stt_ms": int(timings.get("stt", 0) * 1000),
        "partner_ms": int(timings.get("partner", 0) * 1000),
        "assessor_ms": int(timings.get("assessor", 0) * 1000),
        "tts_ms": int(timings.get("tts", 0) * 1000),
    }
