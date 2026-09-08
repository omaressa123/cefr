#!/usr/bin/env python3
"""
tools/audit_gold.py
===================
Check a gold file BEFORE you trust a number that came out of it.

The M2 conversion is where a benchmark quietly goes wrong, and none of the
failures announce themselves — they just produce a plausible percentage.

WHAT IT CHECKS

  1. Unquotable gold spans
     A gold `student_said` that is not present in its own transcript can never
     be matched by any backend. Every such row is a guaranteed recall miss that
     has nothing to do with the model. In M2 this happens with INSERTION edits,
     where the "error" is the *absence* of a word and the span is empty.

  2. Insertion edits
     M:DET, M:PREP and friends have a zero-width source span. The taxonomy
     expects a quotable span, and `_substring_match` will reject any prediction
     for them. Either exclude them or give them a surrounding-context span —
     but know how many there are, because in BEA they are a large minority.

  3. Ultra-short spans
     Single function words ("the", "a", "in") are matchable only with
     token-aligned scoring. Under substring matching they match nearly
     everything, which is how a benchmark returns 100% precision.

  4. Taxonomy coverage and drop rate
     ERRANT has ~55 types; you have 11 tags. Spelling, orthography and
     punctuation have no home. If the converter mapped them into
     word_choice_collocation as a catch-all, your gold set now contains errors
     a SPEECH assessor is correct to ignore, and recall is punished for the
     right behaviour.

  5. Domain markers
     Written-corpus signals: no fillers, long sentences, capitalised starts.
     Your prompt tells the model to expect a verbatim speech transcript.

  6. Level distribution
     A set that is 80% B-level tells you nothing about A1 or C2 behaviour.

USAGE
    python tools/audit_gold.py --gold data/gold.jsonl
    python tools/audit_gold.py --gold data/gold.jsonl --write-clean data/gold_clean.jsonl
"""

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.config import CEFR_LEVELS, ERROR_TAGS  # noqa: E402

WORD = re.compile(r"[a-z0-9']+")
FILLERS = {"umm", "uh", "erm", "er", "hmm", "like", "you know", "i mean"}


def tokens(text: str) -> list:
    return WORD.findall((text or "").lower())


def quotable(span: str, transcript: str) -> bool:
    needle, haystack = tokens(span), tokens(transcript)
    if not needle:
        return False
    return any(haystack[i : i + len(needle)] == needle
               for i in range(len(haystack) - len(needle) + 1))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gold", required=True)
    parser.add_argument("--write-clean", default="",
                        help="write a filtered file containing only scorable rows")
    args = parser.parse_args()

    cases = [json.loads(line) for line in
             Path(args.gold).read_text().splitlines() if line.strip()]

    total_errors = 0
    unquotable = []
    insertions = 0
    short_spans = Counter()
    tag_counts = Counter()
    level_counts = Counter()
    unknown_tags = Counter()
    filler_cases = 0
    sentence_lengths = []
    clean = []

    for case in cases:
        transcript = case.get("transcript", "")
        level_counts[case.get("level", "?")] += 1
        sentence_lengths.append(len(tokens(transcript)))
        if any(f in transcript.lower() for f in FILLERS):
            filler_cases += 1

        kept_errors = []
        for error in case.get("errors", []):
            total_errors += 1
            tag = error.get("tag", "")
            tag_counts[tag] += 1
            if tag not in ERROR_TAGS:
                unknown_tags[tag] += 1

            span = (error.get("student_said") or "").strip()
            if not span:
                insertions += 1
                continue
            if not quotable(span, transcript):
                unquotable.append((span, transcript[:60]))
                continue
            if len(tokens(span)) == 1:
                short_spans[tag] += 1
            kept_errors.append(error)

        if kept_errors:
            clean.append({**case, "errors": kept_errors})

    scorable = sum(len(c["errors"]) for c in clean)

    print(f"Gold file: {args.gold}")
    print(f"  cases                 {len(cases)}")
    print(f"  labelled errors       {total_errors}")
    print(f"  SCORABLE errors       {scorable}  ({scorable / max(total_errors,1):.0%})")

    print("\n1. Unmatchable gold  (guaranteed recall misses, not model failures)")
    print(f"   zero-width insertion edits   {insertions:5d}")
    print(f"   span absent from transcript  {len(unquotable):5d}")
    if insertions + len(unquotable):
        lost = (insertions + len(unquotable)) / max(total_errors, 1)
        print(f"   -> {lost:.0%} of your gold set can never be matched by any backend.")
        print(f"      Aggregate recall is capped at {1 - lost:.0%} before the model speaks.")
    for span, ctx in unquotable[:3]:
        print(f"      e.g. {span!r} not in {ctx!r}...")

    print("\n2. Single-word spans  (need --match token; --match loose inflates these)")
    for tag, count in short_spans.most_common(5):
        print(f"   {tag:28s} {count:5d}")
    if short_spans:
        print(f"   total {sum(short_spans.values())} "
              f"({sum(short_spans.values()) / max(scorable,1):.0%} of scorable)")

    print("\n3. Taxonomy")
    for tag in ERROR_TAGS:
        n = tag_counts.get(tag, 0)
        flag = "  <-- untested" if n == 0 else ("  <-- thin" if n < 20 else "")
        print(f"   {tag:28s} {n:5d}{flag}")
    if unknown_tags:
        print("   OUTSIDE the closed taxonomy:")
        for tag, count in unknown_tags.most_common():
            print(f"   {tag:28s} {count:5d}  <-- converter bug")

    print("\n4. Domain")
    mean_len = sum(sentence_lengths) / max(len(sentence_lengths), 1)
    print(f"   mean length            {mean_len:.1f} tokens")
    print(f"   cases with fillers     {filler_cases} ({filler_cases/max(len(cases),1):.0%})")
    if filler_cases / max(len(cases), 1) < 0.05:
        print("   -> Effectively no disfluencies. This is WRITTEN English. Your prompt")
        print("      tells the model to expect a verbatim speech transcript with fillers,")
        print("      so this measures grammar capability, not product behaviour.")
    if mean_len > 18:
        print(f"   -> Sentences average {mean_len:.0f} tokens; spoken turns run 8-15.")

    print("\n5. Level distribution")
    for level in CEFR_LEVELS + ["?"]:
        n = level_counts.get(level, 0)
        if n:
            flag = "  <-- thin" if n < 30 else ""
            print(f"   {level:4s} {n:5d}{flag}")
    missing = [l for l in CEFR_LEVELS if level_counts.get(l, 0) == 0]
    if missing:
        print(f"   no cases at: {', '.join(missing)} -- the level caps and the")
        print("   explicit/guided switch are untested at those levels.")

    if args.write_clean:
        out = Path(args.write_clean)
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w", encoding="utf-8") as handle:
            for case in clean:
                handle.write(json.dumps(case, ensure_ascii=False) + "\n")
        print(f"\nWrote {len(clean)} cases / {scorable} scorable errors -> {out}")
        print("Benchmark against this file. Recall against the unfiltered one is")
        print("measuring your converter, not your assessor.")


if __name__ == "__main__":
    main()
