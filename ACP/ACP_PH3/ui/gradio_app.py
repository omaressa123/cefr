"""
ui/gradio_app.py
================
The legacy UI leaf of the strangler fig.

This module is allowed to know about Gradio. It is NOT allowed to know about
prompts, model names, Supabase queries, or provider routing — all of that lives
in core/ and is reached through three call sites:

    engine.run_turn()          one conversational turn
    engine.render_feedback()   markdown for the feedback panel
    engine.generate_report()   end-of-session report
    db.store.*                 persistence

When the WebRTC frontend is ready, this file is deleted and nothing in core/
changes. That is the whole point of the split.
"""

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import gradio as gr

from core import audio, db, engine, llm
from core.config import CEFR_LEVELS, TAG_LABELS, VOICES, settings

log = logging.getLogger("cefr.ui")

REQUIRE_LOGIN = os.environ.get("REQUIRE_LOGIN", "false").lower() == "true"
DEFAULT_VOICE = "UK female (Sonia)"

# ===========================================================================
# STYLE
# ===========================================================================

CSS = """
:root {
  --accent: #0f766e;
  --accent-soft: rgba(15,118,110,0.10);
  --warn: #b45309;
  --radius: 14px;
}
.gradio-container { max-width: 1180px !important; margin: 0 auto !important; padding: 16px !important; }

.topbar {
  display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
  padding: 14px 18px; border-radius: var(--radius);
  background: var(--accent-soft);
  border: 1px solid rgba(15,118,110,0.22);
  margin-bottom: 14px;
}
.topbar h1 { margin: 0; font-size: 1.15rem; font-weight: 700; letter-spacing: -0.01em; }
.topbar .spacer { flex: 1 1 auto; }

.panel { border-radius: var(--radius) !important; border: 1px solid var(--border-color-primary) !important; padding: 10px !important; }
.panel-head { font-weight: 700 !important; font-size: 1rem !important; }

.chip { display: inline-block; padding: 4px 11px; border-radius: 999px; font-size: 0.85rem; font-weight: 700; }
.chip-hit  { background: rgba(15,118,110,0.14); color: var(--accent); }
.chip-miss { background: rgba(180,83,9,0.12); color: var(--warn); }
.muted { opacity: 0.65; font-size: 0.87rem; }

.send-btn { min-height: 54px !important; border-radius: var(--radius) !important; font-size: 1.02rem !important; font-weight: 700 !important; }
.ghost-btn { min-height: 46px !important; border-radius: var(--radius) !important; }
.status-line { font-size: 0.9rem !important; opacity: 0.8; padding: 4px 2px !important; }

.feedback-panel { font-size: 1rem; line-height: 1.6; }
.feedback-panel blockquote { border-left: 3px solid var(--accent); margin: 8px 0; padding: 2px 0 2px 12px; font-style: normal; }
.feedback-panel details { margin-top: 10px; background: rgba(127,127,127,0.09); padding: 8px 10px; border-radius: 8px; }
.feedback-panel summary { font-weight: 600; cursor: pointer; color: var(--accent); }

@media (max-width: 860px) {
  .gradio-container { padding: 10px !important; }
  .stack-on-mobile { flex-direction: column !important; }
  .stack-on-mobile > * { min-width: 100% !important; flex: 1 1 100% !important; }
  .topbar { padding: 12px 14px; }
  .topbar h1 { font-size: 1.02rem; }
  .send-btn { min-height: 60px !important; font-size: 1.08rem !important; }
  .chatbot-main { height: 44vh !important; }
  .action-row { position: sticky; bottom: 0; z-index: 20; padding: 8px 0; background: var(--background-fill-primary); }
}
"""

IDLE_FEEDBACK = (
    "**Your feedback appears here**\n\n"
    "After every turn you will see whether you used your target structure, "
    "any corrections worth making, and one coaching note."
)

NO_ASSIGNMENT = "Free practice (no assignment)"


# ===========================================================================
# SESSION STATE
# ===========================================================================

