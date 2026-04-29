#!/usr/bin/env python3
"""Fetch Naver Smart Store prices and update ``price.ko`` in rubber JSON files.

This is the combined replacement for the old two-step workflow
(``fetch_naver_prices.py`` + ``update_price_ko.py``). It fetches a fixed
list of takdragon Smart Store category pages, walks the embedded
``window.__PRELOADED_STATE__`` JSON to pull out product ``name`` / ``price``
/ ``salePrice`` / ``discountRatio``, then updates the matching rubber files
under ``rubbers/**`` based on the explicit ``NAVER_NAME_TO_ABBR_KO`` mapping
below.

How it works
------------
1. Fetch each URL in ``DEFAULT_URLS`` (browser-like headers + cookie warmup
   to get past Naver's anti-bot). The list of products is accumulated and
   de-duplicated by product id.
2. For every fetched product whose name appears in
   ``NAVER_NAME_TO_ABBR_KO``, look up the rubber JSON whose
   ``abbr_i18n.ko`` matches and rewrite ``price.ko`` to
   ``{regular, sale, discount}``. Previous values are pushed onto
   ``price_history`` with today's date.

Matching is name-driven: products whose name is not in the table are
ignored. Add / edit entries there whenever a storefront listing changes.

Price format: rubber JSON stores Korean prices in thousands of won as
strings (e.g. ``"92.0"`` = 92,000원). Naver returns raw integer won.
Discount is formatted as ``"-NN%"``.

Usage
-----
  python scripts/fetch-naver-prices/update_naver_prices.py
  python scripts/fetch-naver-prices/update_naver_prices.py --dry-run
  python scripts/fetch-naver-prices/update_naver_prices.py --debug
  python scripts/fetch-naver-prices/update_naver_prices.py --url <URL> --url <URL>
"""

from __future__ import annotations

import argparse
import gzip
import http.cookiejar
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from datetime import date
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

DEFAULT_URLS: list[str] = [
    "https://smartstore.naver.com/takdragon/category/5912fd19b3f1413fa94742e50795a356?st=POPULAR&dt=LIST&page=1&size=80",
    "https://smartstore.naver.com/takdragon/category/5912fd19b3f1413fa94742e50795a356?st=POPULAR&dt=LIST&page=2&size=80",
    "https://smartstore.naver.com/takdragon/category/7b6f6a4ceb1745aca9ce205c121e5bbf?cp=1",
]

# ---------------------------------------------------------------------------
# Mapping: Naver product name -> rubber abbr_i18n.ko
# ---------------------------------------------------------------------------
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
    "[DHS] 네오허리케인 3 성광(블루스폰지) 39도 2.1mm 점착러버": "H3 Neo",
}


# ---------------------------------------------------------------------------
# Naver fetcher
# ---------------------------------------------------------------------------

DEFAULT_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

