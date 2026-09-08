#!/usr/bin/env python3
"""
tools/export_assessor_dataset.py
================================
Export recorded exchanges from Supabase as JSONL for fine-tuning a small
assessor model.

READ THIS BEFORE YOU TRAIN ANYTHING
    Your `exchanges` table stores what the CLOUD ASSESSOR produced. It does not
    store what a teacher decided. Training on it is DISTILLATION: the student
    model's ceiling is gpt-oss-120b's behaviour, including every miss and every
    dropped clause. You cannot distil your way past the teacher model, and if
    the cloud assessor under-reports at A2 — the complaint that started this —
    the small model learns to under-report at A2 too, faster and cheaper.

    To train something BETTER you need human labels. `schema_v2.sql` now has a
    `teacher_reviews` table and this script emits three splits so you always
    know which you are holding:

        --source reviewed   teacher-verified only          -> real SFT
        --source distill    model output only              -> distillation
        --source mixed      reviewed, backfilled by model  -> pragmatic start

    Default is `reviewed`, because the failure mode here is silent: a mixed
    file looks exactly like a clean one and you find out at eval time.

VOLUME
    Structured extraction of this shape typically needs 1,000-3,000 examples
    before a 3-4B model is competitive, and the examples must cover all six
    CEFR levels and all eleven tags. `--stats` reports coverage per level and
    per tag so you can see which cells are empty before you spend GPU hours on
    a set that has forty A1 turns and none at C1.

USAGE
    python tools/export_assessor_dataset.py --out data/assessor.jsonl
    python tools/export_assessor_dataset.py --source mixed --stats
    python tools/export_assessor_dataset.py --format sharegpt --split 0.9
"""

import argparse
import collections
import json
import os
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.config import (  # noqa: E402
    ASSESSOR_PROMPT,
    CEFR_LEVELS,
    ERROR_SELECTION,
    ERROR_TAGS,
    FEEDBACK_STYLE_BLOCKS,
    build_focus_block,
    build_tag_probes,
    resolve_feedback_style,
)


def build_system(level: str, topic: str, style: str, focus_tags=None) -> str:
    """Reuse the production prompt verbatim.

    Training on a paraphrase of the prompt you serve is a classic way to get a
    model that scores well offline and misbehaves in production, so the system
    string is imported rather than retyped.
    """
    return ASSESSOR_PROMPT.format(
        level=level,
        topic=(topic or "").strip() or "everyday conversation",
        tag_probes=build_tag_probes(),
        focus_block=build_focus_block(focus_tags),
        selection=ERROR_SELECTION.get(level, ERROR_SELECTION["B1"]),
        feedback_style=FEEDBACK_STYLE_BLOCKS[style],
    )


def fetch_rows(source: str, limit: int) -> list:
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if not (url and key):
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")

    client = create_client(url, key)
    view = {
        "reviewed": "v_assessor_training_reviewed",
        "distill": "v_assessor_training_distill",
        "mixed": "v_assessor_training_mixed",
    }[source]
    result = client.table(view).select("*").limit(limit).execute()
    return result.data or []


def to_target(row: dict) -> dict:
    """The completion the model must learn to produce."""
    return {
        "target_rule": row.get("target_rule") or "",
        "clauses": row.get("clauses") or [],
        "errors": [
            {
                "student_said": e.get("student_said", ""),
                "correction": e.get("correction", ""),
                "tag": e.get("tag", ""),
                "explanation": e.get("explanation", ""),
                "confidence": e.get("confidence", "high"),
            }
            for e in (row.get("errors") or [])
        ],
        "did_well": row.get("did_well") or [],
        "target_used": bool(row.get("used_target")),
        "target_evidence": row.get("target_evidence") or "",
        "level_impression": row.get("level_impression") or "",
    }


