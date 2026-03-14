#!/usr/bin/env python3

import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROMPT_TEMPLATE = PROJECT_ROOT / "prompts" / "rubber_comparison.txt"
ALL_RUBBERS_FILE = (
    PROJECT_ROOT
    / "scripts"
    / "find-missing-rubber-from-comparision"
    / "all_rubbers.txt"
)
OUTPUT_DIR = Path(__file__).resolve().parent / "gen-prompts"
EXCLUDE_FILE = Path(__file__).resolve().parent / "exclude.txt"
INCLUDE_FILE = Path(__file__).resolve().parent / "include.txt"

NAME_MAP = {
    "H3 Neo": "Hurricane 3 Neo",
    "Mercury 2": "YINHE Mercury 2",
    "G-1": "Nittaku G-1",
    "C-1": "Nittaku C-1",
    "S-1": "Nittaku S-1",
    "EL-P": "Evolution EL-P",
    "EL-S": "Evolution EL-S",
    "MX-P": "Evolution MX-P",
    "MX-P 50": "Evolution MX-P 50",
    "MX-S": "Evolution MX-S",
    "FX-P": "Evolution FX-P",
    "FX-S": "Evolution FX-S",
    "MX-D": "Evolution MX-D",
    "MK": "Hybrid MK",
    "K3": "Hybrid K3",
    "R42": "Rasanter R42",
    "R47": "Rasanter R47",
    "R50": "Rasanter R50",
    "R48": "Rasanter R48",
    "R53": "Rasanter R53",
    "C48": "Rasanter C48",
    "C53": "Rasanter C53",
    "J&H V47.5": "Jekyll & Hyde V47.5",
    "J&H X47.5": "Jekyll & Hyde X47.5",
    "J&H Z52.5": "Jekyll & Hyde Z52.5",
    "J&H C57.5": "Jekyll & Hyde C57.5",
    "J&H C52.5": "Jekyll & Hyde C52.5",
    "J&H C55.0": "Jekyll & Hyde C55.0",
    "Omega 7 Guang": "Omega 7 Guang China",
    "Zyre 03": "Zyre 03",
    "MX-K": "Tibhar MX-K",
    "Tenergy 05H": "Tenergy 05 Hard",
}


def expand_name(short: str) -> str:
    return NAME_MAP.get(short, short)


def load_all_rubbers() -> list[str]:
    with ALL_RUBBERS_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_excludes() -> set[str]:
    if not EXCLUDE_FILE.exists():
        return set()
    lines = EXCLUDE_FILE.read_text(encoding="utf-8").splitlines()
    return {line.strip() for line in lines if line.strip()}


def load_includes() -> list[str]:
    if not INCLUDE_FILE.exists():
        return []
    lines = INCLUDE_FILE.read_text(encoding="utf-8").splitlines()
    return [line.strip() for line in lines if line.strip()]


def generate_prompt(template: str, rubber1: str, rubber2: str) -> str:
    r1 = expand_name(rubber1)
    r2 = expand_name(rubber2)
    return (
        template.replace("[Rubber 1]", r1)
        .replace("[Rubber 2]", r2)
        .replace("{{RUBBER_1_NAME}}", r1)
        .replace("{{RUBBER_2_NAME}}", r2)
    )


def sanitize_filename(name: str) -> str:
    return name.replace("/", "_").replace("&", "and")


def main() -> int:
    if len(sys.argv) != 2:
        print(
            "Usage: python make_comparison_prompt.py <rubber_name>\n"
            "  rubber_name must match an entry in all_rubbers.txt",
            file=sys.stderr,
        )
        return 1

    rubber1 = sys.argv[1]
    all_rubbers = load_all_rubbers()

    if rubber1 not in all_rubbers:
        print(f"Error: '{rubber1}' not found in {ALL_RUBBERS_FILE.name}", file=sys.stderr)
        return 1

    template = PROMPT_TEMPLATE.read_text(encoding="utf-8")
    excludes = load_excludes()
    includes = load_includes()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    targets = includes if includes else all_rubbers

    count = 0
    for rubber2 in targets:
        if rubber2 == rubber1:
            continue
        if not includes and rubber2 in excludes:
            continue
        prompt = generate_prompt(template, rubber1, rubber2)
        filename = f"{sanitize_filename(rubber2)}.txt"
        (OUTPUT_DIR / filename).write_text(prompt, encoding="utf-8")
        count += 1

    print(f"Generated {count} prompts in {OUTPUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
