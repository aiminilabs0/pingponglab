#!/usr/bin/env python3
"""Fetch videos from a YouTube channel and update players.json.

Uses the YouTube Data API v3 to fetch the last N videos (default 100)
from the channel's uploads playlist, matches video titles to player
names, and appends new YouTube URLs to each player's ``youtubes`` list.

Requires a YOUTUBE_API_KEY in .env or as an environment variable.

Usage:
  python scripts/fetch-youtube/fetch_youtube.py          # last 100 videos
  python scripts/fetch-youtube/fetch_youtube.py --count 50
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

CHANNEL_ID = "UC9ckyA_A3MfXUa0ttxMoIZw"
# YouTube uploads playlist ID = channel ID with "UC" -> "UU"
UPLOADS_PLAYLIST_ID = "UU" + CHANNEL_ID[2:]

API_BASE = "https://www.googleapis.com/youtube/v3/playlistItems"

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PLAYERS_FILE = PROJECT_ROOT / "players" / "players.json"


def _load_api_key() -> str:
    key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if key:
        return key

    env_path = Path(__file__).resolve().parent / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("YOUTUBE_API_KEY="):
                return line.split("=", 1)[1].strip()

    print("Error: YOUTUBE_API_KEY not set. Add it to .env or export it.")
    sys.exit(1)


def fetch_videos(api_key: str, count: int) -> list[dict]:
    """Fetch the last `count` videos from the uploads playlist."""
    videos = []
    page_token = None

    while len(videos) < count:
        max_results = min(50, count - len(videos))
        params = {
            "part": "snippet",
            "playlistId": UPLOADS_PLAYLIST_ID,
            "maxResults": max_results,
            "key": api_key,
        }
        if page_token:
            params["pageToken"] = page_token

        url = f"{API_BASE}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())

        for item in data.get("items", []):
            snippet = item.get("snippet", {})
            video_id = snippet.get("resourceId", {}).get("videoId")
            title = snippet.get("title", "")
            if video_id and title:
                videos.append({
                    "video_id": video_id,
                    "title": title,
                    "url": f"https://www.youtube.com/watch?v={video_id}",
                })

        page_token = data.get("nextPageToken")
        if not page_token:
            break

    return videos


def build_name_variants(player_name: str) -> list[str]:
    """Build lowercased name variants to search for in video titles.

    Given "Tomokazu HARIMOTO", produces:
      - "tomokazu harimoto"
      - "harimoto tomokazu"
    For hyphenated names like "LIN Yun-ju":
      - "lin yun-ju"
      - "yun-ju lin"
    """
    parts = player_name.strip().split()
    if not parts:
        return []

    full = " ".join(parts).lower()
    variants = [full]

    if len(parts) >= 2:
        reversed_name = " ".join(parts[1:] + parts[:1]).lower()
        if reversed_name != full:
            variants.append(reversed_name)

    return variants


def name_matches_title(variants: list[str], title_lower: str) -> bool:
    """Check if any name variant appears as a whole word in the title."""
    for variant in variants:
        pattern = r"(?<![a-z])" + re.escape(variant) + r"(?![a-z])"
        if re.search(pattern, title_lower):
            return True
    return False


def main() -> int:
    count = 100
    if "--count" in sys.argv:
        idx = sys.argv.index("--count")
        if idx + 1 < len(sys.argv):
            count = int(sys.argv[idx + 1])

    if not PLAYERS_FILE.exists():
        print(f"Error: '{PLAYERS_FILE}' not found.")
        return 1

    api_key = _load_api_key()

    with PLAYERS_FILE.open("r", encoding="utf-8") as f:
        players: dict = json.load(f)

    print(f"Fetching last {count} videos from channel...")
    videos = fetch_videos(api_key, count)
    print(f"  Got {len(videos)} videos")

    # Pre-build search variants for each player
    player_variants: dict[str, list[str]] = {}
    for name, info in players.items():
        variants = build_name_variants(name)
        # Also add localized name variants (Chinese names in titles)
        for loc_name in info.get("localized_names", {}).values():
            if loc_name:
                variants.append(loc_name.lower())
        player_variants[name] = variants

    added = 0

    for video in videos:
        title_lower = video["title"].lower()
        url = video["url"]
        matched = []

        for name, variants in player_variants.items():
            if name_matches_title(variants, title_lower):
                existing = players[name].get("youtubes", [])
                # Check for duplicate by video ID
                if not any(video["video_id"] in u for u in existing):
                    existing.insert(0, url)
                    players[name]["youtubes"] = existing
                    added += 1
                    matched.append(name)

        if matched:
            print(f"  + {video['title']}")
            for m in matched:
                print(f"      -> {m}")

    with PLAYERS_FILE.open("w", encoding="utf-8") as f:
        json.dump(players, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"\nDone. Added {added} new video link(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