def valid(row: dict, target: dict) -> tuple:
    """Reject rows that would teach the model to break a guardrail.

    A training set containing an unquotable error teaches the model that
    fabrication is acceptable, and `_substring_match` will then silently drop
    the outputs at inference — the worst of both worlds.
    """
    student = (row.get("student_text") or "").strip()
    if len(student) < 3:
        return False, "utterance too short"
    if row.get("degraded"):
        return False, "degraded turn"
    if row.get("cefr_level") not in CEFR_LEVELS:
        return False, "unknown level"

    haystack = " ".join(student.lower().split())
    for error in target["errors"]:
        if error["tag"] not in ERROR_TAGS:
            return False, f"tag outside taxonomy: {error['tag']}"
        needle = " ".join(error["student_said"].lower().split())
        if not needle or needle not in haystack:
            return False, "unquotable error in target"
    if not target["did_well"]:
        return False, "empty did_well"
    return True, ""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", choices=["reviewed", "distill", "mixed"],
                        default="reviewed")
    parser.add_argument("--out", default="data/assessor.jsonl")
    parser.add_argument("--format", choices=["sft", "sharegpt"], default="sft")
    parser.add_argument("--limit", type=int, default=10000)
    parser.add_argument("--split", type=float, default=0.9,
                        help="train fraction; the rest becomes the eval set")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--stats", action="store_true")
    args = parser.parse_args()

    rows = fetch_rows(args.source, args.limit)
    print(f"Fetched {len(rows)} rows from source={args.source}")

    kept, rejected = [], collections.Counter()
    per_level, per_tag = collections.Counter(), collections.Counter()

    for row in rows:
        target = to_target(row)
        ok, reason = valid(row, target)
        if not ok:
            rejected[reason] += 1
            continue

        level = row["cefr_level"]
        style = resolve_feedback_style(level, row.get("feedback_style") or "auto")
        system = build_system(level, row.get("target_topic", ""), style,
                              row.get("focus_tags"))
        user = "Learner utterance:\n" + row["student_text"]
        completion = json.dumps(target, ensure_ascii=False)

        if args.format == "sharegpt":
            record = {"conversations": [
                {"from": "system", "value": system},
                {"from": "human", "value": user},
                {"from": "gpt", "value": completion},
            ]}
        else:
            record = {"instruction": system, "input": user, "output": completion}

        record["_meta"] = {
            "level": level,
            "source": row.get("label_source", args.source),
            "exchange_id": row.get("exchange_id"),
        }
        kept.append(record)
        per_level[level] += 1
        for error in target["errors"]:
            per_tag[error["tag"]] += 1

    random.Random(args.seed).shuffle(kept)
    cut = int(len(kept) * args.split)
    train, evalset = kept[:cut], kept[cut:]

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    eval_path = out.with_name(out.stem + "_eval" + out.suffix)

    for path, records in ((out, train), (eval_path, evalset)):
        with path.open("w", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"\nWrote {len(train)} train -> {out}")
    print(f"Wrote {len(evalset)} eval  -> {eval_path}")

    if rejected:
        print("\nRejected:")
        for reason, count in rejected.most_common():
            print(f"  {count:5d}  {reason}")

    if args.stats or True:
        print("\nCEFR coverage:")
        for level in CEFR_LEVELS:
            count = per_level[level]
            bar = "#" * min(40, count // max(1, len(kept) // 200 or 1))
            flag = "  <-- thin" if count < 50 else ""
            print(f"  {level}  {count:5d} {bar}{flag}")

        print("\nTag coverage (11 required):")
        for tag in ERROR_TAGS:
            count = per_tag[tag]
            flag = "  <-- unseen" if count == 0 else ("  <-- thin" if count < 20 else "")
            print(f"  {tag:26s} {count:5d}{flag}")

        missing = [t for t in ERROR_TAGS if per_tag[t] == 0]
        if missing:
            print(f"\n{len(missing)} tag(s) have no examples. A model trained on this "
                  f"set cannot emit them at all.")
        if len(kept) < 1000:
            print(f"\n{len(kept)} examples. Structured extraction of this shape usually "
                  f"needs 1000-3000 before a small model is competitive. Consider "
                  f"collecting more sessions before spending GPU time.")
        if args.source != "reviewed":
            print("\nThis file contains model-generated targets. Training on it is "
                  "DISTILLATION: the result inherits the cloud assessor's misses and "
                  "cannot exceed them.")


if __name__ == "__main__":
    main()
