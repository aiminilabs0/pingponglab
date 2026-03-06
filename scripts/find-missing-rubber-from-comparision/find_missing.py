#!/usr/bin/env python3
"""Find missing comparison files for a base rubber.

Expected rubbers are loaded from ``all_rubbers.txt``.

Usage:
  python scripts/find-missing-rubber-from-comparision/find_missing.py "Dignics 05"

If no argument is provided, this script falls back to reading
``scripts/update-comparison/0_rubber``.
"""

from __future__ import annotations

from collections import defaultdict
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


def _collect_related_files(comparison_root: Path, base_rubber: str) -> dict[str, list[Path]]:
    related_files: dict[str, list[Path]] = defaultdict(list)
    if not comparison_root.exists():
        return {}

    for path in comparison_root.rglob("*"):
        if not path.is_file():
            continue

        parts = path.relative_to(comparison_root).parts
        if len(parts) < 2:
            continue

        # The last two segments represent "<source rubber>/<target rubber>"
        # across both layouts:
        # - rubbers_comparison/<lang>/<source>/<target>
        # - rubbers_comparison/<source>/<target>
        source_rubber = parts[-2].strip()
        target_rubber = parts[-1].strip()

        if source_rubber == base_rubber:
            related_files[target_rubber].append(path.relative_to(comparison_root))
        elif target_rubber == base_rubber:
            related_files[source_rubber].append(path.relative_to(comparison_root))

    return dict(related_files)


def _has_both_directions(paths: list[Path], base_rubber: str) -> bool:
    has_base_to_other = False
    has_other_to_base = False

    for path in paths:
        parts = path.parts
        source_rubber = parts[-2].strip()
        target_rubber = parts[-1].strip()

        if source_rubber == base_rubber:
            has_base_to_other = True
        elif target_rubber == base_rubber:
            has_other_to_base = True

    return has_base_to_other and has_other_to_base


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

    comparison_root = repo_root / "rubbers_comparison"
    if not comparison_root.exists():
        print(f"Error: '{comparison_root}' not found.")
        return 1

    with all_rubbers_file.open("r", encoding="utf-8") as f:
        all_rubbers_list: list[str] = json.load(f)

    all_rubbers = sorted(r for r in all_rubbers_list if r != base_rubber)
    related_files = _collect_related_files(comparison_root, base_rubber)
    existing_targets = set(related_files)
    existing_expected = [rubber for rubber in all_rubbers if rubber in existing_targets]
    missing = [rubber for rubber in all_rubbers if rubber not in existing_targets]
    duplicated = sorted(
        rubber
        for rubber, paths in related_files.items()
        if _has_both_directions(paths, base_rubber)
    )

    print(f"Base rubber: {base_rubber}")
    print(f"Total expected comparisons: {len(all_rubbers)}")
    print(f"Existing comparisons: {len(existing_expected)}")
    print(f"Missing comparisons: {len(missing)}")
    print(f"Duplicated comparisons: {len(duplicated)}")

    if missing:
        print("\nMissing rubber files:")
        for rubber in missing:
            print(rubber)

    if duplicated:
        print("\nDuplicated comparisons (both directions found):")
        for rubber in duplicated:
            print(rubber)
            for path in sorted(related_files[rubber]):
                print(f"  - {path.as_posix()}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())