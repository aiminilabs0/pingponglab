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

import sys
from pathlib import Path

# J&H rubber names use "JandH" in gen-prompt filenames
_FILENAME_TO_RUBBER = {
    "JandH": "J&H",
}


def _prompt_filename_to_rubber(stem: str) -> str:
    for token, replacement in _FILENAME_TO_RUBBER.items():
        stem = stem.replace(token, replacement)
    return stem


def _read_base_rubber(script_dir: Path) -> str:
    if len(sys.argv) > 1:
        return " ".join(sys.argv[1:]).strip()

    fallback_file = script_dir / "0_rubber"
    if not fallback_file.exists():
        return ""
    return fallback_file.read_text(encoding="utf-8").strip()


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent.parent

    base_rubber = _read_base_rubber(script_dir)
    if not base_rubber:
        print('Error: missing base rubber. Pass it as an argument, e.g. "Dignics 05".')
        return 1

    gen_prompts_dir = script_dir.parent / "make-comparision-prompt" / "gen-prompts"
    if not gen_prompts_dir.exists():
        print(f"Error: '{gen_prompts_dir}' not found.")
        return 1

    en_dir = repo_root / "rubbers_comparison" / "en" / base_rubber
    if not en_dir.exists():
        print(f"Error: '{en_dir}' not found.")
        return 1

    all_rubbers = sorted(
        _prompt_filename_to_rubber(p.stem)
        for p in gen_prompts_dir.glob("*.txt")
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