#!/usr/bin/env python3
"""
tools/check_tree.py
===================
Fail if a file appears in the tree that nobody declared.

The "ghost directory" is not mysterious: something with write access keeps
re-adding paths like eval/benchmark.py, and it is only ever noticed when a test
imports a file that is not there. A manifest turns that into a build failure at
the moment it happens.

    python tools/check_tree.py            # verify
    python tools/check_tree.py --update   # accept the current tree as the manifest

Wire it into CI and into .git/hooks/pre-commit:

    #!/bin/sh
    python tools/check_tree.py || exit 1
    python -m pytest core/tests/test_core.py -q || exit 1
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / ".tree-manifest.json"

IGNORE_DIRS = {".git", "__pycache__", ".pytest_cache", "data", "tts_out",
               ".eval_cache", ".venv", "venv", "node_modules", ".mypy_cache"}
IGNORE_SUFFIXES = {".pyc", ".pyo", ".jsonl", ".onnx", ".wav", ".mp3", ".log"}


def current_tree() -> list:
    files = []
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(part in IGNORE_DIRS for part in path.parts):
            continue
        if path.suffix in IGNORE_SUFFIXES or path.name.startswith("."):
            continue
        files.append(str(path.relative_to(ROOT)).replace("\\", "/"))
    return sorted(files)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--update", action="store_true")
    args = parser.parse_args()

    tree = current_tree()

    if args.update or not MANIFEST.exists():
        MANIFEST.write_text(json.dumps({"files": tree}, indent=2) + "\n")
        print(f"Manifest written: {len(tree)} files -> {MANIFEST.name}")
        return 0

    declared = set(json.loads(MANIFEST.read_text())["files"])
    actual = set(tree)

    ghosts = sorted(actual - declared)
    missing = sorted(declared - actual)

    if ghosts:
        print("UNDECLARED FILES (something is writing to this tree):")
        for path in ghosts:
            print(f"  + {path}")
    if missing:
        print("DECLARED BUT MISSING:")
        for path in missing:
            print(f"  - {path}")

    if ghosts or missing:
        print("\nIf the change is intentional: python tools/check_tree.py --update")
        print("If it is not: you have a second writer. Check for a running agent,")
        print("a stale Docker bind mount, or a branch being auto-merged.")
        return 1

    print(f"Tree matches the manifest ({len(tree)} files).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