def new_session() -> dict:
    return {
        "turns": 0,
        "target_hits": 0,
        "exchanges": [],
        "db_session_id": None,
        "assignment_id": None,
        "classroom_id": None,
        "feedback_style": "auto",
        "focus_tags": [],
        "started_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


# ===========================================================================
# RENDERING
# ===========================================================================

def render_progress(sessions: list, error_profile: list, username: Optional[str]) -> str:
    if not username:
        return "Sign in with Hugging Face to keep a history of your practice."
    if not db.store.enabled:
        return "Persistence is not configured on this Space, so no history is being saved."
    if not sessions:
        return f"No completed sessions yet, {username}. Finish a turn and it will show up here."

    rows = [
        "| Date | Level | Target | Turns | On target |",
        "| --- | --- | --- | ---: | ---: |",
    ]
    for item in sessions:
        date = (item.get("started_at") or "")[:10]
        accuracy = item.get("target_accuracy")
        accuracy_text = f"{float(accuracy):.0%}" if accuracy is not None else "--"
        rows.append(
            f"| {date} | {item.get('cefr_level', '')} "
            f"| {str(item.get('target_topic', ''))[:40]} "
            f"| {item.get('turn_count', 0)} | {accuracy_text} |"
        )

    out = ["**Recent sessions**", "", *rows]

    if error_profile:
        out += ["", "**Patterns that keep coming back**", ""]
        for row in error_profile:
            label = TAG_LABELS.get(row.get("tag"), row.get("tag", ""))
            out.append(f"- {label} — {row.get('occurrences', 0)}x "
                       f"across {row.get('sessions_affected', 0)} session(s)")
    return "\n".join(out)


def render_classrooms(classrooms: list, assignments: list, username: Optional[str]) -> str:
    if not username:
        return "Sign in to join a class."
    if not db.store.enabled:
        return "Classroom features need Supabase configured on this Space."
    if not classrooms:
        return "You are not in any class yet. Ask your teacher for a join code."

    lines = ["**Your classes**", ""]
    lines += [f"- {c.get('name', 'Untitled')}" for c in classrooms]

    if assignments:
        lines += ["", "**Open assignments**", ""]
        for a in assignments:
            due = (a.get("due_at") or "")[:10]
            classroom_name = (a.get("classrooms") or {}).get("name", "")
            lines.append(
                f"- **{a.get('title')}** — {a.get('cefr_level')} · {a.get('target_topic')}"
                + (f" · {classroom_name}" if classroom_name else "")
                + (f" · due {due}" if due else "")
            )
    return "\n".join(lines)


def assignment_choices(assignments: list) -> list:
    return [NO_ASSIGNMENT] + [
        f"{a.get('title')} — {a.get('cefr_level')} · {a.get('target_topic')}"
        for a in assignments
    ]


# ===========================================================================
# LOAD / AUTH
# ===========================================================================

async def _load_student_context(username: str) -> tuple:
    sessions, error_profile, classrooms, assignments = [], [], [], []
    if db.store.enabled:
        try:
            sessions, error_profile, classrooms, assignments = await asyncio.gather(
                db.store.student_sessions(username),
                db.store.student_error_profile(username),
                db.store.list_classrooms_for_student(username),
                db.store.open_assignments_for_student(username),
            )
        except Exception as exc:
            log.warning("Context load failed for %s: %s", username, exc)
    return sessions, error_profile, classrooms, assignments


async def on_load(profile: Optional[gr.OAuthProfile] = None):
    """Page load and post-OAuth redirect.

    `profile` is injected by Gradio from the runtime annotation. This module
    must never add `from __future__ import annotations` — postponed evaluation
    turns the annotation into a string and the injection silently yields None.
    """
    if profile is None:
        return (
            gr.update(value="Practising as a guest. Sign in to save your progress.", visible=True),
            render_progress([], [], None),
            render_classrooms([], [], None),
            gr.update(choices=[NO_ASSIGNMENT], value=NO_ASSIGNMENT),
            [],
        )

    username = profile.username
    db.fire_and_forget(
        db.store.upsert_profile(
            username, profile.name or username, getattr(profile, "picture", "") or ""
        )
    )

    sessions, error_profile, classrooms, assignments = await _load_student_context(username)

    banner = f"Signed in as **{username}**."
    if not db.store.enabled:
        banner += " History is switched off on this Space."

    return (
        gr.update(value=banner, visible=True),
        render_progress(sessions, error_profile, username),
        render_classrooms(classrooms, assignments, username),
        gr.update(choices=assignment_choices(assignments), value=NO_ASSIGNMENT),
        assignments,
    )


async def join_class(code: str, profile: Optional[gr.OAuthProfile] = None):
    if profile is None:
        return "Sign in first, then enter your join code.", gr.update(), []
    if not (code or "").strip():
        return "Enter the code your teacher gave you.", gr.update(), []
    if not db.store.enabled:
        return "Classroom features need Supabase configured.", gr.update(), []

    classroom = await db.store.join_classroom(profile.username, code)
    if not classroom:
        return "No open class with that code.", gr.update(), []

    _, _, classrooms, assignments = await _load_student_context(profile.username)
    return (
        render_classrooms(classrooms, assignments, profile.username),
        gr.update(choices=assignment_choices(assignments), value=NO_ASSIGNMENT),
        assignments,
    )


def pick_assignment(choice: str, assignments: list, session: dict):
    """Selecting an assignment drives level, topic and feedback style, and binds
    the session to a classroom so the teacher's cohort view is not empty."""
    session = dict(session or new_session())

    if not choice or choice == NO_ASSIGNMENT or not assignments:
        session.update(assignment_id=None, classroom_id=None, feedback_style="auto")
        return session, gr.update(), gr.update(), "Free practice — pick your own target."

    index = assignment_choices(assignments).index(choice) - 1
    assignment = assignments[index]
    session.update(
        assignment_id=assignment.get("id"),
        classroom_id=assignment.get("classroom_id"),
        feedback_style=assignment.get("feedback_style", "auto"),
    )
    note = (f"Working on **{assignment.get('title')}** — "
            f"{assignment.get('min_turns', 5)} turns minimum.")
    return (
        session,
        gr.update(value=assignment.get("cefr_level")),
        gr.update(value=assignment.get("target_topic")),
        note,
    )


# ===========================================================================
# TURN
# ===========================================================================

async def practice_turn(
    audio_path,
    level,
    topic,
    voice_label,
    chat,
    session,
    profile: Optional[gr.OAuthProfile] = None,
    progress=gr.Progress(),
):
    chat = list(chat or [])
    session = session or new_session()

    def bail(message: str):
        return chat, gr.update(), None, session, message, None, gr.update(interactive=True)

    # NOTE: this handler is an async GENERATOR. Gradio streams each yield to the
    # outputs list. Every early exit below must `yield bail(...); return` --
    # a bare `return <tuple>` in a generator raises StopIteration with a value
    # and Gradio renders nothing at all.

    if not settings.has_groq:
        yield bail("GROQ_API_KEY is not set. Add it in Settings and restart the Space.")
        return
    if REQUIRE_LOGIN and profile is None:
        yield bail("Sign in with Hugging Face to start practising.")
        return

    progress(0.1, desc="Listening…")

    # Prime the assessor with the categories this learner keeps failing. Fetched
    # once per session, not per turn -- an extra round trip on every turn would
    # sit on the critical path for a list that changes slowly.
    if profile is not None and db.store.enabled and not session.get("focus_tags"):
        try:
            session["focus_tags"] = await db.store.recent_error_tags(profile.username)
        except Exception as exc:
            log.warning("Could not load focus tags: %s", exc)

    try:
        result = await engine.run_turn(
            audio_path=audio_path,
            level=level,
            topic=topic,
            voice_id=VOICES.get(voice_label, VOICES[DEFAULT_VOICE]),
            history=chat,
            feedback_style=session.get("feedback_style", "auto"),
            focus_tags=session.get("focus_tags"),
        )
    except (audio.EmptyAudio, audio.TranscriptionRejected) as exc:
        yield bail(str(exc))
        return
    except llm.AllProvidersFailed:
        yield bail("Both language models are unavailable right now. Wait a moment and try again.")
        return
    except Exception as exc:
        log.exception("Turn execution failed")
        yield bail(f"Processing failed ({exc.__class__.__name__}). Please try again.")
        return

    session["turns"] += 1
    if not result.assessment_pending and result.assessment.get("target_used"):
        session["target_hits"] += 1
    session["exchanges"].append({
        "student": result.transcript,
        "errors": result.assessment.get("errors", []),
    })

    chat.append({"role": "user", "content": result.transcript})
    chat.append({"role": "assistant", "content": result.reply})

    # Persistence -----------------------------------------------------------
    # The session row is opened on the awaited path, once, on the first turn.
    # Doing it inside fire_and_forget would let two rapid turns each observe
    # db_session_id is None and open two rows, after which turn indices land in
    # the wrong session and the analytics silently rot. One ~80ms insert per
    # session is a cheap price for not having to debug that later.
    if profile is not None and db.store.enabled:
        try:
            if session.get("db_session_id") is None:
                session["db_session_id"] = await db.store.open_session(
                    student=profile.username,
                    cefr_level=level,
                    target_topic=topic,
                    voice=voice_label,
                    assignment_id=session.get("assignment_id"),
                    classroom_id=session.get("classroom_id"),
                )
            if not result.assessment_pending:
                db.fire_and_forget(
                    db.store.log_exchange(
                        session["db_session_id"],
                        session["turns"] - 1,
                        db.exchange_payload(result, session["turns"] - 1),
                    )
                )
        except Exception as exc:
            log.warning("Could not persist turn: %s", exc)

    if getattr(result, "transcript_leak_suspected", False):
        log.info("Turn kept despite prompt-shaped transcript (audio corroborated).")

    timings = result.timings
    status = (
        f"Turn {session['turns']} — {result.total_seconds:.1f}s "
        f"(speech {timings.get('stt', 0):.1f} / reply {timings.get('partner', 0):.1f} "
        f"/ assessor {timings.get('assessor', 0):.1f} / voice {timings.get('tts', 0):.1f})"
    )
    if result.audio_path is None:
        status += " — voice unavailable, read the reply above"

    progress(1.0, desc="Done")

    # First yield: the learner hears the reply. In deferred mode the feedback
    # panel says "checking" rather than blocking the audio behind a slow
    # assessor -- which is what makes a local SLM usable at all.
    yield (
        chat,
        engine.render_feedback(result, topic, session["turns"], session["target_hits"]),
        result.audio_path,
        session,
        status,
        None,
        gr.update(interactive=True),
    )

    if not result.assessment_pending:
        return

    # Second yield: the assessment landed. Session counters are updated here
    # rather than above, because until now there was nothing to count.
    result = await engine.await_assessment(result)
    if result.assessment.get("target_used"):
        session["target_hits"] += 1
    session["exchanges"][-1]["errors"] = result.assessment.get("errors", [])

    if profile is not None and db.store.enabled and session.get("db_session_id"):
        db.fire_and_forget(
            db.store.log_exchange(
                session["db_session_id"],
                session["turns"] - 1,
                db.exchange_payload(result, session["turns"] - 1),
            )
        )

    yield (
        chat,
        engine.render_feedback(result, topic, session["turns"], session["target_hits"]),
        result.audio_path,
        session,
        status + f" · feedback {result.timings.get('assessor', 0):.1f}s",
        None,
        gr.update(interactive=True),
    )


# ===========================================================================
# REPORT
# ===========================================================================

async def end_session(level, topic, session, profile: Optional[gr.OAuthProfile] = None):
    session = session or new_session()
    if session["turns"] == 0:
        return "Record at least one turn first.", None, "No turns recorded yet.", gr.update()

    try:
        body, provider = await engine.generate_report(level, topic, session)
    except llm.AllProvidersFailed:
        return (
            "Report generation is unavailable right now. Try again shortly.",
            None,
            "Report failed.",
            gr.update(),
        )

    accuracy = session["target_hits"] / session["turns"]
    target = (topic or "").strip() or "everyday conversation"
    error_count = sum(len(e.get("errors", [])) for e in session.get("exchanges", []))

    report = (
        "# Session report\n\n"
        f"**Level** {level} · **Target** {target} · **Turns** {session['turns']} · "
        f"**On target** {session['target_hits']} ({accuracy:.0%}) · "
        f"**Errors logged** {error_count}\n\n---\n\n{body}"
    )

    audio.prune_generated_files()
    report_path = audio.AUDIO_DIR / f"report_{uuid.uuid4().hex}.md"
    report_path.write_text(report, encoding="utf-8")

    progress_update = gr.update()
    if profile is not None and db.store.enabled and session.get("db_session_id"):
        try:
            await db.store.close_session(session["db_session_id"], report)
            sessions, error_profile = await asyncio.gather(
                db.store.student_sessions(profile.username),
                db.store.student_error_profile(profile.username),
            )
            progress_update = render_progress(sessions, error_profile, profile.username)
        except Exception as exc:
            log.warning("Could not close session in Supabase: %s", exc)

    note = "Report ready." if provider == "groq" else f"Report ready (via {provider})."
    return report, str(report_path), note, progress_update


def reset_session():
    return (
        [], new_session(), IDLE_FEEDBACK, None, None, "",
        "Ready when you are.", gr.update(interactive=True),
    )


def _lock_send():
    return gr.update(interactive=False, value="Working…")


def _unlock_send():
    return gr.update(interactive=True, value="Send turn")


# --- the clipped-audio race, UI half --------------------------------------
# Gradio finalises the recording on `stop_recording`. If the learner hits Send
# while still recording, the component hands over a partial file; Whisper
# answers "Thank you." with high confidence and the silence rejector fires,
# which reads to the user as the app being broken.
#
# Both halves are needed. This one makes the mistake unavailable; the duration
# gate in core.audio.validate_upload catches the paths this cannot cover (a
# stale file, an autosubmit, a future WebRTC caller).

def _recording_started():
    return (gr.update(interactive=False, value="Recording… release to send"),
            "Recording. Press the square to stop, then send.")


def _recording_stopped():
    return (gr.update(interactive=True, value="Send turn"),
            "Ready to send.")


# ===========================================================================
# LAYOUT
# ===========================================================================

def build_demo() -> gr.Blocks:
    with gr.Blocks(title="CEFR English Practice Partner", css=CSS, theme=gr.themes.Soft()) as demo:
        session_state = gr.State(new_session())
        assignments_state = gr.State([])

        with gr.Row(elem_classes=["topbar"]):
            gr.HTML("<h1>CEFR English Practice Partner</h1>")
            gr.HTML('<div class="spacer"></div>')
            gr.LoginButton()

        account_banner = gr.Markdown("", visible=False, elem_classes=["muted"])

        if not settings.has_groq:
            gr.Markdown(
                "**GROQ_API_KEY is not set.** Add it in Settings → Variables and secrets, "
                "then restart the Space."
            )

        with gr.Tabs():
            # -------------------------------------------------------------- Practice
            with gr.Tab("Practice"):
                with gr.Row(elem_classes=["stack-on-mobile"]):
                    with gr.Column(scale=7, elem_classes=["panel"]):
                        # type="messages" is required: the handlers append dicts.
                        # Without it Gradio falls back to the tuple format and
                        # the transcript renders wrong or errors outright.
                        chatbot = gr.Chatbot(
                            type="messages",
                            height=440,
                            show_label=False,
                            elem_classes=["chatbot-main"],
                        )
                        with gr.Row(elem_classes=["stack-on-mobile"]):
                            audio_in = gr.Audio(
                                sources=["microphone"],
                                type="filepath",
                                label="Your answer",
                                show_download_button=False,
                            )
                            audio_out = gr.Audio(
                                label="Your partner", autoplay=True, interactive=False
                            )
                        with gr.Row(elem_classes=["action-row"]):
                            send_btn = gr.Button(
                                "Send turn", variant="primary",
                                elem_classes=["send-btn"], scale=3,
                            )
                            reset_btn = gr.Button(
                                "Start over", elem_classes=["ghost-btn"], scale=1
                            )
                        status = gr.Markdown("Ready when you are.", elem_classes=["status-line"])

                    with gr.Column(scale=4, elem_classes=["panel"]):
                        gr.Markdown("Feedback", elem_classes=["panel-head"])
                        feedback = gr.Markdown(IDLE_FEEDBACK, elem_classes=["feedback-panel"])

                        with gr.Accordion("Practice setup", open=True):
                            assignment_picker = gr.Dropdown(
                                choices=[NO_ASSIGNMENT],
                                value=NO_ASSIGNMENT,
                                label="Assignment",
                                info="Choosing one sets your level and target automatically.",
                            )
                            assignment_note = gr.Markdown(
                                "Free practice — pick your own target.",
                                elem_classes=["muted"],
                            )
                            level = gr.Dropdown(
                                choices=CEFR_LEVELS,
                                value="B1",
                                label="Your level",
                                info="Sets vocabulary, sentence length and speaking speed.",
                            )
                            topic = gr.Textbox(
                                label="What do you want to practise?",
                                placeholder="past continuous / phrasal verbs for travel / giving opinions",
                                lines=2,
                            )
                        with gr.Accordion("Voice and audio", open=False):
                            voice = gr.Dropdown(
                                choices=list(VOICES.keys()),
                                value=DEFAULT_VOICE,
                                label="Partner voice",
                            )
                            gr.Markdown(
                                "Keep answers to roughly 10 to 30 seconds. Longer clips take "
                                "longer to come back.",
                                elem_classes=["muted"],
                            )

            # -------------------------------------------------------------- Report
            with gr.Tab("Report"):
                gr.Markdown(
                    "Finish a conversation, then generate a written report on what went well "
                    "and what to work on next.",
                    elem_classes=["muted"],
                )
                end_btn = gr.Button(
                    "End session and write report", variant="primary",
                    elem_classes=["send-btn"],
                )
                report_md = gr.Markdown("")
                report_file = gr.File(label="Download report")

            # -------------------------------------------------------------- Class
            with gr.Tab("My class"):
                gr.Markdown(
                    "Join your teacher's class with the code they gave you. "
                    "Your practice then counts towards their assignments.",
                    elem_classes=["muted"],
                )
                with gr.Row(elem_classes=["stack-on-mobile"]):
                    join_code = gr.Textbox(
                        label="Join code", placeholder="ABC123", max_lines=1, scale=3
                    )
                    join_btn = gr.Button("Join class", elem_classes=["ghost-btn"], scale=1)
                classrooms_md = gr.Markdown("Sign in to join a class.")

            # -------------------------------------------------------------- Progress
            with gr.Tab("Progress"):
                progress_md = gr.Markdown(
                    "Sign in with Hugging Face to keep a history of your practice."
                )
                refresh_btn = gr.Button("Refresh", elem_classes=["ghost-btn"])

        # ------------------------------------------------------------ wiring
        turn_inputs = [audio_in, level, topic, voice, chatbot, session_state]
        turn_outputs = [chatbot, feedback, audio_out, session_state, status, audio_in, send_btn]

        # Lock the button first so a student mashing it cannot fire four
        # concurrent turns against the same session state.
        send_btn.click(_lock_send, None, send_btn, queue=False).then(
            practice_turn, turn_inputs, turn_outputs,
            concurrency_limit=4, show_progress="full",
        ).then(_unlock_send, None, send_btn, queue=False)

        # Disable Send for the duration of the recording.
        audio_in.start_recording(
            _recording_started, None, [send_btn, status], queue=False
        )
        audio_in.stop_recording(_lock_send, None, send_btn, queue=False).then(
            practice_turn, turn_inputs, turn_outputs,
            concurrency_limit=4, show_progress="full",
        ).then(_unlock_send, None, send_btn, queue=False)

        end_btn.click(
            end_session,
            [level, topic, session_state],
            [report_md, report_file, status, progress_md],
            concurrency_limit=2,
        )

        reset_btn.click(
            reset_session,
            None,
            [chatbot, session_state, feedback, audio_out, report_file, report_md,
             status, send_btn],
        )

        assignment_picker.change(
            pick_assignment,
            [assignment_picker, assignments_state, session_state],
            [session_state, level, topic, assignment_note],
        )

        join_btn.click(
            join_class,
            [join_code],
            [classrooms_md, assignment_picker, assignments_state],
        )

        load_outputs = [
            account_banner, progress_md, classrooms_md, assignment_picker, assignments_state
        ]
        demo.load(on_load, None, load_outputs)
        refresh_btn.click(on_load, None, load_outputs)

    return demo
