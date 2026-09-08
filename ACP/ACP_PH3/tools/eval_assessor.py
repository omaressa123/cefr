#!/usr/bin/env python3
"""
tools/eval_assessor.py
======================
Compare assessor backends on a labelled set.

WHAT CHANGED AND WHY (read this if you already ran the old version)
    The previous matcher was `gold in pred or pred in gold` on normalised
    strings. ERRANT's two largest categories are DET and PREP, whose gold spans
    are single function words -- "the", "a", "in", "to". Those are substrings
    of nearly any English clause, so they matched whatever the model happened
    to report. Every such pairing counted as a hit, which is how you get 100%
    precision from a model that is missing errors. That number measured the
    matcher, not the model.

    Matching is now token-aligned with three modes:

      offset  gold char offsets vs the span located in the transcript.
              Strictest and most correct. Used when the gold file carries
              `start`/`end`, which the M2 converter can emit.
      token   word-boundary overlap with a minimum-token floor. Single-word
              gold spans must be matched by a prediction whose span actually
              contains that word position, not merely the letters.
      loose   the old behaviour, kept only so you can reproduce the inflated
              numbers and see the size of the correction.

METRICS
    recall          share of gold errors found. THE number for this product.
                    A missed error is a lesson that never happens; a spurious
                    one is a learner shrugging at a bad note.
    precision       share of reported errors present in gold
    tag_accuracy    of matched errors, how often the category was right
    per-tag recall  which of the 11 categories the backend is blind to.
                    This is the actionable table -- it tells you what to fix.
    dropped         errors killed by the verbatim guardrail (fabricated spans)
    illegal_tags    tags outside the closed taxonomy
    over_cap        turns exceeding the level's reporting cap
    parse_fail      responses extract_json could not recover
    p50 / p95       latency in ms

DOMAIN WARNING
    BEA-2019 W&I+LOCNESS is WRITTEN learner English -- Cambridge Write &
    Improve essays. Your assessor prompt describes a verbatim speech
    transcript with fillers and false starts. Scoring a speech-tuned prompt on
    essay text is a valid grammar benchmark and a poor proxy for your product.
    Pass --domain written to acknowledge it; the report says so in the output
    so a number never travels without its caveat.

USAGE
    python tools/eval_assessor.py --gold data/gold.jsonl --backends cloud
    python tools/eval_assessor.py --gold data/gold.jsonl --match loose   # reproduce the old numbers
    python tools/eval_assessor.py --gold data/gold.jsonl --backends cloud local --repeat 3
    python tools/eval_assessor.py --gold data/gold.jsonl --limit 60 --by-tag
"""

import argparse
import asyncio
import hashlib
import json
import os
import random
import re
import statistics
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import assessors, engine  # noqa: E402
from core.config import (  # noqa: E402
    ASSESSOR_PROMPT,
    ERROR_SELECTION,
    ERROR_TAGS,
    FEEDBACK_STYLE_BLOCKS,
    build_focus_block,
    build_tag_probes,
    resolve_feedback_style,
    settings,
)

WORD = re.compile(r"[a-z0-9']+")


# ===========================================================================
# RATE LIMITING AND CACHING
# The free-tier "brick wall" is a pacing problem, not an architecture problem.
# 919 cases at 30 req/min is a 31-minute run. With an on-disk cache keyed on
# (backend, model, prompt hash), a re-run after a prompt tweak only re-calls
# what actually changed -- usually a few minutes. Both of these cost far less
# than porting the stack to local models.
# ===========================================================================

class RateLimiter:
    """Simple async token bucket. Groq free tier is ~30 RPM on most models;
    Gemini free tier is lower and has a daily cap as well."""

    def __init__(self, per_minute: int):
        self.interval = 60.0 / max(per_minute, 1)
        self._lock = asyncio.Lock()
        self._next = 0.0

    async def wait(self) -> None:
        async with self._lock:
            loop = asyncio.get_running_loop()
            now = loop.time()
            if now < self._next:
                await asyncio.sleep(self._next - now)
                now = loop.time()
            self._next = now + self.interval


