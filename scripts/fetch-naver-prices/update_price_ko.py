#!/usr/bin/env python3
"""Update ``price.ko`` in rubber JSON files from a Naver products JSON file.

Takes the JSON output of ``scripts/fetch-naver-prices/fetch_naver_prices.py``
(a list of ``{name, price, salePrice, discountRatio}`` where ``price`` is the
regular/MSRP won amount and ``salePrice`` is the discounted price) and updates
the matching rubber files under ``rubbers/**``.

Matching
--------
Matching is driven by the explicit ``NAVER_NAME_TO_ABBR_KO`` table below, which
maps an exact Naver product name to the rubber's Korean abbreviation
(``abbr_i18n.ko``). Products whose name is not present in the table are
ignored. Add / edit entries here whenever a storefront listing changes.

Price format
------------
Rubber JSON stores Korean prices in thousands of won as strings (e.g.
``"92.0"`` = 92,000원). Naver returns raw integer won. Discount is formatted
as ``"-NN%"``.

Usage
-----
  python scripts/fetch-naver-prices/update_price_ko.py products.json
  python scripts/fetch-naver-prices/update_price_ko.py products.json --dry-run
  python scripts/fetch-naver-prices/update_price_ko.py products.json --debug
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

# Explicit mapping: exact Naver product name -> rubber abbr_i18n.ko.
#
# Add / edit rows here when storefront listings change or new rubbers are
# introduced. Product names must match Naver output exactly (whitespace,
# punctuation, and bracket form included). Names not listed here are
# ignored by this script.
NAVER_NAME_TO_ABBR_KO: dict[str, str] = {
    "[엑시옴] 오메가 7 프로 탁구러버 점착보호필름 서비스": "오메가7 프로",
    "MXK 한국 전용 러버 47.5도 점착보호필름 서비스": "MX-K",
    "[버터플라이]디그닉스05 탁구러버 탁구용품": "디그닉스05",
    "[DHS] 금궁 8 탁구러버 47.5도": "금궁8",
    "[닛타쿠] 파스탁 G1 탁구러버 47.5도 특후 2.0mm 점착보호필름 서비스": "G-1",
    "[버터플라이]테너지 05 탁구러버 탁구고무 탁구용품": "테너지05",
    "[버터플라이]디그닉스 09C 탁구러버 점착성": "디그닉스09C",
    "[버터플라이] 자이어03 ZYRE-03 최강의 회전력과 파워 보호필름 1장": "자이어03",
    "[티바] EVOLUTION MXS 스핀형 탁구러버 경도 46.3-48.3": "MX-S",
    "[닛타쿠] 제넥션 특후 1.9mm~2.1mm 52.5도 파워풀한 드라이브": "제넥션",
    "[안드로] 뉴존48 NUZN48 뛰어난 볼 그립력": "뉴존 48",
    "[안드로] 뉴존45 NUZN45 뛰어난 컨트롤": "뉴존 45",
    "[도닉] 블루그립 J3 50도 장지커 개발 참여 러버": "블루그립J3",
    "[도닉] 블루그립 J2 52.5도 장지커 개발 참여 러버": "블루그립J2",
    "[도닉] 블루그립 J1 55도 장지커 개발 참여 러버": "블루그립J1",
    "[도닉] 블루스타 A1 / 52.5도 약점착 공격적인 플레이": "블루스타A1",
    "[엑시옴] C55.0 지킬앤하이드 약점착 탁구러버 MAX": "지킬C55.0",
    "[엑시옴] 오메가 7 차이나 광 특유의 강력한 타구음 55도": "오메가7 광",
    "[버터플라이] 높은컨트롤과 안정성 테너지05 FX 탁구러버": "테너지05 FX",
    "[버터플라이] 완벽한 밸런스 테너지80 탁구러버": "테너지80",
    "[버터플라이] 잡는 감각이 뛰어난 테너지19 탁구러버": "테너지19",
    "[버터플라이] Grayzer 09c 그레이저09c 탁구러버": "글레이저09C",
    "[엑시옴] 오메가8 하이브리드 52.5도 정밀하고 효율적인 플레이": "오메가8 하이브리드",
    "[버터플라이] 테너지 05 하드 단단한 스펀지 53도": "테너지05하드",
    "[엑시옴] 오메가8 차이나 52.5도 가볍지만 성능은 확실한 점착러버": "오메가8 차이나",
    "[엑시옴] 오메가8 프로 다재다능한 플레이 가능한 가벼운 탁구러버": "오메가8 프로",
    "[엑시옴] C52.5 지킬앤하이드 약점착 탁구러버": "지킬C52.5",
    "[도닉] 바라쿠다 스핀형 탁구 러버 MAX": "바라쿠다",
    "[버터플라이] 균형이 뛰어난 디그닉스 80 탁구러버": "디그닉스80",
    "[티바] FXP 과감한 공격형 탁구러버 경도 39.1-41.1도": "FX-P",
    "[티바] FXS 오직 스핀형 러버 경도 41.0-43.0도": "FX-S",
    "[티바] 안정감 랠리형 ELS 탁구러버 경도43.8-45.8도": "EL-S",
    "[티바] EVOLUTION MXD 경도 50.3-52.3": "MX-D",
    "[티바] EVOLUTION ELP 탁구러버 경도 42.4-44.4": "EL-P",
    "[안드로] 라잔터 R48 탁구러버 블루 빨강 검정 그린 MAX": "R48",
    "[안드로] 라잔터 C48 탁구러버 MAX": "C48",
    "[안드로] 라잔타 R53 탁구러버 빨강 검정 MAX": "R53",
    "[안드로] 라잔터 R47 탁구 러버 빨강 검정 MAX": "R47",
    "[안드로] C53 라잔터 탁구 러버": "C53",
    "[안드로] 탁구러버 뉴존 50도 MAX": "뉴존 50",
    "[안드로] 탁구러버 뉴존 55도 MAX": "뉴존 55",
    "MK 하이브리드 티바 탁구러버 경도 48도": "MK",
    "티바 하이브리드 K3 약점착 러버 경도 53": "K3",
    "MXP 50도 티바 탁구러버": "MX-P 50",
    "[버터플라이]로제나 탁구러버 탁구용품": "로제나",
    "[버터플라이]디그닉스 64 탁구러버 탁구고무 탁구용품": "디그닉스64",
    "[버터플라이]테너지 64 탁구러버 탁구고무 탁구용품": "테너지64",
    "티바 EVOLUTION MXP 탁구러버": "MX-P",
    "[DHS] 허리케인 8-80 점착러버 37도 2.1mm": "H8-80",
    "[DHS] 네오허리케인 3 성광(블루스폰지) 39도 2.1mm 점착러버": "H3 Neo"
}


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


def load_rubbers_by_abbr_ko(
    rubbers_dir: Path,
) -> dict[str, tuple[Path, dict]]:
    """Index every rubber JSON by its ``abbr_i18n.ko`` value."""
    index: dict[str, tuple[Path, dict]] = {}
    for jf in sorted(rubbers_dir.rglob("*.json")):
        try:
            data = json.loads(jf.read_text(encoding="utf-8"))
        except Exception as exc:
            print(f"  warn: could not read {jf}: {exc}", file=sys.stderr)
            continue

        ko = (data.get("abbr_i18n") or {}).get("ko")
        if not ko:
            continue
        if ko in index:
            other = index[ko][0]
            print(
                f"  warn: duplicate abbr_i18n.ko={ko!r} in {jf} "
                f"(also in {other}); keeping first",
                file=sys.stderr,
            )
            continue
        index[ko] = (jf, data)
    return index


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
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
        "--show-unmatched",
        action="store_true",
        help="print Naver products that didn't match any mapping entry",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help=(
            "print every product in each bucket: updated, unchanged, "
            "unmatched, missing-rubber"
        ),
    )
    args = parser.parse_args()

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

    rubbers_by_abbr = load_rubbers_by_abbr_ko(rubbers_dir)
    print(
        f"Loaded {len(rubbers_by_abbr)} rubber files from {rubbers_dir}",
        file=sys.stderr,
    )

    taken: set[Path] = set()
    unmatched: list[str] = []  # product name not in NAVER_NAME_TO_ABBR_KO
    missing_rubber: list[tuple[str, str]] = []  # mapped abbr not in repo
    updated_items: list[str] = []
    unchanged_items: list[tuple[str, str]] = []  # (rubber_label, naver_name)

    for p in products:
        name = (p.get("name") or "").strip()
        if not name:
            continue

        abbr_ko = NAVER_NAME_TO_ABBR_KO.get(name)
        if abbr_ko is None:
            unmatched.append(name)
            continue

        entry_rubber = rubbers_by_abbr.get(abbr_ko)
        if entry_rubber is None:
            missing_rubber.append((abbr_ko, name))
            continue

        path, data = entry_rubber
        if path in taken:
            # Two Naver products mapped to the same rubber; keep the first.
            unchanged_items.append((abbr_ko, name))
            continue

        entry = to_price_entry(p)
        if not entry["regular"]:
            print(f"  no-price   : {abbr_ko:<25}  [{name}]")
            continue

        old_price = dict(data.get("price") or {})
        current_ko = dict(old_price.get("ko") or {})

        if current_ko == entry:
            unchanged_items.append((abbr_ko, name))
            taken.add(path)
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
        line = f"  updated    : {abbr_ko:<25} -> {label}  [{name}]"
        print(line)
        updated_items.append(line)
        taken.add(path)

        if not args.dry_run:
            with path.open("w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.write("\n")

    if args.debug:
        print(f"\nUpdated ({len(updated_items)}):", file=sys.stderr)
        for line in updated_items:
            print(line, file=sys.stderr)
        print(f"\nUnchanged ({len(unchanged_items)}):", file=sys.stderr)
        for rubber_label, name in unchanged_items:
            print(f"  {rubber_label:<25}  [{name}]", file=sys.stderr)
        print(f"\nMissing rubber ({len(missing_rubber)}):", file=sys.stderr)
        for abbr, name in missing_rubber:
            print(f"  {abbr:<25}  [{name}]", file=sys.stderr)
        print(f"\nUnmatched ({len(unmatched)}):", file=sys.stderr)
        for n in unmatched:
            print(f"  {n}", file=sys.stderr)
    else:
        if missing_rubber:
            print(
                f"\nMissing rubber ({len(missing_rubber)}):",
                file=sys.stderr,
            )
            for abbr, name in missing_rubber:
                print(f"  {abbr:<25}  [{name}]", file=sys.stderr)
        if args.show_unmatched and unmatched:
            print(f"\nUnmatched ({len(unmatched)}):", file=sys.stderr)
            for n in unmatched:
                print(f"  {n}", file=sys.stderr)

    print(
        f"\nDone: {len(updated_items)} updated, "
        f"{len(unchanged_items)} unchanged, "
        f"{len(missing_rubber)} missing-rubber, "
        f"{len(unmatched)} unmatched."
        + ("  (dry run — no files written)" if args.dry_run else ""),
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
