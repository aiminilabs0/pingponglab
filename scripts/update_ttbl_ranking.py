#!/usr/bin/env python3
"""Extract the TTBL (Tischtennis Bundesliga) singles player ranking.

Scrapes https://www.ttbl.de/en/bundesliga/ranking/all/single/<season> and
emits the ranking as JSON (default) or CSV. By default it also writes the
``ttbl_ranking`` field into ``players/players.json`` (use ``--no-update`` to
skip), matching the update behaviour of ``update_ranking.py``.

Usage:
  python scripts/extract_ttbl_ranking.py
  python scripts/extract_ttbl_ranking.py --season 2025-2026
  python scripts/extract_ttbl_ranking.py --format csv
  python scripts/extract_ttbl_ranking.py --output ttbl_ranking.json
  python scripts/extract_ttbl_ranking.py --no-update
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import urllib.request
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from pathlib import Path

DEFAULT_SEASON = "2025-2026"
BASE_URL = "https://www.ttbl.de/en/bundesliga/ranking/all/single"
PLAYER_HREF_RE = re.compile(r"/bundesliga/players/([0-9a-f-]{36})", re.IGNORECASE)
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0 Safari/537.36"
)


@dataclass
class RankingRow:
    rank: int
    name: str
    team: str
    wins: int
    losses: int
    plus_minus: int
    player_id: str
    profile_url: str


class RankingParser(HTMLParser):
    """Parse TTBL ranking rows rendered as <a href="...players/<uuid>">...</a>.

    The anchor wraps several inline elements (rank / name / team / balance / +/-).
    We collect text chunks per anchor and split them after the fact.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._depth = 0
        self._href: str | None = None
        self._chunks: list[str] = []
        self.rows: list[tuple[str, list[str]]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            href = dict(attrs).get("href") or ""
            if PLAYER_HREF_RE.search(href):
                self._href = href
                self._chunks = []
                self._depth = 1
                return
        if self._depth:
            self._depth += 1

    def handle_endtag(self, tag: str) -> None:
        if not self._depth:
            return
        self._depth -= 1
        if self._depth == 0 and self._href is not None:
            self.rows.append((self._href, self._chunks))
            self._href = None
            self._chunks = []

    def handle_data(self, data: str) -> None:
        if not self._depth:
            return
        text = data.strip()
        if text:
            self._chunks.append(text)


def fetch_html(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
    return raw.decode("utf-8", errors="replace")


def _join_chunks(chunks: list[str]) -> str:
    """Concatenate chunks, preserving spaces that separate human-readable tokens."""
    return " ".join(chunks)


# Matches the tail of a joined row: "25 : 7 18"  /  "0 : 15 -15"
# Groups: wins, losses, plus_minus
_TAIL_RE = re.compile(r"(\d+)\s*:\s*(\d+)\s+(-?\d+)\s*$")


def _parse_row(chunks: list[str]) -> tuple[int, str, str, int, int, int] | None:
    """Turn the anchor's text chunks into structured fields.

    The row reads: <rank> <name> <team> <wins> : <losses> <plus_minus>.
    Rank is always the first all-digit chunk; the tail is extracted via regex.
    The remainder between them is split as "name team" – we split off the
    leading tokens as the name until we hit what looks like the team.
    """
    text = _join_chunks(chunks)
    if not text:
        return None

    tail = _TAIL_RE.search(text)
    if not tail:
        return None

    wins = int(tail.group(1))
    losses = int(tail.group(2))
    plus_minus = int(tail.group(3))
    head = text[: tail.start()].strip()

    # Head is "<rank> <name> <team>" with single-space separators.
    m = re.match(r"^(\d+)\s+(.*)$", head)
    if not m:
        return None
    rank = int(m.group(1))
    rest = m.group(2).strip()

    # Split name/team: name is either the first 2 tokens or, if a middle token
    # looks like a name particle (de, van, da, ...), up to 3 tokens. Since we
    # lost the original span boundaries, fall back to a curated list of known
    # team-name prefixes.
    name, team = _split_name_team(rest)
    # Some rows render as "<name> Post <team>" where "Post" is a stray token
    # (e.g. club sponsor label) that gets absorbed into the name. Strip it.
    if name.endswith(" Post"):
        name = name[: -len(" Post")].rstrip()
    return rank, name, team, wins, losses, plus_minus


_TEAM_PREFIXES = (
    "TTC ",
    "TTF ",
    "TSV ",
    "BV ",
    "SV ",
    "ASC ",
    "Borussia ",
    "Post SV ",
    "1. FC ",
)


def _split_name_team(text: str) -> tuple[str, str]:
    """Split a "<name> <team>" string by scanning for a known team prefix."""
    for prefix in _TEAM_PREFIXES:
        idx = text.find(prefix)
        if idx > 0:
            return text[:idx].strip(), text[idx:].strip()

    # Fallback: assume first two tokens are the player's name.
    tokens = text.split()
    if len(tokens) >= 3:
        return " ".join(tokens[:2]), " ".join(tokens[2:])
    return text, ""


def extract_rankings(html: str) -> list[RankingRow]:
    parser = RankingParser()
    parser.feed(html)

    rows: list[RankingRow] = []
    for href, chunks in parser.rows:
        parsed = _parse_row(chunks)
        if parsed is None:
            continue
        rank, name, team, wins, losses, plus_minus = parsed
        match = PLAYER_HREF_RE.search(href)
        player_id = match.group(1) if match else ""
        profile_url = href if href.startswith("http") else f"https://www.ttbl.de{href}"
        rows.append(
            RankingRow(
                rank=rank,
                name=name,
                team=team,
                wins=wins,
                losses=losses,
                plus_minus=plus_minus,
                player_id=player_id,
                profile_url=profile_url,
            )
        )

    rows.sort(key=lambda r: r.rank)
    return rows


def to_json(rows: list[RankingRow]) -> str:
    return json.dumps([asdict(r) for r in rows], indent=2, ensure_ascii=False)


def to_csv(rows: list[RankingRow]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        ["rank", "name", "team", "wins", "losses", "plus_minus", "player_id", "profile_url"]
    )
    for r in rows:
        writer.writerow(
            [r.rank, r.name, r.team, r.wins, r.losses, r.plus_minus, r.player_id, r.profile_url]
        )
    return buf.getvalue()


def build_ranking_map(rows: list[RankingRow]) -> dict[str, int]:
    """Build a case-insensitive name -> ranking map from extracted rows."""
    mapping: dict[str, int] = {}
    for row in rows:
        name = row.name.strip()
        if name:
            mapping[name.lower()] = row.rank
    return mapping


def match_ranking(player_name: str, ranking_map: dict[str, int]) -> int | None:
    """Try to match a player name against the ranking map."""
    key = player_name.strip().lower()
    if key in ranking_map:
        return ranking_map[key]

    parts = key.split()
    if len(parts) >= 2:
        reversed_key = " ".join(parts[1:]) + " " + parts[0]
        if reversed_key in ranking_map:
            return ranking_map[reversed_key]

    return None


def update_players_json(rows: list[RankingRow], players_path: Path) -> int:
    """Write ``ttbl_ranking`` onto matching entries in ``players.json``.

    Players not present in ``rows`` have their ``ttbl_ranking`` removed.
    Returns 0 on success, non-zero on error.
    """
    if not players_path.exists():
        print(f"Error: '{players_path}' not found.", file=sys.stderr)
        return 1

    with players_path.open("r", encoding="utf-8") as f:
        players: dict = json.load(f)

    ranking_map = build_ranking_map(rows)

    updated = 0
    removed = 0
    for name, info in players.items():
        rank = match_ranking(name, ranking_map)
        full_name = info.get("full_name") if isinstance(info, dict) else None
        if rank is None and isinstance(full_name, str) and full_name:
            rank = match_ranking(full_name, ranking_map)
        if rank is not None:
            info["ttbl_ranking"] = rank
            updated += 1
            print(f"  #{rank:<4} {name}")
        elif isinstance(info, dict) and "ttbl_ranking" in info:
            del info["ttbl_ranking"]
            removed += 1
            print(f"  --   {name} (removed, not in TTBL ranking)")

    with players_path.open("w", encoding="utf-8") as f:
        json.dump(players, f, indent=2, ensure_ascii=False)
        f.write("\n")

    total = len(players)
    no_rank = total - updated
    print(
        f"\nDone: {updated} ranked, {no_rank} unranked ({removed} removed), "
        f"{total} total"
    )
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Extract TTBL singles ranking")
    p.add_argument("--season", default=DEFAULT_SEASON, help="Season (e.g. 2025-2026)")
    p.add_argument(
        "--format",
        choices=("json", "csv"),
        default="json",
        help="Output format (default: json)",
    )
    p.add_argument("--output", "-o", help="Write to file instead of stdout")
    p.add_argument("--url", help="Override URL (for local HTML testing)")
    p.add_argument(
        "--from-file",
        help="Read HTML from a local file instead of fetching (for testing)",
    )
    p.add_argument(
        "--no-update",
        action="store_true",
        help="Do not update players/players.json with ttbl_ranking",
    )
    p.add_argument(
        "--players-json",
        help="Path to players.json (default: ../players/players.json)",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    if args.from_file:
        with open(args.from_file, "r", encoding="utf-8") as f:
            html = f.read()
    else:
        url = args.url or f"{BASE_URL}/{args.season}"
        print(f"Fetching {url}", file=sys.stderr)
        html = fetch_html(url)

    rows = extract_rankings(html)
    if not rows:
        print("No ranking rows were found.", file=sys.stderr)
        return 1

    payload = to_csv(rows) if args.format == "csv" else to_json(rows)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(payload)
            if not payload.endswith("\n"):
                f.write("\n")
        print(f"Wrote {len(rows)} rows to {args.output}", file=sys.stderr)
    else:
        sys.stdout.write(payload)
        if not payload.endswith("\n"):
            sys.stdout.write("\n")

    if not args.no_update:
        if args.players_json:
            players_path = Path(args.players_json).expanduser().resolve()
        else:
            players_path = (
                Path(__file__).resolve().parent.parent / "players" / "players.json"
            )
        print(f"\nUpdating ttbl_ranking in {players_path}", file=sys.stderr)
        rc = update_players_json(rows, players_path)
        if rc != 0:
            return rc

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