class ResponseCache:
    """Keyed on the exact prompt, so a prompt edit invalidates only the cases
    it touched. Nothing here is clever; it is just the difference between
    iterating in minutes and iterating in half-hours."""

    def __init__(self, path: str):
        self.path = Path(path) if path else None
        self.data = {}
        self.hits = 0
        if self.path and self.path.exists():
            for line in self.path.read_text().splitlines():
                if line.strip():
                    row = json.loads(line)
                    self.data[row["key"]] = row["raw"]

    @staticmethod
    def key(backend: str, system: str, user: str) -> str:
        digest = hashlib.sha256(f"{backend}\x00{system}\x00{user}".encode()).hexdigest()
        return digest[:32]

    def get(self, key: str):
        value = self.data.get(key)
        if value is not None:
            self.hits += 1
        return value

    def put(self, key: str, raw: str) -> None:
        if self.path is None or key in self.data:
            return
        self.data[key] = raw
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"key": key, "raw": raw}) + "\n")


_limiter = None
_cache = None


# ===========================================================================
# MATCHING
# ===========================================================================

def tokens_with_spans(text: str) -> list:
    """[(token, start_char, end_char)] over the lowercased text."""
    return [(m.group(0), m.start(), m.end()) for m in WORD.finditer((text or "").lower())]


def locate(span: str, transcript: str) -> tuple:
    """Token index range of `span` inside `transcript`, or None.

    Matching on token indices rather than characters is what stops "the" in a
    gold DET error from matching the "the" in an unrelated clause: the index
    range has to actually overlap.
    """
    haystack = [t for t, _, _ in tokens_with_spans(transcript)]
    needle = [t for t, _, _ in tokens_with_spans(span)]
    if not needle or not haystack:
        return None
    for i in range(len(haystack) - len(needle) + 1):
        if haystack[i : i + len(needle)] == needle:
            return (i, i + len(needle))
    return None


def ranges_overlap(a: tuple, b: tuple) -> bool:
    return a is not None and b is not None and a[0] < b[1] and b[0] < a[1]


def match_offset(gold: dict, pred_range, transcript: str) -> bool:
    """Gold carries explicit character offsets (M2 converter can emit these)."""
    if "start" not in gold or "end" not in gold:
        return False
    spans = tokens_with_spans(transcript)
    gold_range = None
    for index, (_, start, end) in enumerate(spans):
        if end > gold["start"] and start < gold["end"]:
            gold_range = (index, index + 1) if gold_range is None else (gold_range[0], index + 1)
    return ranges_overlap(gold_range, pred_range)


def match_token(gold: dict, pred_range, transcript: str) -> bool:
    return ranges_overlap(locate(gold.get("student_said", ""), transcript), pred_range)


def match_loose(gold: dict, pred: dict, _transcript: str) -> bool:
    a = " ".join(WORD.findall((gold.get("student_said") or "").lower()))
    b = " ".join(WORD.findall((pred.get("student_said") or "").lower()))
    return bool(a and b) and (a in b or b in a)


# ===========================================================================
# SCORING ONE CASE
# ===========================================================================

def build_system(case: dict) -> str:
    level = case.get("level", "B1")
    style = resolve_feedback_style(level, case.get("feedback_style", "auto"))
    return ASSESSOR_PROMPT.format(
        level=level,
        topic=case.get("topic") or "everyday conversation",
        tag_probes=build_tag_probes(),
        focus_block=build_focus_block(case.get("focus_tags")),
        selection=ERROR_SELECTION.get(level, ERROR_SELECTION["B1"]),
        feedback_style=FEEDBACK_STYLE_BLOCKS[style],
    )