BROWSER_HEADERS = {
    "User-Agent": DEFAULT_UA,
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,image/apng,*/*;q=0.8"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate",
    "Cache-Control": "max-age=0",
    "Upgrade-Insecure-Requests": "1",
    "sec-ch-ua": '"Chromium";v="124", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
}

NAME_KEYS = ("name", "productName", "channelProductName", "dispName")
PRICE_KEYS = (
    "discountedSalePrice",
    "salePrice",
    "salePriceWithDiscount",
    "price",
)


def _build_opener() -> urllib.request.OpenerDirector:
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    opener.addheaders = []
    return opener


def _decode_body(resp) -> str:
    raw = resp.read()
    enc = (resp.headers.get("Content-Encoding") or "").lower()
    if enc == "gzip":
        raw = gzip.decompress(raw)
    elif enc == "deflate":
        try:
            raw = zlib.decompress(raw)
        except zlib.error:
            raw = zlib.decompress(raw, -zlib.MAX_WBITS)
    charset = resp.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


def fetch_html(
    opener: urllib.request.OpenerDirector,
    url: str,
    *,
    referer: str | None = None,
    cookie: str | None = None,
    retries: int = 3,
) -> str:
    headers = dict(BROWSER_HEADERS)
    if referer:
        headers["Referer"] = referer
        headers["Sec-Fetch-Site"] = "same-origin"
    if cookie:
        headers["Cookie"] = cookie

    last_exc: Exception | None = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers=headers)
        try:
            with opener.open(req, timeout=30) as resp:
                return _decode_body(resp)
        except urllib.error.HTTPError as exc:
            last_exc = exc
            if exc.code in (429, 503) and attempt < retries - 1:
                wait = 2 ** attempt * 2  # 2s, 4s, 8s
                print(
                    f"  HTTP {exc.code}; backing off {wait}s then retrying...",
                    file=sys.stderr,
                )
                time.sleep(wait)
                continue
            raise
        except Exception as exc:
            last_exc = exc
            if attempt < retries - 1:
                time.sleep(1 + attempt)
                continue
            raise
    if last_exc:
        raise last_exc
    raise RuntimeError("fetch failed")


def warmup(opener: urllib.request.OpenerDirector, url: str) -> None:
    """Visit the storefront root to pick up session cookies."""
    parsed = urllib.parse.urlsplit(url)
    parts = [p for p in parsed.path.split("/") if p]
    store_root = f"{parsed.scheme}://{parsed.netloc}/"
    if parts:
        store_root = f"{parsed.scheme}://{parsed.netloc}/{parts[0]}"
    try:
        fetch_html(opener, store_root, retries=2)
    except Exception as exc:
        print(f"  warmup failed ({exc}); continuing anyway", file=sys.stderr)


def _extract_balanced_json(text: str, start: int) -> str | None:
    """Return the JSON object starting at ``text[start]`` (must be ``{``)."""
    if start >= len(text) or text[start] != "{":
        return None
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def _iter_embedded_json(html: str):
    """Yield every JSON object we can plausibly pull out of the HTML."""
    assign_patterns = [
        r"window\.__PRELOADED_STATE__\s*=\s*",
        r"window\.__APOLLO_STATE__\s*=\s*",
        r"window\.__INITIAL_STATE__\s*=\s*",
        r"window\.__NUXT__\s*=\s*",
        r"window\.__STATE__\s*=\s*",
        r"__PRELOADED_STATE__\s*=\s*",
        r"__APOLLO_STATE__\s*=\s*",
    ]
    for pat in assign_patterns:
        for m in re.finditer(pat, html):
            blob = _extract_balanced_json(html, m.end())
            if blob is None:
                continue
            try:
                yield ("assign:" + pat, json.loads(blob))
            except json.JSONDecodeError:
                continue

    for m in re.finditer(
        r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
        html,
        flags=re.DOTALL,
    ):
        try:
            yield ("__NEXT_DATA__", json.loads(m.group(1)))
        except json.JSONDecodeError:
            continue

    for m in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        flags=re.DOTALL,
    ):
        try:
            yield ("ld+json", json.loads(m.group(1).strip()))
        except json.JSONDecodeError:
            continue

    for m in re.finditer(
        r'<script[^>]+type=["\']application/json["\'][^>]*>(.*?)</script>',
        html,
        flags=re.DOTALL,
    ):
        raw = m.group(1).strip()
        if not raw:
            continue
        try:
            yield ("application/json", json.loads(raw))
        except json.JSONDecodeError:
            continue

    # Last resort: scan inline <script> bodies for a balanced JSON object that
    # mentions a price field. Useful if Naver rotates the assignment name.
    for m in re.finditer(r"<script\b[^>]*>([\s\S]*?)</script>", html):
        body = m.group(1)
        if "{" not in body:
            continue
        if "salePrice" not in body and "discountedSalePrice" not in body:
            continue
        start = 0
        while True:
            idx = body.find("{", start)
            if idx < 0:
                break
            blob = _extract_balanced_json(body, idx)
            if blob is None:
                break
            try:
                yield ("inline-script", json.loads(blob))
            except json.JSONDecodeError:
                pass
            start = idx + 1


def extract_embedded_state(html: str) -> Any | None:
    """Return the richest JSON blob we can find that contains products."""
    best = None
    best_count = 0
    for source, data in _iter_embedded_json(html):
        count = len(collect_products(data))
        if count > best_count:
            best = data
            best_count = count
            if count >= 1:
                print(
                    f"  found embedded state via {source} ({count} products)",
                    file=sys.stderr,
                )
    return best


def _first_matching(d: dict, keys: tuple[str, ...]):
    for k in keys:
        if k in d and d[k] not in (None, "", 0):
            return d[k]
    return None


def _looks_like_product(node: dict) -> bool:
    name = _first_matching(node, NAME_KEYS)
    price = _first_matching(node, PRICE_KEYS)
    return (
        isinstance(name, str)
        and name.strip() != ""
        and isinstance(price, (int, float))
    )


def _num(v):
    """Return v if it's a positive number, else None."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)) and v > 0:
        return v
    return None


def _extract_prices(node: dict) -> tuple[float | None, float | None, int | None]:
    """Return (regular, sale, discount_ratio) for a product-like dict.

    Naver's list API puts the discounted price inside ``benefitsView`` (not
    at the top level like the single-product detail API does). We check both.
    """
    bv = node.get("benefitsView") if isinstance(node.get("benefitsView"), dict) else {}

    regular = _num(
        node.get("salePrice")
        or node.get("mobileSalePrice")
        or node.get("productPrice")
        or node.get("retailPrice")
    )

    sale = _num(
        node.get("discountedSalePrice")
        or node.get("mobileDiscountedSalePrice")
        or bv.get("discountedSalePrice")
        or bv.get("mobileDiscountedSalePrice")
    )

    ratio_raw = (
        node.get("discountedRatio")
        or node.get("discountRatio")
        or bv.get("discountedRatio")
        or bv.get("discountRatio")
    )
    ratio = int(ratio_raw) if isinstance(ratio_raw, (int, float)) else None

    if sale is not None and regular is not None and sale >= regular:
        sale = None

    if sale is not None and regular is not None and ratio is None:
        ratio = round((regular - sale) / regular * 100)

    return regular, sale, ratio


def collect_products(state: Any) -> list[dict]:
    products: list[dict] = []
    seen_ids: set = set()

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            if _looks_like_product(node):
                name = _first_matching(node, NAME_KEYS)
                regular, sale, ratio = _extract_prices(node)
                primary = sale if sale is not None else regular
                if primary is None:
                    primary = _first_matching(node, PRICE_KEYS)
                pid = (
                    node.get("productNo")
                    or node.get("channelProductNo")
                    or node.get("id")
                )
                key = pid if pid is not None else (name, primary)
                if key not in seen_ids:
                    seen_ids.add(key)
                    # price = regular/MSRP; salePrice = discounted price if on
                    # sale, else same as price. Matches the natural English
                    # reading and the regular / sale split used in rubbers JSON.
                    products.append(
                        {
                            "id": pid,
                            "name": str(name).strip(),
                            "price": regular if regular is not None else primary,
                            "salePrice": sale if sale is not None else regular,
                            "discountRatio": ratio,
                        }
                    )
            for v in node.values():
                visit(v)
        elif isinstance(node, list):
            for v in node:
                visit(v)

    visit(state)
    return products


def fetch_products(
    urls: list[str],
    *,
    cookie: str | None = None,
    delay: float = 1.5,
    do_warmup: bool = True,
) -> list[dict]:
    opener = _build_opener()

    if do_warmup and urls:
        warmup(opener, urls[0])

    all_products: list[dict] = []
    seen: set = set()

    for i, url in enumerate(urls):
        if i > 0 and delay > 0:
            time.sleep(delay)
        print(f"fetching {url}", file=sys.stderr)
        try:
            html = fetch_html(opener, url, referer=urls[0], cookie=cookie)
        except Exception as exc:
            print(f"  fetch error: {exc}", file=sys.stderr)
            continue

        state = extract_embedded_state(html)
        if state is None:
            print(
                "  could not find embedded product JSON "
                "(window.__PRELOADED_STATE__ etc.)",
                file=sys.stderr,
            )
            continue

        products = collect_products(state)
        new = 0
        for p in products:
            key = p["id"] if p["id"] is not None else (p["name"], p["price"])
            if key in seen:
                continue
            seen.add(key)
            all_products.append(p)
            new += 1
        print(f"  {len(products)} products ({new} new)", file=sys.stderr)

    print(f"\nFetched {len(all_products)} unique products.\n", file=sys.stderr)
    return all_products


# ---------------------------------------------------------------------------
# Rubber JSON updater
# ---------------------------------------------------------------------------


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


def update_rubber_prices(
    products: list[dict],
    rubbers_dir: Path,
    *,
    dry_run: bool = False,
    debug: bool = False,
    show_unmatched: bool = False,
) -> int:
    rubbers_by_abbr = load_rubbers_by_abbr_ko(rubbers_dir)
    print(
        f"Loaded {len(rubbers_by_abbr)} rubber files from {rubbers_dir}",
        file=sys.stderr,
    )

    taken: set[Path] = set()
    unmatched: list[str] = []
    missing_rubber: list[tuple[str, str]] = []
    updated_items: list[str] = []
    unchanged_items: list[tuple[str, str]] = []

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

        if not dry_run:
            with path.open("w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.write("\n")

    if debug:
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
        if show_unmatched and unmatched:
            print(f"\nUnmatched ({len(unmatched)}):", file=sys.stderr)
            for n in unmatched:
                print(f"  {n}", file=sys.stderr)

    print(
        f"\nDone: {len(updated_items)} updated, "
        f"{len(unchanged_items)} unchanged, "
        f"{len(missing_rubber)} missing-rubber, "
        f"{len(unmatched)} unmatched."
        + ("  (dry run — no files written)" if dry_run else ""),
        file=sys.stderr,
    )
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--url",
        action="append",
        dest="urls",
        help=(
            "Naver Smart Store category URL to fetch. May be passed multiple "
            "times. Defaults to the takdragon category pages baked into the "
            "script."
        ),
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
    parser.add_argument(
        "--cookie",
        default=None,
        help=(
            "raw Cookie header to send with each request. Paste from DevTools "
            "if the built-in warmup isn't enough to bypass 429 / anti-bot."
        ),
    )
    parser.add_argument(
        "--no-warmup",
        action="store_true",
        help="skip the storefront pre-visit that collects session cookies",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.5,
        help="seconds to sleep between page fetches (default: 1.5)",
    )
    parser.add_argument(
        "--products-json",
        default=None,
        help=(
            "skip fetching and load products from this file instead "
            "(format: JSON output of the old fetch_naver_prices.py)"
        ),
    )
    parser.add_argument(
        "--save-products",
        default=None,
        help="also write the fetched products list to this JSON file",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent.parent
    rubbers_dir = (
        Path(args.rubbers_dir) if args.rubbers_dir else repo_root / "rubbers"
    )
    if not rubbers_dir.is_dir():
        print(f"Error: {rubbers_dir} not found", file=sys.stderr)
        return 1

    if args.products_json:
        products = json.loads(
            Path(args.products_json).read_text(encoding="utf-8")
        )
        if not isinstance(products, list):
            print("Error: products JSON must be a list", file=sys.stderr)
            return 1
    else:
        urls = args.urls if args.urls else DEFAULT_URLS
        products = fetch_products(
            urls,
            cookie=args.cookie,
            delay=args.delay,
            do_warmup=not args.no_warmup,
        )
        if not products:
            print("Error: no products fetched", file=sys.stderr)
            return 1

    if args.save_products:
        Path(args.save_products).write_text(
            json.dumps(products, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(
            f"Saved {len(products)} products -> {args.save_products}",
            file=sys.stderr,
        )

    return update_rubber_prices(
        products,
        rubbers_dir,
        dry_run=args.dry_run,
        debug=args.debug,
        show_unmatched=args.show_unmatched,
    )


if __name__ == "__main__":
    raise SystemExit(main())
