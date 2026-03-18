#!/usr/bin/env python3
"""
Sync the `players` field in each rubber JSON file
from the authoritative forehand/backhand data in players.json.
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PLAYERS_FILE = PROJECT_ROOT / "players" / "players.json"
RUBBERS_DIR = PROJECT_ROOT / "rubbers"


def build_rubber_players_map(
    players: dict,
) -> dict[str, dict[str, list[str]]]:
    mapping: dict[str, dict[str, list[str]]] = defaultdict(
        lambda: {"forehand": [], "backhand": []}
    )
    for name, info in players.items():
        for side in ("forehand", "backhand"):
            rubber_path = info.get(side, "")
            if rubber_path:
                mapping[rubber_path][side].append(name)
    return mapping


def update_rubber_file(
    rubber_path: Path,
    players: dict[str, list[str]],
) -> bool:
    with rubber_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    new_players = {
        "forehand": sorted(players["forehand"]),
        "backhand": sorted(players["backhand"]),
    }

    if data.get("players") == new_players:
        return False

    data["players"] = new_players

    ordered = {}
    key_order = [
        "abbr",
        "name",
        "abbr_i18n",
        "name_i18n",
        "manufacturer",
        "players",
        "manufacturer_details",
        "urls",
    ]
    for key in key_order:
        if key in data:
            ordered[key] = data.pop(key)
    ordered.update(data)

    with rubber_path.open("w", encoding="utf-8") as f:
        json.dump(ordered, f, indent=2, ensure_ascii=False)
        f.write("\n")

    return True


def main() -> int:
    players = json.loads(PLAYERS_FILE.read_text(encoding="utf-8"))
    rubber_map = build_rubber_players_map(players)

    updated = 0
    missing = []

    for rubber_key, side_players in sorted(rubber_map.items()):
        rubber_file = RUBBERS_DIR / f"{rubber_key}.json"
        if not rubber_file.exists():
            missing.append(rubber_key)
            continue
        if update_rubber_file(rubber_file, side_players):
            updated += 1
            print(f"  updated: {rubber_key}")

    if missing:
        print(f"\nMissing rubber files:", file=sys.stderr)
        for m in missing:
            print(f"  {m}", file=sys.stderr)

    print(f"\nDone. Updated {updated} rubber file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
