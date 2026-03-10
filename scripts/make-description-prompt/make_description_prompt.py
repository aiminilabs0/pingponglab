#!/usr/bin/env python3

import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROMPT_TEMPLATE = PROJECT_ROOT / "prompts" / "rubber_description.txt"
ALL_RUBBERS_FILE = (
    PROJECT_ROOT
    / "scripts"
    / "find-missing-rubber-from-comparision"
    / "all_rubbers.txt"
)
OUTPUT_DIR = Path(__file__).resolve().parent / "gen-prompts"
EXCLUDE_FILE = Path(__file__).resolve().parent / "exclude.txt"

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
    "Zyre 03": "Butterfly Zyre 03",
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


def generate_prompt(template: str, rubber: str) -> str:
    name = expand_name(rubber)
    return template.replace("[INSERT RUBBER NAME HERE]", name)


def sanitize_filename(name: str) -> str:
    return name.replace("/", "_").replace("&", "and")


def main() -> int:
    if len(sys.argv) < 2:
        print(
            "Usage: python make_description_prompt.py <rubber_name> [rubber_name ...]\n"
            "  rubber_name must match an entry in all_rubbers.txt\n"
            "  Use '--all' to generate for all rubbers",
            file=sys.stderr,
        )
        return 1

    all_rubbers = load_all_rubbers()
    excludes = load_excludes()
    template = PROMPT_TEMPLATE.read_text(encoding="utf-8")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if sys.argv[1] == "--all":
        targets = [r for r in all_rubbers if r not in excludes]
    else:
        targets = sys.argv[1:]
        for name in targets:
            if name not in all_rubbers:
                print(
                    f"Error: '{name}' not found in {ALL_RUBBERS_FILE.name}",
                    file=sys.stderr,
                )
                return 1

    count = 0
    for rubber in targets:
        if rubber in excludes:
            continue
        prompt = generate_prompt(template, rubber)
        filename = f"{sanitize_filename(rubber)}.txt"
        (OUTPUT_DIR / filename).write_text(prompt, encoding="utf-8")
        count += 1

    print(f"Generated {count} prompt(s) in {OUTPUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
