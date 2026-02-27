#!/usr/bin/env python3
"""Sync player forehand/backhand mappings with rubber JSON files."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[2]
RUBBERS_DIR = ROOT_DIR / "rubbers"
PLAYERS_JSON = ROOT_DIR / "scripts" / "update_players" / "players.json"
SIDES = ("forehand", "backhand")
PLAYER_ENTRY_RE = re.compile(r"^(.*?)\s*\((https?://[^\s)]+)\)\s*$", re.IGNORECASE)


def iter_rubber_files() -> list[Path]:
    return sorted(RUBBERS_DIR.glob("*/*.json"))


def parse_player_entry(value: str) -> tuple[str, str]:
    trimmed = value.strip()
    if not trimmed:
        return "", ""
    match = PLAYER_ENTRY_RE.match(trimmed)
    if not match:
        return trimmed, ""
    return match.group(1).strip(), match.group(2).strip()


def format_player_entry(name: str, youtube_url: str) -> str:
    return f"{name} ({youtube_url})" if youtube_url else name


def collect_player_entries(value: Any) -> list[tuple[str, str]]:
    if isinstance(value, str):
        name, youtube_url = parse_player_entry(value)
        return [(name, youtube_url)] if name else []
    if isinstance(value, list):
        output: list[tuple[str, str]] = []
        for item in value:
            output.extend(collect_player_entries(item))
        return output
    return []


def normalize_rubber_refs(value: Any) -> list[str]:
    if isinstance(value, str):
        trimmed = value.strip()
        return [trimmed] if trimmed else []
    if isinstance(value, list):
        output: list[str] = []
        for item in value:
            output.extend(normalize_rubber_refs(item))
        return output
    return []


def first_string(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        for item in value:
            if isinstance(item, str) and item.strip():
                return item.strip()
    return ""


def normalize_youtube_urls(value: Any, limit: int = 1) -> list[str]:
    urls: list[str] = []
    if isinstance(value, str):
        cleaned = value.strip()
        if cleaned:
            urls.append(cleaned)
    elif isinstance(value, list):
        for item in value:
            if not isinstance(item, str):
                continue
            cleaned = item.strip()
            if cleaned:
                urls.append(cleaned)

    unique_urls: list[str] = []
    for url in urls:
        if url not in unique_urls:
            unique_urls.append(url)

    return unique_urls[:limit]


def rubber_ref_and_path(file_path: Path) -> tuple[str, Path]:
    data = json.loads(file_path.read_text(encoding="utf-8"))
    manufacturer = str(data.get("manufacturer", file_path.parent.name)).strip() or file_path.parent.name
    abbr = str(data.get("abbr", file_path.stem)).strip() or file_path.stem
    return f"{manufacturer}/{abbr}", file_path


def build_rubber_index() -> dict[str, Path]:
    index: dict[str, Path] = {}
    for file_path in iter_rubber_files():
        ref, path = rubber_ref_and_path(file_path)
        if ref in index:
            raise ValueError(f"Duplicate rubber reference found: {ref}")
        index[ref] = path
    return index


def export_players() -> int:
    players: dict[str, dict[str, Any]] = {}

    for file_path in iter_rubber_files():
        data = json.loads(file_path.read_text(encoding="utf-8"))
        players_obj = data.get("players")
        if not isinstance(players_obj, dict):
            continue

        manufacturer = str(data.get("manufacturer", file_path.parent.name)).strip() or file_path.parent.name
        abbr = str(data.get("abbr", file_path.stem)).strip() or file_path.stem
        rubber_ref = f"{manufacturer}/{abbr}"

        for side in SIDES:
            for player_name, youtube_url in collect_player_entries(players_obj.get(side, [])):
                entry = players.setdefault(
                    player_name,
                    {
                        "forehand": "",
                        "backhand": "",
                        "forehand_youtube": "",
                        "backhand_youtube": "",
                    },
                )
                if not entry[side]:
                    entry[side] = rubber_ref
                side_key = f"{side}_youtube"
                if not entry[side_key] and youtube_url:
                    entry[side_key] = youtube_url

    output: dict[str, dict[str, str]] = {}
    for player_name in sorted(players):
        output[player_name] = {
            "forehand": players[player_name]["forehand"],
            "backhand": players[player_name]["backhand"],
            "forehand_youtube": players[player_name]["forehand_youtube"],
            "backhand_youtube": players[player_name]["backhand_youtube"],
        }

    PLAYERS_JSON.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return len(output)


def apply_players() -> tuple[int, int]:
    if not PLAYERS_JSON.exists():
        raise FileNotFoundError(f"Missing input file: {PLAYERS_JSON}")

    data = json.loads(PLAYERS_JSON.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("players.json must be an object of player mappings.")

    rubber_index = build_rubber_index()
    assignments: dict[str, dict[str, set[tuple[str, str]]]] = {
        ref: {"forehand": set(), "backhand": set()} for ref in rubber_index
    }

    unknown_refs: set[str] = set()
    for player_name, sides_obj in data.items():
        if not isinstance(player_name, str):
            continue
        if not isinstance(sides_obj, dict):
            continue
        clean_name = player_name.strip()
        if not clean_name:
            continue

        for side in SIDES:
            side_youtube = first_string(sides_obj.get(f"{side}_youtube"))
            if not side_youtube:
                side_youtube = first_string(sides_obj.get("youtube"))

            rubber_ref = first_string(sides_obj.get(side))
            if not rubber_ref:
                continue
            if rubber_ref not in rubber_index:
                unknown_refs.add(rubber_ref)
                continue
            assignments[rubber_ref][side].add((clean_name, side_youtube))

    if unknown_refs:
        missing = ", ".join(sorted(unknown_refs))
        raise ValueError(f"Unknown rubber references in players.json: {missing}")

    changed_files = 0
    touched_player_entries = 0
    for rubber_ref, file_path in sorted(rubber_index.items()):
        rubber_data = json.loads(file_path.read_text(encoding="utf-8"))
        players_obj = rubber_data.get("players")
        if not isinstance(players_obj, dict):
            continue

        new_forehand = [
            format_player_entry(name, youtube_url)
            for name, youtube_url in sorted(assignments[rubber_ref]["forehand"], key=lambda x: x[0])
        ]
        new_backhand = [
            format_player_entry(name, youtube_url)
            for name, youtube_url in sorted(assignments[rubber_ref]["backhand"], key=lambda x: x[0])
        ]
        old_forehand = [
            format_player_entry(name, youtube_url)
            for name, youtube_url in collect_player_entries(players_obj.get("forehand", []))
        ]
        old_backhand = [
            format_player_entry(name, youtube_url)
            for name, youtube_url in collect_player_entries(players_obj.get("backhand", []))
        ]

        if old_forehand == new_forehand and old_backhand == new_backhand:
            continue

        players_obj["forehand"] = new_forehand
        players_obj["backhand"] = new_backhand
        touched_player_entries += len(new_forehand) + len(new_backhand)

        file_path.write_text(
            json.dumps(rubber_data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        changed_files += 1

    return changed_files, touched_player_entries


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Apply player mappings to rubber files, or export from rubber files."
    )
    parser.add_argument(
        "--export",
        action="store_true",
        help="Export from rubber files to scripts/players.json.",
    )
    args = parser.parse_args()

    if args.export:
        exported_players = export_players()
        print(f"Exported {exported_players} players to {PLAYERS_JSON}.")
        return

    changed_files, touched = apply_players()
    print(f"Applied player mappings to {changed_files} files ({touched} entries).")


if __name__ == "__main__":
    main()
