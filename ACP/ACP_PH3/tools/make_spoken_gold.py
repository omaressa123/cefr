#!/usr/bin/env python3
"""
tools/make_spoken_gold.py
=========================
Build the spoken benchmark from real learner recordings. This is the file that
tells you how the product performs; gold_clean.jsonl only tells you how the
grammar knowledge underneath it performs.

WHY IT MUST BE SEPARATE FROM THE CAMBRIDGE SET
    Cambridge W&I is written essays. Your pipeline sees Whisper output from a
    nervous teenager on a phone microphone. The differences are not cosmetic:

      written essay          spoken turn through your pipeline
      -------------          ---------------------------------
      "I have went there"    "umm I have— I have went there I think"
      clean orthography      no spelling errors exist at all
      18-token sentences     8-15 token turns, mid-sentence restarts
      author's real errors   errors Whisper already silently repaired

    The last row is the one that matters. Your STT normalisation ceiling is
    invisible in a written benchmark, and it is the hard limit on everything
    downstream. This tool measures it directly.

PROTOCOL — three passes, in this order. Do not skip pass 1.

  PASS 1  Transcribe twice, compare.
          Every clip is transcribed conditioned and unconditioned. You annotate
          against the CONDITIONED transcript, because that is what the assessor
          actually sees. The diff between the two is your evidence of how much
          Whisper repairs. Recorded per clip as `stt_repairs`.

  PASS 2  Annotate the conditioned transcript.
          Mark errors on the text in front of you, using the 11 tags. Quote
          spans exactly as transcribed -- if Whisper wrote "doesn't" where the
          student said "don't", you annotate "doesn't" or nothing. Annotating
          what you HEARD rather than what was TRANSCRIBED produces gold the
          assessor cannot possibly match, which is the same unquotable-span
          trap that corrupted the Cambridge conversion.

  PASS 3  Record what was lost.
          For each error you heard but could not annotate because the
          transcript had already repaired it, add an entry to `unrecoverable`.
          That list is the single most important number in this project: it is
          the ceiling on assessment recall, and no prompt or model change moves
          it. Only a better STT path does.

SIZE AND COMPOSITION
    50 turns is enough to see a 20-point recall gap and not enough to see a
    5-point one. Aim for 8-10 per CEFR level you actually teach, and include:
      - at least 10 clean turns with NO errors (measures false positives, the
        thing a recall-only benchmark cannot see)
      - a few very short turns ("yes, I think so") -- these break assessors
      - one or two genuinely unintelligible clips -- the pipeline must degrade,
        not invent

USAGE
    # 1. drop wav/mp3 clips into a folder, then:
    python tools/make_spoken_gold.py transcribe recordings/ --out data/spoken_draft.jsonl

    # 2. annotate data/spoken_draft.jsonl by hand (schema printed by --schema)

    # 3. validate before you trust it:
    python tools/make_spoken_gold.py validate data/spoken_gold.jsonl

    # 4. benchmark:
    python tools/eval_assessor.py --gold data/spoken_gold.jsonl --domain spoken
"""

import argparse
import asyncio
import difflib
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.config import CEFR_LEVELS, ERROR_TAGS  # noqa: E402

AUDIO_SUFFIXES = {".wav", ".mp3", ".m4a", ".ogg", ".webm", ".flac"}
WORD = re.compile(r"[a-z0-9']+")

SCHEMA = """
One JSON object per line:

{
  "id": "clip_003",
  "audio": "recordings/clip_003.wav",
  "level": "A2",                       // the LEARNER's level, not the task's
  "topic": "past simple",
  "transcript": "umm I have went to Cairo last year with my family",
  "transcript_unconditioned": "I have gone to Cairo last year with my family",
  "stt_repairs": ["went -> gone"],     // filled by `transcribe`, verify by ear
  "errors": [
    {"student_said": "I have went", "tag": "verb_tense",
     "correction": "I went", "note": "present perfect with 'last year'"}
  ],
  "unrecoverable": [                   // heard but already repaired by Whisper
    {"heard": "she walk fast", "transcribed": "she walks fast",
     "tag": "subject_verb_agreement"}
  ],
  "clean": false,                      // true = no errors, tests false positives
  "domain": "spoken"
}

Rules that keep the file scorable:
  - `student_said` must appear VERBATIM in `transcript`. Validate enforces it.
  - `tag` must be one of the 11. Validate enforces it.
  - A turn with no errors sets "clean": true and "errors": []. Include ~20% of
    these or you cannot measure false positives at all.
"""


def tokens(text: str) -> list:
    return WORD.findall((text or "").lower())


# ===========================================================================
# TRANSCRIBE
# ===========================================================================

