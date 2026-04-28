#!/usr/bin/env python3
"""Update ``price.ko`` in rubber JSON files from a Naver products JSON file.

Takes the JSON output of ``scripts/fetch-naver-prices/fetch_naver_prices.py``
(a list of ``{name, price, salePrice, discountRatio}`` where ``price`` is the
regular/MSRP won amount and ``salePrice`` is the discounted price)
and updates the matching rubber files under ``rubbers/**``.

Matching
--------
For each Naver product we search for a rubber whose Korean abbreviation
(``abbr_i18n.ko``) appears as a substring of the Naver product name, after
stripping whitespace on both sides. Longer Korean abbreviations are tried
first so that e.g. ``테너지05FX`` wins over ``테너지05`` when both could
match. English ``abbr`` is used as a fallback.

Filtering
---------
Naver products whose name contains ``세트`` (bundle / set) are skipped by
default — those aren't single-rubber SKUs and would pollute prices.

Price format
------------
Rubber JSON stores Korean prices in thousands of won as strings
(e.g. ``"92.0"`` = 92,000원). Naver returns raw integer won. The script
converts and formats discount as ``"-NN%"``.

Usage
-----
  python scripts/update-price-ko/update_price_ko.py products.json
  python scripts/update-price-ko/update_price_ko.py products.json --dry-run
  python scripts/update-price-ko/update_price_ko.py products.json \
      --filter 세트 --filter 셋트 --filter 2개
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

_WS = re.compile(r"\s+")


def normalize(text: str) -> str:
    return _WS.sub("", text or "").lower()


# Disambiguation: when the Naver product name contains the listed tokens
# (matched against the normalized name), treat the rubber as a *different*
# variant and refuse to match. Each key is a normalized rubber abbreviation
# (Korean or English); the rubber's ``keys`` list is scanned so we match
# regardless of which language form hit.
#
# Add to this list whenever you discover a storefront listing that the
# matcher mis-classifies (e.g. "라잔터 R50" → should not match Rasanter R47).
DISAMBIGUATION: dict[str, list[str]] = {
    # 바라쿠타/바라쿠다 50 ≠ plain Baracuda. Include both Korean spellings
    # (DB uses "바라쿠다" but the storefront usually writes "바라쿠타").
    "바라쿠다": ["50"],
    "바라쿠타": ["50"],
    "baracuda": ["50"],
    # 테너지 FX (05 / 64 / 80) ≠ plain 테너지. The FX rubbers do exist in
    # the DB, so this mostly guards against matcher bugs.
    "테너지05": ["fx"],
    "테너지64": ["fx"],
    "테너지80": ["fx"],
    "tenergy05": ["fx"],
    "tenergy64": ["fx"],
    "tenergy80": ["fx"],
    # 라잔터 R47 퍼플 ≠ R47. The R47 rubber's Korean abbr is just "R47".
    "r47": ["퍼플", "purple"],
    # 제넥션 V2C ≠ 제넥션.
    "제넥션": ["v2c"],
    "genextion": ["v2c"],
    "genection": ["v2c"],
}


def _is_excluded_variant(rubber_keys: list[str], name_norm: str) -> bool:
    for k in rubber_keys:
        for tok in DISAMBIGUATION.get(k, ()):
            if normalize(tok) in name_norm:
                return True
    return False


def fmt_price(value) -> str:
    """Convert won integer to ``"##.#"`` (thousands) string."""
    if value is None or value == "":
        return ""
    if isinstance(value, str):
        value = float(value.replace(",", ""))
    if not value:
        return ""
    return f"{value / 1000:.1f}"


def to_price_entry(product: dict) -> dict:
    regular = product.get("price")
    sale = product.get("salePrice")
    ratio = product.get("discountRatio")

    if (
        isinstance(sale, (int, float))
        and isinstance(regular, (int, float))
        and sale > 0
        and regular > 0
        and sale < regular
    ):
        if not ratio:
            ratio = round((regular - sale) / regular * 100)
        return {
            "regular": fmt_price(regular),
            "sale": fmt_price(sale),
            "discount": f"-{int(ratio)}%",
        }

    primary = next(
        (
            v
            for v in (regular, sale)
            if isinstance(v, (int, float)) and v > 0
        ),
        None,
    )
    return {
        "regular": fmt_price(primary),
        "sale": "",
        "discount": "",
    }


def load_rubbers(rubbers_dir: Path) -> list[dict]:
    rubbers: list[dict] = []
    for jf in sorted(rubbers_dir.rglob("*.json")):
        try:
            data = json.loads(jf.read_text(encoding="utf-8"))
        except Exception as exc:
            print(f"  warn: could not read {jf}: {exc}", file=sys.stderr)
            continue

        ko = (data.get("abbr_i18n") or {}).get("ko") or (
            data.get("name_i18n") or {}
        ).get("ko")
        en = (
            (data.get("abbr_i18n") or {}).get("en")
            or data.get("abbr")
            or data.get("name")
            or ""
        )
        if not ko and not en:
            continue

        rubbers.append(
            {
                "path": jf,
                "data": data,
                "ko": ko or "",
                "en": en,
                "keys": [k for k in (normalize(ko), normalize(en)) if k],
            }
        )

    # Longest keys first so specific names win over generic substrings.
    rubbers.sort(key=lambda r: -max((len(k) for k in r["keys"]), default=0))
    return rubbers


def find_match(name_norm: str, rubbers: list[dict], taken: set[Path]):
    for r in rubbers:
        if r["path"] in taken:
            continue
        for k in r["keys"]:
            if k and k in name_norm:
                if _is_excluded_variant(r["keys"], name_norm):
                    break  # same rubber's other keys would also be excluded
                return r
    return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "products_json", help="JSON output from fetch_naver_prices.py"
    )
    parser.add_argument(
        "--rubbers-dir",
        default=None,
        help="rubbers directory (default: <repo>/rubbers)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print planned changes without writing files",
    )
    parser.add_argument(
        "--filter",
        action="append",
        default=None,
        metavar="SUBSTR",
        help=(
            "skip Naver products whose name contains this substring "
            "(repeatable; default: '세트')"
        ),
    )
    parser.add_argument(
        "--show-unmatched",
        action="store_true",
        help="print Naver products that didn't match any rubber",
    )
    args = parser.parse_args()

    filters = args.filter if args.filter else ["세트"]

    repo_root = Path(__file__).resolve().parent.parent.parent
    rubbers_dir = (
        Path(args.rubbers_dir) if args.rubbers_dir else repo_root / "rubbers"
    )
    if not rubbers_dir.is_dir():
        print(f"Error: {rubbers_dir} not found", file=sys.stderr)
        return 1

    products = json.loads(Path(args.products_json).read_text(encoding="utf-8"))
    if not isinstance(products, list):
        print("Error: products JSON must be a list", file=sys.stderr)
        return 1

    before = len(products)
    products = [
        p
        for p in products
        if not any(f in (p.get("name") or "") for f in filters)
    ]
    skipped = before - len(products)
    print(
        f"Filtered out {skipped} items matching {filters} "
        f"({len(products)} remain).",
        file=sys.stderr,
    )

    rubbers = load_rubbers(rubbers_dir)
    print(f"Loaded {len(rubbers)} rubber files from {rubbers_dir}", file=sys.stderr)

    taken: set[Path] = set()
    unmatched: list[str] = []
    updated = 0
    unchanged = 0

    for p in products:
        name = (p.get("name") or "").strip()
        if not name:
            continue
        m = find_match(normalize(name), rubbers, taken)
        if not m:
            unmatched.append(name)
            continue
        taken.add(m["path"])

        entry = to_price_entry(p)
        if not entry["regular"]:
            print(f"  no-price   : {m['ko'] or m['en']:<25}  [{name}]")
            continue

        data = m["data"]
        old_price = dict(data.get("price") or {})
        current_ko = dict(old_price.get("ko") or {})

        if current_ko == entry:
            unchanged += 1
            continue

        if current_ko:
            history = list(data.get("price_history") or [])
            history.append(
                {
                    "date": date.today().isoformat(),
                    "ko": current_ko,
                }
            )
            data["price_history"] = history

        old_price["ko"] = entry
        data["price"] = old_price

        label = (
            f"{entry['regular']} → {entry['sale']} ({entry['discount']})"
            if entry["sale"]
            else entry["regular"]
        )
        print(f"  updated    : {m['ko'] or m['en']:<25} -> {label}  [{name}]")

        if not args.dry_run:
            with m["path"].open("w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.write("\n")
        updated += 1

    if args.show_unmatched and unmatched:
        print(f"\nUnmatched ({len(unmatched)}):", file=sys.stderr)
        for n in unmatched:
            print(f"  {n}", file=sys.stderr)

    print(
        f"\nDone: {updated} updated, {unchanged} unchanged, "
        f"{len(unmatched)} unmatched."
        + ("  (dry run — no files written)" if args.dry_run else ""),
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
