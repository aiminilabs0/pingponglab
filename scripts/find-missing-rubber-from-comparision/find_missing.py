#!/usr/bin/env python3
"""Find missing comparison files for a base rubber.

Expected rubbers are derived from the filenames in
``make-comparision-prompt/gen-prompts/``.

Usage:
  python scripts/find-missing-rubber-from-comparision/find_missing.py "Dignics 05"

If no argument is provided, this script falls back to reading
``scripts/update-comparison/0_rubber``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def _read_base_rubber(script_dir: Path) -> str:
    if len(sys.argv) > 1:
        return " ".join(sys.argv[1:]).strip()

    fallback_file = script_dir / "0_rubber"
    if not fallback_file.exists():
        return ""
    return fallback_file.read_text(encoding="utf-8").strip()


def _load_excludes(script_dir: Path) -> set[str]:
    exclude_file = script_dir.parent / "make-comparision-prompt" / "exclude.txt"
    if not exclude_file.exists():
        return set()
    lines = exclude_file.read_text(encoding="utf-8").splitlines()
    return {line.strip() for line in lines if line.strip()}


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent.parent

    base_rubber = _read_base_rubber(script_dir)
    if not base_rubber:
        print('Error: missing base rubber. Pass it as an argument, e.g. "Dignics 05".')
        return 1

    all_rubbers_file = script_dir / "all_rubbers.txt"
    if not all_rubbers_file.exists():
        print(f"Error: '{all_rubbers_file}' not found.")
        return 1

    en_dir = repo_root / "rubbers_comparison" / "en" / base_rubber
    if not en_dir.exists():
        print(f"Error: '{en_dir}' not found.")
        return 1

    with all_rubbers_file.open("r", encoding="utf-8") as f:
        all_rubbers_list: list[str] = json.load(f)

    excludes = _load_excludes(script_dir)
    all_rubbers = sorted(
        r for r in all_rubbers_list
        if r != base_rubber and r not in excludes
    )
    existing_targets = set()
    for path in en_dir.iterdir():
        if not path.is_file():
            continue
        existing_targets.add(path.name.strip())

    missing = [rubber for rubber in all_rubbers if rubber not in existing_targets]

    print(f"Base rubber: {base_rubber}")
    print(f"Total expected comparisons: {len(all_rubbers)}")
    print(f"Existing comparisons: {len(existing_targets)}")
    print(f"Missing comparisons: {len(missing)}")

    if missing:
        print("\nMissing rubber files:")
        for rubber in missing:
            print(rubber)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())