async def transcribe_folder(folder: Path, out: Path, level: str, topic: str) -> None:
    from core import audio as audio_mod

    clips = sorted(p for p in folder.rglob("*") if p.suffix.lower() in AUDIO_SUFFIXES)
    if not clips:
        sys.exit(f"No audio files under {folder}")

    print(f"Transcribing {len(clips)} clips, twice each "
          f"(conditioned + unconditioned)...")
    rows = []
    for index, clip in enumerate(clips, 1):
        try:
            conditioned = await audio_mod.transcribe(str(clip), condition=True)
            plain = await audio_mod.transcribe(str(clip), condition=False)
        except Exception as exc:
            print(f"  {clip.name}: FAILED ({exc.__class__.__name__}) -- "
                  f"include it anyway, a pipeline must degrade on bad audio")
            rows.append({
                "id": clip.stem, "audio": str(clip), "level": level, "topic": topic,
                "transcript": "", "transcript_unconditioned": "",
                "stt_repairs": [], "errors": [], "unrecoverable": [],
                "clean": False, "transcription_failed": True, "domain": "spoken",
            })
            continue

        repairs = diff_repairs(conditioned.text, plain.text)
        rows.append({
            "id": clip.stem,
            "audio": str(clip),
            "level": level,
            "topic": topic,
            "transcript": conditioned.text,
            "transcript_unconditioned": plain.text,
            "stt_repairs": repairs,
            "errors": [],
            "unrecoverable": [],
            "clean": False,
            "domain": "spoken",
        })
        marker = f"  ({len(repairs)} repair diffs)" if repairs else ""
        print(f"  [{index}/{len(clips)}] {clip.name}{marker}")

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    diffs = sum(1 for r in rows if r["stt_repairs"])
    print(f"\nWrote {len(rows)} draft rows -> {out}")
    print(f"{diffs}/{len(rows)} clips transcribed differently with and without "
          f"conditioning.")
    print("\nAnnotate `errors` against `transcript` (the CONDITIONED one -- that is\n"
          "what the assessor sees). Anything you heard but cannot quote there goes\n"
          "in `unrecoverable`. Then run: make_spoken_gold.py validate <file>")


def diff_repairs(conditioned: str, plain: str) -> list:
    """Word-level differences between the two transcriptions. Where they differ,
    one of them repaired something -- usually the unconditioned one."""
    a, b = tokens(conditioned), tokens(plain)
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b).get_opcodes():
        if op == "equal":
            continue
        out.append(f"{' '.join(a[i1:i2]) or '-'} -> {' '.join(b[j1:j2]) or '-'}")
    return out[:10]


# ===========================================================================
# VALIDATE
# ===========================================================================

def validate(path: Path) -> int:
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    problems = Counter()
    per_level, per_tag = Counter(), Counter()
    clean_turns = 0
    unrecoverable = 0
    total_errors = 0

    for row in rows:
        level = row.get("level")
        per_level[level] += 1
        if level not in CEFR_LEVELS:
            problems["level not in CEFR_LEVELS"] += 1

        transcript = row.get("transcript", "")
        hay = tokens(transcript)
        if row.get("clean"):
            clean_turns += 1
            if row.get("errors"):
                problems["marked clean but has errors"] += 1

        unrecoverable += len(row.get("unrecoverable") or [])

        for error in row.get("errors") or []:
            total_errors += 1
            tag = error.get("tag")
            per_tag[tag] += 1
            if tag not in ERROR_TAGS:
                problems[f"tag outside taxonomy: {tag}"] += 1
            needle = tokens(error.get("student_said", ""))
            if not needle:
                problems["empty student_said"] += 1
            elif not any(hay[i : i + len(needle)] == needle
                         for i in range(len(hay) - len(needle) + 1)):
                problems["student_said not in transcript"] += 1

    print(f"Spoken gold: {path}")
    print(f"  turns              {len(rows)}")
    print(f"  labelled errors    {total_errors}")
    print(f"  clean turns        {clean_turns} ({clean_turns/max(len(rows),1):.0%})")
    print(f"  unrecoverable      {unrecoverable}")

    if problems:
        print("\nProblems (fix before benchmarking):")
        for reason, count in problems.most_common():
            print(f"  {count:4d}  {reason}")
    else:
        print("\nNo structural problems.")

    print("\nLevel coverage:")
    for level in CEFR_LEVELS:
        n = per_level.get(level, 0)
        if n:
            print(f"  {level}  {n:4d}" + ("  <-- thin" if n < 5 else ""))

    print("\nTag coverage:")
    for tag in ERROR_TAGS:
        n = per_tag.get(tag, 0)
        print(f"  {tag:28s} {n:4d}" + ("  <-- untested" if n == 0 else ""))

    # The number this whole exercise exists to produce.
    if total_errors + unrecoverable:
        ceiling = total_errors / (total_errors + unrecoverable)
        print(f"\nSTT RECALL CEILING: {ceiling:.0%}")
        print(f"  {unrecoverable} errors you heard were already repaired by Whisper before")
        print(f"  the assessor saw them. No prompt change, no bigger model and no local")
        print(f"  SLM can recover those. Aggregate assessor recall cannot exceed "
              f"{ceiling:.0%}\n  on this pipeline -- and every recall number you report "
              f"should say so.")
        if ceiling < 0.8:
            print("\n  Below 80%: your STT path, not your assessor, is the binding")
            print("  constraint. Work on transcription before touching the prompt.")

    if clean_turns < len(rows) * 0.15:
        print(f"\n  Only {clean_turns} clean turns. Without them you cannot measure false")
        print("  positives, and a model that flags everything scores well on recall.")

    return 1 if problems else 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    t = sub.add_parser("transcribe", help="draft rows from a folder of clips")
    t.add_argument("folder")
    t.add_argument("--out", default="data/spoken_draft.jsonl")
    t.add_argument("--level", default="B1")
    t.add_argument("--topic", default="everyday conversation")

    v = sub.add_parser("validate", help="check an annotated file before benchmarking")
    v.add_argument("path")

    sub.add_parser("schema", help="print the annotation schema")

    args = parser.parse_args()

    if args.command == "schema":
        print(SCHEMA)
    elif args.command == "transcribe":
        asyncio.run(transcribe_folder(
            Path(args.folder), Path(args.out), args.level, args.topic))
    else:
        sys.exit(validate(Path(args.path)))


if __name__ == "__main__":
    main()
