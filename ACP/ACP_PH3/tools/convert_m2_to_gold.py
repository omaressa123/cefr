#!/usr/bin/env python3
"""
tools/convert_m2_to_gold.py
===========================
Convert Cambridge/ERRANT .m2 annotation files into the closed 11-tag gold
format used by tools/eval_assessor.py.

TWO BUGS FIXED FROM THE PREVIOUS VERSION — REGENERATE YOUR GOLD FILE

1. TAG MAPPING WAS DEAD FOR EVERY MULTI-PART TYPE
   The old code did `err_type.split(":")[-1]` and looked that up in a TAG_MAP
   whose keys were "VERB:TENSE", "VERB:SVA", "NOUN:NUM". Splitting
   "R:VERB:TENSE" on ":" and taking the last element yields "TENSE", which is
   not a key, so it fell through to the default: word_choice_collocation.

   Every tense error, every subject-verb agreement error, every noun-number
   error in your 2,552-error benchmark is currently tagged
   word_choice_collocation. Your per-tag recall table has been reading a
   mislabelled file. Only DET, PREP, WO and PRON were ever mapped correctly.

   Now: strip the leading M/R/U operation prefix, then match the FULL remaining
   type, longest-prefix first.

2. INSERTION EDITS GOT A SPAN POINTING AT THE WRONG WORD
   An M:DET edit has start == end: the error is the ABSENCE of a word. The old
   `tokens[start:max(end, start+1)]` returned the token AFTER the insertion
   point — a word the learner produced correctly. That span is quotable, so
   audit_gold.py's zero-width detector never fired and the row survived into
   gold_clean.jsonl as a labelled error on the wrong token. It punished recall
   (the model can't find an error that isn't there) and corrupted precision
   (any prediction near that word scored as a hit).

   That is why the audit pruned 87 rows instead of the several hundred M:*
   edits BEA dev actually contains.

   Now: --insertions controls it explicitly.
     drop     omit them (default). Honest, and the only mode where recall is
              a clean measurement of the assessor.
     context  keep them with a two-token context window and mark
              `"insertion": true`, so a scorer can treat them separately.

ALSO NEW
  - Character offsets on every error, so eval_assessor.py --match offset works.
  - --drop-orthographic removes SPELL / ORTH / PUNCT, which a SPEECH assessor
    is correct to ignore and which otherwise punish recall for right behaviour.
  - Real CEFR levels parsed from the W&I filename or passed per file.
  - A mapping report so you can see what landed where before you benchmark.

USAGE
    python tools/convert_m2_to_gold.py B.dev.gold.bea19.m2 data/gold.jsonl --level B
    python tools/convert_m2_to_gold.py *.m2 data/gold.jsonl --insertions context
    python tools/convert_m2_to_gold.py A.dev.m2 data/gold.jsonl --keep-orthographic
"""

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.config import ERROR_TAGS  # noqa: E402

# Matched longest-first against the type with its M/R/U prefix removed.
# Keys are full ERRANT types, which is what the old version got wrong.
TAG_MAP = {
    "VERB:TENSE": "verb_tense",
    "VERB:FORM": "verb_tense",
    "VERB:INFL": "verb_tense",
    "VERB:SVA": "subject_verb_agreement",
    "VERB": "verb_tense",
    "DET": "article",
    "PREP": "preposition",
    "WO": "word_order",
    "NOUN:NUM": "plural_countability",
    "NOUN:INFL": "plural_countability",
    "NOUN:POSS": "pronoun_reference",
    "NOUN": "word_choice_collocation",
    "PRON": "pronoun_reference",
    "VERB:MODAL": "modal_conditional",
    "CONJ": "word_choice_collocation",
    "ADJ": "word_choice_collocation",
    "ADJ:FORM": "word_choice_collocation",
    "ADV": "word_choice_collocation",
    "MORPH": "word_choice_collocation",
    "PART": "preposition",
    "CONTR": "register_formality",
    "OTHER": "word_choice_collocation",
}

# No home in an 11-tag SPOKEN taxonomy. A speech assessor never sees spelling
# or punctuation, so leaving these in the gold set punishes recall for correct
# behaviour. Dropped by default; --keep-orthographic overrides.
ORTHOGRAPHIC = {"SPELL", "ORTH", "PUNCT", "CASE"}

OP_PREFIX = re.compile(r"^[MRU]:")
WI_LEVEL = re.compile(r"\b([ABC])(?:\.|_|-)", re.I)


def map_type(errant_type: str) -> tuple:
    """(tag, reason). tag is None when the type should be dropped."""
    stripped = OP_PREFIX.sub("", errant_type)
    if stripped in ORTHOGRAPHIC or stripped.split(":")[0] in ORTHOGRAPHIC:
        return None, "orthographic"
    # longest-prefix match: "VERB:TENSE" wins over "VERB"
    for key in sorted(TAG_MAP, key=len, reverse=True):
        if stripped == key or stripped.startswith(key + ":"):
            return TAG_MAP[key], key
    return "word_choice_collocation", "unmapped:" + stripped


def token_offsets(sentence: str) -> list:
    """Character (start, end) for each whitespace token, so we can emit exact
    offsets rather than making the scorer re-find the span."""
    offsets, cursor = [], 0
    for token in sentence.split():
        start = sentence.index(token, cursor)
        offsets.append((start, start + len(token)))
        cursor = start + len(token)
    return offsets


def infer_level(path: Path, default: str) -> str:
    match = WI_LEVEL.search(path.name)
    if not match:
        return default
    # W&I files are A/B/C; map to the mid CEFR level of each band. Stated
    # explicitly because it is a lossy assumption, not a fact in the corpus.
    return {"a": "A2", "b": "B1", "c": "C1"}[match.group(1).lower()]