async def score_one(case: dict, backend: str, mode: str) -> dict:
    transcript = case["transcript"]
    level = case.get("level", "B1")

    system = build_system(case)
    user = "Learner utterance:\n" + transcript

    cache_key = ResponseCache.key(backend, system, user)
    cached = _cache.get(cache_key) if _cache else None

    if cached is not None:
        raw_text, latency_ms, cache_hit = cached, 0, True
    else:
        if _limiter:
            await _limiter.wait()
        started = time.perf_counter()
        try:
            response = await assessors.run_assessor(
                system=system, user=user, backend=backend
            )
        except assessors.AssessorUnavailable as exc:
            return {"error": str(exc)}
        latency_ms = int((time.perf_counter() - started) * 1000)
        raw_text, cache_hit = response.raw, False
        if _cache:
            _cache.put(cache_key, raw_text)

    class _R:
        raw = raw_text
    response = _R()

    from core import llm

    raw_payload = llm.extract_json(response.raw, require_keys=("errors",))
    parse_fail = not isinstance(raw_payload, dict)
    raw_errors = [e for e in ((raw_payload or {}).get("errors") or []) if isinstance(e, dict)]
    illegal = sum(
        1 for e in raw_errors
        if str(e.get("tag", "")).strip().lower() not in ERROR_TAGS
    )

    coerced = engine.coerce_assessment(response.raw, transcript, level)
    predicted = coerced["errors"]
    dropped = max(0, len(raw_errors) - len(predicted))

    # Precompute each prediction's token range once.
    pred_ranges = [locate(p.get("student_said", ""), transcript) for p in predicted]

    gold = case.get("errors") or []
    used = set()
    matched = 0
    tag_hits = 0
    per_tag_gold, per_tag_found = Counter(), Counter()

    for g in gold:
        gold_tag = g.get("tag", "")
        per_tag_gold[gold_tag] += 1
        for i, p in enumerate(predicted):
            if i in used:
                continue
            if mode == "loose":
                hit = match_loose(g, p, transcript)
            elif mode == "offset" and "start" in g:
                hit = match_offset(g, pred_ranges[i], transcript)
            else:
                hit = match_token(g, pred_ranges[i], transcript)
            if hit:
                matched += 1
                used.add(i)
                per_tag_found[gold_tag] += 1
                if gold_tag == p.get("tag"):
                    tag_hits += 1
                break

    return {
        "gold": len(gold),
        "predicted": len(predicted),
        "matched": matched,
        "tag_hits": tag_hits,
        "dropped": dropped,
        "illegal_tags": illegal,
        "over_cap": 1 if len(predicted) > engine._limit_for(level) else 0,
        "parse_fail": 1 if parse_fail else 0,
        "latency_ms": latency_ms,
        "cache_hit": 1 if cache_hit else 0,
        "per_tag_gold": per_tag_gold,
        "per_tag_found": per_tag_found,
        "level": level,
    }


# ===========================================================================
# AGGREGATION
# ===========================================================================

def bootstrap_ci(hits: int, total: int, iterations: int = 2000) -> tuple:
    """95% interval on a proportion. Without this, two backends five points
    apart on 40 errors look different and are not."""
    if total == 0:
        return (0.0, 0.0)
    sample = [1] * hits + [0] * (total - hits)
    rng = random.Random(11)
    draws = sorted(
        sum(rng.choice(sample) for _ in range(total)) / total for _ in range(iterations)
    )
    return (draws[int(0.025 * iterations)], draws[int(0.975 * iterations)])


