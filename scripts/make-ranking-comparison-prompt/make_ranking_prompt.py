#!/usr/bin/env python3

import json
import platform
import secrets
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]

METRIC_CONFIG = {
    "spin": {
        "prompt": PROJECT_ROOT / "prompts" / "rubber_spin_comparision.txt",
        "ranking": PROJECT_ROOT / "stats" / "rubbers" / "ranking" / "spin.json",
    },
    "speed": {
        "prompt": PROJECT_ROOT / "prompts" / "rubber_speed_comparision.txt",
        "ranking": PROJECT_ROOT / "stats" / "rubbers" / "ranking" / "speed.json",
    },
    "control": {
        "prompt": PROJECT_ROOT / "prompts" / "rubber_control_comparision.txt",
        "ranking": PROJECT_ROOT / "stats" / "rubbers" / "ranking" / "control.json",
    },
}


def usage() -> str:
    return (
        "Usage: python scripts/gen-ranking-comparison-prompt/gen-ranking-prompt.py "
        "<spin|speed|control> <number1> <number2>\n"
        "Example: python scripts/gen-ranking-comparison-prompt/gen-ranking-prompt.py spin 1 10\n"
        "Numbers are 1-based positions in the corresponding ranking JSON file."
    )


def parse_args(argv: list[str]) -> tuple[str, int, int]:
    if len(argv) != 4:
        raise ValueError(usage())

    metric = argv[1].lower()
    if metric not in METRIC_CONFIG:
        raise ValueError(
            f"Invalid metric: '{argv[1]}'. Expected one of: spin, speed, control."
        )

    try:
        number1 = int(argv[2])
        number2 = int(argv[3])
    except ValueError as exc:
        raise ValueError("number1 and number2 must be integers.") from exc

    if number1 < 1 or number2 < 1:
        raise ValueError("number1 and number2 must be >= 1 (1-based positions).")

    return metric, number1, number2


def load_rubbers(metric: str) -> list[dict[str, str]]:
    ranking_path = METRIC_CONFIG[metric]["ranking"]
    with ranking_path.open("r", encoding="utf-8") as file:
        data = json.load(file)
    if not isinstance(data, list):
        raise ValueError(f"Ranking file is not a list: {ranking_path}")
    return data


def rubber_label(rubber: dict[str, str]) -> str:
    brand = str(rubber.get("brand", "")).strip()
    name = str(rubber.get("name", "")).strip()
    label = f"{brand} {name}".strip()
    if not label:
        raise ValueError("Rubber entry is missing both brand and name.")
    return label


def pick_rubber(rubbers: list[dict[str, str]], position: int) -> dict[str, str]:
    idx = position - 1
    if idx >= len(rubbers):
        raise IndexError(
            f"Position {position} is out of range. Total rubbers: {len(rubbers)}"
        )
    return rubbers[idx]


def generate_prompt(metric: str, number1: int, number2: int) -> str:
    config = METRIC_CONFIG[metric]
    with config["prompt"].open("r", encoding="utf-8") as file:
        template = file.read()

    rubbers = load_rubbers(metric)
    rubber1 = rubber_label(pick_rubber(rubbers, number1))
    rubber2 = rubber_label(pick_rubber(rubbers, number2))

    body = template.replace("[Rubber 1]", rubber1).replace("[Rubber 2]", rubber2)
    cache_buster = secrets.randbelow(10**12)
    return f"{body.rstrip()}\n\ncache_buster: {cache_buster}\n"


def try_copy_to_clipboard(text: str) -> bool:
    if platform.system() != "Darwin":
        return False
    try:
        subprocess.run(["pbcopy"], input=text, text=True, check=True)
        return True
    except subprocess.CalledProcessError:
        return False


def main() -> int:
    try:
        metric, number1, number2 = parse_args(sys.argv)
        prompt = generate_prompt(metric, number1, number2)
        print(prompt)
        if not try_copy_to_clipboard(prompt):
            print(
                "Warning: could not copy to clipboard with pbcopy.",
                file=sys.stderr,
            )
        return 0
    except (
        ValueError,
        IndexError,
        OSError,
        json.JSONDecodeError,
    ) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        print(usage(), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
