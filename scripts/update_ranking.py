#!/usr/bin/env python3
"""Fetch WTT senior singles rankings and update players.json.

Pulls Men's Singles and Women's Singles rankings from the WTT API
and writes the ``ranking`` field into ``players/players.json``.

Players not found in the top 200 will have their ``ranking`` field removed.

Usage:
  python scripts/update_ranking.py [--debug]
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

API_BASE = (
    "https://wttcmsapigateway-new.azure-api.net"
    "/internalttu/RankingsCurrentWeek/CurrentWeek/GetRankingIndividuals"
)


def _load_api_key() -> str:
    key = os.environ.get("WTT_API_KEY", "").strip()
    if key:
        return key

    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("WTT_API_KEY="):
                return line.split("=", 1)[1].strip()

    print("Error: WTT_API_KEY not set. Add it to .env or export it as an env var.")
    sys.exit(1)


API_KEY = _load_api_key()
HEADERS = {
    "ApiKey": API_KEY,
    "Ocp-Apim-Subscription-Key": API_KEY,
    "Origin": "https://www.worldtabletennis.com",
    "Referer": "https://www.worldtabletennis.com/",
}
TOP_N = 500


def fetch_rankings(sub_event: str) -> list[dict]:
    """Fetch individual rankings for a given SubEventCode (MS or WS)."""
    url = f"{API_BASE}?CategoryCode=SEN&SubEventCode={sub_event}&StartRank=1&EndRank={TOP_N}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    return data.get("Result", [])


def build_ranking_map(results: list[dict]) -> dict[str, int]:
    """Build a case-insensitive name -> ranking map from API results."""
    mapping: dict[str, int] = {}
    for entry in results:
        name = entry.get("PlayerName", "").strip()
        rank = entry.get("RankingPosition") or entry.get("CurrentRank")
        if name and rank is not None:
            mapping[name.lower()] = int(rank)
    return mapping


def match_ranking(player_name: str, ranking_map: dict[str, int]) -> int | None:
    """Try to match a player name against the ranking map."""
    key = player_name.strip().lower()
    if key in ranking_map:
        return ranking_map[key]

    # Try reversing "LAST First" <-> "First LAST" order
    parts = key.split()
    if len(parts) >= 2:
        reversed_key = " ".join(parts[1:]) + " " + parts[0]
        if reversed_key in ranking_map:
            return ranking_map[reversed_key]

    return None


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    players_path = repo_root / "players" / "players.json"

    if not players_path.exists():
        print(f"Error: '{players_path}' not found.")
        return 1

    with players_path.open("r", encoding="utf-8") as f:
        players: dict = json.load(f)

    debug = "--debug" in sys.argv[1:]

    print("Fetching Men's Singles rankings...")
    ms_results = fetch_rankings("MS")
    print(f"  Got {len(ms_results)} entries")

    print("Fetching Women's Singles rankings...")
    ws_results = fetch_rankings("WS")
    print(f"  Got {len(ws_results)} entries")

    ms_map = build_ranking_map(ms_results)
    ws_map = build_ranking_map(ws_results)

    if debug:
        print("\n--- Men's Singles rankings ---")
        for name, rank in sorted(ms_map.items(), key=lambda kv: kv[1]):
            print(f"  #{rank:<4} {name}")
        print("\n--- Women's Singles rankings ---")
        for name, rank in sorted(ws_map.items(), key=lambda kv: kv[1]):
            print(f"  #{rank:<4} {name}")
        print()

    updated = 0
    removed = 0

    for name, info in players.items():
        rank = match_ranking(name, ms_map) or match_ranking(name, ws_map)
        if rank is not None:
            info["ranking"] = rank
            updated += 1
            print(f"  #{rank:<4} {name}")
        elif "ranking" in info:
            del info["ranking"]
            removed += 1
            print(f"  --   {name} (removed, not in top {TOP_N})")

    with players_path.open("w", encoding="utf-8") as f:
        json.dump(players, f, indent=2, ensure_ascii=False)
        f.write("\n")

    total = len(players)
    no_rank = total - updated
    print(f"\nDone: {updated} ranked, {no_rank} unranked ({removed} removed), {total} total")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