async def run_backend(cases: list, backend: str, repeat: int, mode: str) -> dict:
    totals = Counter()
    per_tag_gold, per_tag_found = Counter(), Counter()
    per_level = defaultdict(lambda: [0, 0])
    latencies, failures = [], 0

    for _ in range(repeat):
        for index, case in enumerate(cases, 1):
            result = await score_one(case, backend, mode)
            if "error" in result:
                failures += 1
                continue
            totals["cases"] += 1
            for key in ("gold", "predicted", "matched", "tag_hits", "dropped",
                        "illegal_tags", "over_cap", "parse_fail"):
                totals[key] += result[key]
            per_tag_gold.update(result["per_tag_gold"])
            per_tag_found.update(result["per_tag_found"])
            per_level[result["level"]][0] += result["matched"]
            per_level[result["level"]][1] += result["gold"]
            if not result["cache_hit"]:
                latencies.append(result["latency_ms"])
            totals["cache_hits"] += result["cache_hit"]
            if index % 25 == 0:
                print(f"  {backend}: {index}/{len(cases)}", file=sys.stderr)

    recall = totals["matched"] / totals["gold"] if totals["gold"] else 0.0
    return {
        "backend": backend,
        "recall": recall,
        "recall_ci": bootstrap_ci(totals["matched"], totals["gold"]),
        "precision": totals["matched"] / totals["predicted"] if totals["predicted"] else 0.0,
        "tag_accuracy": totals["tag_hits"] / totals["matched"] if totals["matched"] else 0.0,
        "gold_errors": totals["gold"],
        "predicted": totals["predicted"],
        "dropped": totals["dropped"],
        "illegal_tags": totals["illegal_tags"],
        "over_cap": totals["over_cap"],
        "parse_fail": totals["parse_fail"],
        "failures": failures,
        "p50_ms": int(statistics.median(latencies)) if latencies else 0,
        "p95_ms": int(statistics.quantiles(latencies, n=20)[-1]) if len(latencies) > 3 else 0,
        "n": totals["cases"],
        "live_calls": len(latencies),
        "cache_hits": totals["cache_hits"],
        "per_tag_gold": per_tag_gold,
        "per_tag_found": per_tag_found,
        "per_level": dict(per_level),
    }


# ===========================================================================
# REPORT
# ===========================================================================

