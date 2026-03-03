#!/usr/bin/env python3
"""Find missing comparison files for a base rubber.

Usage:
  python scripts/update-comparison/find_missing.py "Dignics 05"

If no argument is provided, this script falls back to reading
`scripts/update-comparison/0_rubber`.
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


def _extract_counterpart(filename: str, base_rubber: str) -> str:
    prefix = f"{base_rubber}_"
    suffix = f"_{base_rubber}"

    if filename.startswith(prefix):
        return filename[len(prefix) :].strip()

    if filename.endswith(suffix):
        return filename[: -len(suffix)].strip()

    return ""


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

    en_dir = repo_root / "rubbers_comparison" / "en"
    if not en_dir.exists():
        print(f"Error: '{en_dir}' not found.")
        return 1

    try:
        all_rubbers = json.loads(all_rubbers_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"Error: invalid JSON in '{all_rubbers_file}': {exc}")
        return 1

    if not isinstance(all_rubbers, list):
        print(f"Error: '{all_rubbers_file}' must contain a JSON list.")
        return 1

    all_rubbers = [
        str(name).strip()
        for name in all_rubbers
        if str(name).strip() and str(name).strip() != base_rubber
    ]
    existing_targets = set()
    for path in en_dir.iterdir():
        if not path.is_file():
            continue
        counterpart = _extract_counterpart(path.name, base_rubber)
        if counterpart:
            existing_targets.add(counterpart)

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