def parse_m2(path: Path, level: str, insertions: str, keep_ortho: bool,
             stats: Counter, mapping: Counter) -> list:
    entries = []
    blocks = path.read_text(encoding="utf-8").strip().split("\n\n")

    for block in blocks:
        lines = block.strip().split("\n")
        if not lines or not lines[0].startswith("S "):
            continue

        sentence = lines[0][2:].strip()
        tokens = sentence.split()
        offsets = token_offsets(sentence)
        errors = []

        for line in lines[1:]:
            if not line.startswith("A "):
                continue
            parts = line[2:].split("|||")
            if len(parts) < 2:
                continue
            span = parts[0].split()
            try:
                start, end = int(span[0]), int(span[1])
            except (ValueError, IndexError):
                continue
            errant_type = parts[1].strip()
            correction = parts[2].strip() if len(parts) > 2 else ""

            if errant_type in ("noop", "UNK"):
                stats["noop"] += 1
                continue

            tag, reason = map_type(errant_type)
            mapping[f"{errant_type} -> {tag or 'DROPPED'}"] += 1
            if tag is None and not keep_ortho:
                stats["dropped_orthographic"] += 1
                continue
            if tag is None:
                tag = "word_choice_collocation"
            if tag not in ERROR_TAGS:
                stats["dropped_bad_tag"] += 1
                continue

            is_insertion = start == end
            if is_insertion:
                stats["insertions"] += 1
                if insertions == "drop":
                    continue
                # Two tokens of context around the gap. Marked so a scorer can
                # exclude them; NEVER silently presented as a normal span.
                lo = max(0, start - 1)
                hi = min(len(tokens), start + 1)
                if lo >= hi:
                    stats["dropped_insertion_no_context"] += 1
                    continue
                said = " ".join(tokens[lo:hi])
                char_start, char_end = offsets[lo][0], offsets[hi - 1][1]
            else:
                if start >= len(tokens) or end > len(tokens):
                    stats["dropped_out_of_range"] += 1
                    continue
                said = " ".join(tokens[start:end])
                char_start, char_end = offsets[start][0], offsets[end - 1][1]

            if not said.strip():
                stats["dropped_empty_span"] += 1
                continue

            error = {
                "student_said": said,
                "tag": tag,
                "start": char_start,
                "end": char_end,
                "errant_type": errant_type,
            }
            if correction:
                error["correction"] = correction
            if is_insertion:
                error["insertion"] = True
            errors.append(error)
            stats["kept"] += 1

        if errors:
            entries.append({
                "level": level,
                "topic": "everyday conversation",
                "transcript": sentence,
                "errors": errors,
                "source": path.name,
                "domain": "written",
            })

    return entries


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("inputs", nargs="+")
    parser.add_argument("output")
    parser.add_argument("--level", default="B1", help="fallback when the filename has no A/B/C")
    parser.add_argument("--insertions", choices=["drop", "context"], default="drop")
    parser.add_argument("--keep-orthographic", action="store_true")
    parser.add_argument("--report", action="store_true", help="print the full type mapping")
    args = parser.parse_args()

    stats, mapping = Counter(), Counter()
    rows = []
    for pattern in args.inputs:
        # An absolute path is used as-is; a relative pattern is globbed.
        candidate = Path(pattern)
        matches = ([candidate] if candidate.is_absolute() or candidate.exists()
                   else sorted(Path().glob(pattern)))
        for path in matches or [candidate]:
            if not path.exists():
                print(f"skip (missing): {path}")
                continue
            level = infer_level(path, args.level)
            found = parse_m2(path, level, args.insertions, args.keep_orthographic,
                             stats, mapping)
            rows.extend(found)
            print(f"{path.name}: {len(found)} cases at level {level}")

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    total = sum(len(r["errors"]) for r in rows)
    print(f"\nWrote {len(rows)} cases / {total} errors -> {out}")

    print("\nEdit disposition:")
    for key in ("kept", "insertions", "dropped_orthographic", "dropped_out_of_range",
                "dropped_empty_span", "dropped_bad_tag", "noop"):
        if stats[key]:
            print(f"  {key:28s} {stats[key]:6d}")
    if args.insertions == "drop" and stats["insertions"]:
        print(f"\n  {stats['insertions']} insertion edits dropped. These are errors of "
              f"ABSENCE\n  (M:DET, M:PREP) with no span to quote. Keeping them with a "
              f"neighbouring\n  token's span — the previous behaviour — labelled a "
              f"correctly-produced word\n  as an error.")

    tally = Counter()
    for row in rows:
        for error in row["errors"]:
            tally[error["tag"]] += 1
    print("\nTag distribution (11 closed tags):")
    for tag in ERROR_TAGS:
        n = tally[tag]
        flag = "  <-- untested" if n == 0 else ("  <-- thin" if n < 20 else "")
        print(f"  {tag:28s} {n:6d}{flag}")

    unmapped = {k: v for k, v in mapping.items() if "unmapped:" in k}
    if unmapped:
        print("\nERRANT types with no explicit mapping (fell back to word_choice_collocation):")
        for key, count in sorted(unmapped.items(), key=lambda kv: -kv[1])[:10]:
            print(f"  {key:44s} {count:5d}")

    if args.report:
        print("\nFull type mapping:")
        for key, count in mapping.most_common():
            print(f"  {key:48s} {count:5d}")


if __name__ == "__main__":
    main()