def report(results: list, mode: str, domain: str) -> None:
    header = (f"{'backend':10s} {'recall':>16s} {'prec':>7s} {'tag':>7s} {'gold':>6s} "
              f"{'pred':>6s} {'drop':>5s} {'bad':>4s} {'cap':>4s} {'p50':>6s} {'p95':>6s}")
    print("\n" + header)
    print("-" * len(header))
    for r in results:
        low, high = r["recall_ci"]
        recall = f"{r['recall']:.1%} [{low:.0%}-{high:.0%}]"
        print(f"{r['backend']:10s} {recall:>16s} {r['precision']:7.1%} {r['tag_accuracy']:7.1%} "
              f"{r['gold_errors']:6d} {r['predicted']:6d} {r['dropped']:5d} "
              f"{r['illegal_tags']:4d} {r['over_cap']:4d} {r['p50_ms']:6d} {r['p95_ms']:6d}")

    print(f"\nmatching={mode}   domain={domain}")
    if mode == "loose":
        print("  LOOSE MATCHING: single-word gold spans match any prediction containing "
              "those letters.\n  These numbers are inflated. Use --match token for a real "
              "figure.")
    if domain == "written":
        print("  WRITTEN corpus scored with a speech-tuned prompt. Good grammar benchmark, "
              "weak\n  product proxy: no disfluencies, longer sentences, and orthographic "
              "errors your\n  11-tag taxonomy cannot express.")

    for r in results:
        if r["gold_errors"] < 100:
            print(f"\n  {r['backend']}: only {r['gold_errors']} gold errors. The confidence "
                  f"interval above is the honest read; point estimates will move.")

    # The actionable table. Aggregate recall tells you there is a problem;
    # per-tag recall tells you which prompt section to go and fix.
    print("\nPer-tag recall (which categories the backend is blind to)")
    print(f"{'tag':28s}" + "".join(f"{r['backend']:>12s}" for r in results) + f"{'gold n':>9s}")
    print("-" * (28 + 12 * len(results) + 9))
    for tag in ERROR_TAGS:
        n = max(r["per_tag_gold"].get(tag, 0) for r in results)
        if n == 0:
            print(f"{tag:28s}" + "".join(f"{'--':>12s}" for _ in results) + f"{0:>9d}"
                  + "   <-- untested")
            continue
        cells = ""
        for r in results:
            g = r["per_tag_gold"].get(tag, 0)
            f = r["per_tag_found"].get(tag, 0)
            cells += f"{(f / g if g else 0):>11.0%} "
        print(f"{tag:28s}{cells}{n:>9d}")

    if len(results) > 1:
        best = max(results, key=lambda r: r["recall"])
        worst = min(results, key=lambda r: r["recall"])
        gap = best["recall"] - worst["recall"]
        overlap = worst["recall_ci"][1] >= best["recall_ci"][0]
        print(f"\nRecall gap {best['backend']} over {worst['backend']}: {gap:.1%}"
              + ("  (confidence intervals overlap -- not yet a real difference)"
                 if overlap else ""))
        if gap > 0.15 and not overlap:
            print("  A gap this size means the cheaper backend misses errors your learners "
                  "make.\n  That is a teaching regression, not a cost saving.")

    for r in results:
        if r["dropped"] > max(1, r["n"]) * 0.2:
            print(f"\n  {r['backend']}: {r['dropped']} quotes rejected by the verbatim "
                  f"guardrail.\n  It is fabricating spans, which reaches the learner as an "
                  f"EMPTY panel, not a wrong one.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gold", required=True)
    parser.add_argument("--backends", nargs="+", default=["cloud"])
    parser.add_argument("--match", choices=["offset", "token", "loose"], default="token")
    parser.add_argument("--domain", choices=["written", "spoken", "unknown"], default="unknown")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--limit", type=int, default=0, help="0 = all cases")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--json-out", default="")
    parser.add_argument("--rpm", type=int, default=25,
                        help="requests per minute; Groq free tier is ~30, Gemini lower")
    parser.add_argument("--cache", default=".eval_cache/responses.jsonl",
                        help="on-disk response cache; '' disables it")
    parser.add_argument("--no-cache", action="store_true")
    parser.add_argument("--stratify", action="store_true",
                        help="with --limit, sample evenly across CEFR levels")
    args = parser.parse_args()

    global _limiter, _cache
    _limiter = RateLimiter(args.rpm)
    _cache = None if (args.no_cache or not args.cache) else ResponseCache(args.cache)

    cases = [json.loads(line) for line in
             Path(args.gold).read_text().splitlines() if line.strip()]
    if args.limit:
        rng = random.Random(args.seed)
        if args.stratify:
            # A flat random slice of a B-heavy corpus tells you nothing about
            # A1 or C2, where the level caps and the guided/explicit switch
            # actually differ.
            by_level = {}
            for case in cases:
                by_level.setdefault(case.get("level", "?"), []).append(case)
            per = max(1, args.limit // max(len(by_level), 1))
            cases = []
            for level in sorted(by_level):
                bucket = by_level[level]
                rng.shuffle(bucket)
                cases.extend(bucket[:per])
            rng.shuffle(cases)
            print(f"Stratified slice: " +
                  ", ".join(f"{l}={sum(1 for c in cases if c.get('level')==l)}"
                            for l in sorted(by_level)))
        else:
            rng.shuffle(cases)
        cases = cases[: args.limit]

    gold_errors = sum(len(c.get("errors", [])) for c in cases)
    print(f"Loaded {len(cases)} cases, {gold_errors} labelled errors")
    if gold_errors < 100:
        print("Fewer than 100 gold errors: expect wide intervals and unstable point estimates.")

    # Fallback off: a backend that silently defers to cloud would report the
    # cloud model's numbers under its own name.
    object.__setattr__(settings, "assessor_fallback_to_cloud", False)

    est = len(cases) * args.repeat / max(args.rpm, 1)
    print(f"At {args.rpm} req/min this run takes about {est:.0f} min if nothing is cached.")

    results = [asyncio.run(run_backend(cases, b, args.repeat, args.match))
               for b in args.backends]
    report(results, args.match, args.domain)
    for r in results:
        if r["cache_hits"]:
            print(f"  {r['backend']}: {r['cache_hits']} cached, "
                  f"{r['live_calls']} live calls")

    if args.json_out:
        payload = [{k: (dict(v) if isinstance(v, Counter) else v)
                    for k, v in r.items()} for r in results]
        Path(args.json_out).write_text(json.dumps(payload, indent=2))
        print(f"\nWrote {args.json_out}")


if __name__ == "__main__":
    main()
