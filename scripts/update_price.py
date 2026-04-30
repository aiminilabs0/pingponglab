#!/usr/bin/env python3
"""Fetch prices and update ``price.*`` in rubber JSON files.

Merged replacement for the old ``update_en_price.sh`` +
``update_ko_price.py`` pair. One script, two subcommands:

* ``en`` — scrape megaspin.net and update ``price.en`` / ``price.cn``
  for the given rubber JSON files (or every rubber if none given).
* ``ko`` — scrape the takdragon Naver Smart Store category pages and
  update ``price.ko`` for every rubber whose ``abbr_i18n.ko`` matches
  the ``NAVER_NAME_TO_ABBR_KO`` mapping below.
* ``all`` — run both, in order.

Usage
-----
  ./scripts/update_price.py en [--with-aid|--strip-aid] [<rubber.json> ...]
  ./scripts/update_price.py ko [--dry-run] [--debug] [--url URL ...] ...
  ./scripts/update_price.py all

Price format notes
------------------
* English prices are stored as dollar strings, e.g. ``"$51.95"``.
* Korean prices are stored in thousands of won as strings, e.g.
  ``"92.0"`` meaning 92,000원. Discount is ``"-NN%"``.
* Previous ``price.en`` / ``price.ko`` values are pushed onto
  ``price_history`` with today's date whenever they change.
"""

from __future__ import annotations

import argparse
import gzip
import http.cookiejar
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent
RUBBERS_DIR_DEFAULT = REPO_ROOT / "rubbers"
LOG_FILE = Path(__file__).resolve().parent / "update_price.log"


class _TeeStream(io.TextIOBase):
    """Write to both a terminal stream and a log file."""

    def __init__(self, terminal: io.TextIOBase, log_file: io.TextIOBase):
        self._terminal = terminal
        self._log = log_file

    def write(self, msg: str) -> int:
        self._terminal.write(msg)
        self._log.write(msg)
        self._log.flush()
        return len(msg)

    def flush(self) -> None:
        self._terminal.flush()
        self._log.flush()

    @property
    def encoding(self):
        return getattr(self._terminal, "encoding", "utf-8")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _write_rubber(path: Path, data: dict) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def _iter_rubber_files(rubbers_dir: Path) -> Iterable[Path]:
    return sorted(rubbers_dir.rglob("*.json"))


# ===========================================================================
# en: megaspin.net scraper
# ===========================================================================


def _fetch_megaspin(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _strip_aid(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    query = [(k, v) for k, v in query if k != "aid"]
    return urllib.parse.urlunsplit(
        parsed._replace(query=urllib.parse.urlencode(query))
    )


def _parse_megaspin_price(html: str) -> dict | None:
    price_m = re.search(r'<meta\s+itemprop="price"\s+content="([\d.]+)"', html)
    if not price_m:
        return None
    current = float(price_m.group(1))

    # Regular (list) price block: <div><s><span ...>$51.95</span></s></div>
    list_m = re.search(
        r'<div><s><span[^>]*>\s*\$([\d.]+)\s*</span></s></div>', html
    )
    # Discount line: <div>Save $12.00 (23%)</div>
    disc_m = re.search(r'Save\s+\$[\d.,]+\s+\((\d+)%\)', html)

    if list_m and disc_m:
        regular = float(list_m.group(1))
        if regular > current:
            return {
                "regular": f"${regular:.2f}",
                "sale": f"${current:.2f}",
                "discount": "-" + disc_m.group(1) + "%",
            }

    return {"regular": f"${current:.2f}", "sale": "", "discount": ""}


def run_en(
    files: list[Path],
    *,
    request_mode: str = "with-aid",
    rubbers_dir: Path = RUBBERS_DIR_DEFAULT,
) -> int:
    strip_aid_enabled = request_mode == "strip-aid"

    if not files:
        files = list(_iter_rubber_files(rubbers_dir))

    updated = 0
    skipped = 0

    for path in files:
        with path.open(encoding="utf-8") as f:
            data = json.load(f)

        url = (data.get("urls") or {}).get("en", {}).get("product", "")
        if "megaspin.net" not in url:
            skipped += 1
            continue

        name = data.get("name", path.name)
        print(f"  {name} ... ", end="", flush=True)

        try:
            fetch_url = _strip_aid(url) if strip_aid_enabled else url
            html = _fetch_megaspin(fetch_url)
            entry = _parse_megaspin_price(html)
            if entry is None:
                print("price not found, skipping")
                skipped += 1
                continue
        except Exception as exc:  # noqa: BLE001 — print-and-continue scraper loop
            print(f"error: {exc}")
            skipped += 1
            continue

        old_price = dict(data.get("price") or {})
        current_en = old_price.get("en") or {}
        if current_en and current_en != entry:
            history = list(data.get("price_history") or [])
            history.append({
                "date": date.today().isoformat(),
                "en": current_en,
                "cn": old_price.get("cn") or current_en,
            })
            data["price_history"] = history

        old_price["en"] = entry
        old_price["cn"] = entry
        data["price"] = old_price

        _write_rubber(path, data)

        if entry["sale"]:
            print(
                f"regular {entry['regular']}  sale {entry['sale']}  "
                f"({entry['discount']})"
            )
        else:
            print(entry["regular"])

        updated += 1
        time.sleep(0.3)  # be polite to megaspin

    print(f"\nDone: {updated} updated, {skipped} skipped (no megaspin URL).")
    return 0


# ===========================================================================
# ko: Naver Smart Store scraper
# ===========================================================================

DEFAULT_NAVER_URLS: list[str] = [
    "https://smartstore.naver.com/takdragon/category/5912fd19b3f1413fa94742e50795a356?st=POPULAR&dt=LIST&page=1&size=80",
    "https://smartstore.naver.com/takdragon/category/5912fd19b3f1413fa94742e50795a356?st=POPULAR&dt=LIST&page=2&size=80",
    "https://smartstore.naver.com/takdragon/category/7b6f6a4ceb1745aca9ce205c121e5bbf?cp=1",
]

# Mapping: Naver product name -> rubber abbr_i18n.ko
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


def _fetch_naver(
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
        except Exception as exc:  # noqa: BLE001 — retried with backoff below
            last_exc = exc
            if attempt < retries - 1:
                time.sleep(1 + attempt)
                continue
            raise
    if last_exc:
        raise last_exc
    raise RuntimeError("fetch failed")


def _warmup(opener: urllib.request.OpenerDirector, url: str) -> None:
    """Visit the storefront root to pick up session cookies."""
    parsed = urllib.parse.urlsplit(url)
    parts = [p for p in parsed.path.split("/") if p]
    store_root = f"{parsed.scheme}://{parsed.netloc}/"
    if parts:
        store_root = f"{parsed.scheme}://{parsed.netloc}/{parts[0]}"
    try:
        _fetch_naver(opener, store_root, retries=2)
    except Exception as exc:  # noqa: BLE001 — warmup is best-effort
        print(f"  warmup failed ({exc}); continuing anyway", file=sys.stderr)


def _extract_balanced_json(text: str, start: int) -> str | None:
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


def _extract_embedded_state(html: str) -> Any | None:
    best = None
    best_count = 0
    for source, data in _iter_embedded_json(html):
        count = len(_collect_products(data))
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
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)) and v > 0:
        return v
    return None


def _extract_prices(node: dict) -> tuple[float | None, float | None, int | None]:
    """Return (regular, sale, discount_ratio).

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


def _collect_products(state: Any) -> list[dict]:
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
                    # reading and the regular/sale split used in rubbers JSON.
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


def _fetch_naver_products(
    urls: list[str],
    *,
    cookie: str | None = None,
    delay: float = 1.5,
    do_warmup: bool = True,
) -> list[dict]:
    opener = _build_opener()

    if do_warmup and urls:
        _warmup(opener, urls[0])

    all_products: list[dict] = []
    seen: set = set()

    for i, url in enumerate(urls):
        if i > 0 and delay > 0:
            time.sleep(delay)
        print(f"fetching {url}", file=sys.stderr)
        try:
            html = _fetch_naver(opener, url, referer=urls[0], cookie=cookie)
        except Exception as exc:  # noqa: BLE001 — log and skip the page
            print(f"  fetch error: {exc}", file=sys.stderr)
            continue

        state = _extract_embedded_state(html)
        if state is None:
            print(
                "  could not find embedded product JSON "
                "(window.__PRELOADED_STATE__ etc.)",
                file=sys.stderr,
            )
            continue

        products = _collect_products(state)
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


def _fmt_ko_price(value) -> str:
    """Convert won integer to ``"##.#"`` (thousands) string."""
    if value is None or value == "":
        return ""
    if isinstance(value, str):
        value = float(value.replace(",", ""))
    if not value:
        return ""
    return f"{value / 1000:.1f}"


def _to_ko_price_entry(product: dict) -> dict:
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
            "regular": _fmt_ko_price(regular),
            "sale": _fmt_ko_price(sale),
            "discount": f"-{int(ratio)}%",
        }

    primary = next(
        (v for v in (regular, sale) if isinstance(v, (int, float)) and v > 0),
        None,
    )
    return {"regular": _fmt_ko_price(primary), "sale": "", "discount": ""}


def _load_rubbers_by_abbr_ko(
    rubbers_dir: Path,
) -> dict[str, tuple[Path, dict]]:
    index: dict[str, tuple[Path, dict]] = {}
    for jf in _iter_rubber_files(rubbers_dir):
        try:
            data = json.loads(jf.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001 — log bad JSON and keep going
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


def run_ko(
    *,
    urls: list[str] | None = None,
    rubbers_dir: Path = RUBBERS_DIR_DEFAULT,
    cookie: str | None = None,
    delay: float = 1.5,
    do_warmup: bool = True,
    products_json: Path | None = None,
    save_products: Path | None = None,
    dry_run: bool = False,
    debug: bool = False,
    show_unmatched: bool = False,
) -> int:
    if products_json is not None:
        products = json.loads(products_json.read_text(encoding="utf-8"))
        if not isinstance(products, list):
            print("Error: products JSON must be a list", file=sys.stderr)
            return 1
    else:
        products = _fetch_naver_products(
            urls or DEFAULT_NAVER_URLS,
            cookie=cookie,
            delay=delay,
            do_warmup=do_warmup,
        )
        if not products:
            print("Error: no products fetched", file=sys.stderr)
            return 1

    if save_products is not None:
        save_products.write_text(
            json.dumps(products, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(
            f"Saved {len(products)} products -> {save_products}",
            file=sys.stderr,
        )

    rubbers_by_abbr = _load_rubbers_by_abbr_ko(rubbers_dir)
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

        entry = _to_ko_price_entry(p)
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
            _write_rubber(path, data)

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


# ===========================================================================
# CLI
# ===========================================================================


def _add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--rubbers-dir",
        default=None,
        help=f"rubbers directory (default: {RUBBERS_DIR_DEFAULT})",
    )


def _resolve_rubbers_dir(args) -> Path:
    rubbers_dir = (
        Path(args.rubbers_dir) if args.rubbers_dir else RUBBERS_DIR_DEFAULT
    )
    if not rubbers_dir.is_dir():
        print(f"Error: {rubbers_dir} not found", file=sys.stderr)
        raise SystemExit(1)
    return rubbers_dir


def _cmd_en(args) -> int:
    rubbers_dir = _resolve_rubbers_dir(args)
    files = [Path(f) for f in args.files]
    return run_en(files, request_mode=args.request_mode, rubbers_dir=rubbers_dir)


def _cmd_ko(args) -> int:
    rubbers_dir = _resolve_rubbers_dir(args)
    return run_ko(
        urls=args.urls,
        rubbers_dir=rubbers_dir,
        cookie=args.cookie,
        delay=args.delay,
        do_warmup=not args.no_warmup,
        products_json=Path(args.products_json) if args.products_json else None,
        save_products=Path(args.save_products) if args.save_products else None,
        dry_run=args.dry_run,
        debug=args.debug,
        show_unmatched=args.show_unmatched,
    )


def _cmd_all(args) -> int:
    rubbers_dir = _resolve_rubbers_dir(args)
    rc = run_en([], request_mode="with-aid", rubbers_dir=rubbers_dir)
    if rc != 0:
        return rc
    return run_ko(rubbers_dir=rubbers_dir)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # en
    p_en = sub.add_parser(
        "en",
        help="update price.en / price.cn from megaspin.net",
        description=(
            "Scrape megaspin.net for every rubber JSON that has a "
            "megaspin URL in urls.en.product and update price.en / price.cn."
        ),
    )
    _add_common_args(p_en)
    aid_group = p_en.add_mutually_exclusive_group()
    aid_group.add_argument(
        "--with-aid",
        dest="request_mode",
        action="store_const",
        const="with-aid",
        help="call megaspin with the original URL, including `aid` (default)",
    )
    aid_group.add_argument(
        "--strip-aid",
        dest="request_mode",
        action="store_const",
        const="strip-aid",
        help="remove the `aid` query param before calling megaspin",
    )
    p_en.set_defaults(request_mode="with-aid")
    p_en.add_argument(
        "files",
        nargs="*",
        help=(
            "rubber JSON files to process. If omitted, walks every JSON under "
            "the rubbers directory."
        ),
    )
    p_en.set_defaults(func=_cmd_en)

    # ko
    p_ko = sub.add_parser(
        "ko",
        help="update price.ko from the takdragon Naver Smart Store",
        description=(
            "Scrape the takdragon Naver Smart Store category pages (or the "
            "URLs passed via --url) and update price.ko for every rubber "
            "whose abbr_i18n.ko matches the built-in mapping."
        ),
    )
    _add_common_args(p_ko)
    p_ko.add_argument(
        "--url",
        action="append",
        dest="urls",
        help=(
            "Naver Smart Store category URL to fetch. May be passed multiple "
            "times. Defaults to the takdragon category pages baked into the "
            "script."
        ),
    )
    p_ko.add_argument(
        "--dry-run",
        action="store_true",
        help="print planned changes without writing files",
    )
    p_ko.add_argument(
        "--show-unmatched",
        action="store_true",
        help="print Naver products that didn't match any mapping entry",
    )
    p_ko.add_argument(
        "--debug",
        action="store_true",
        help=(
            "print every product in each bucket: updated, unchanged, "
            "unmatched, missing-rubber"
        ),
    )
    p_ko.add_argument(
        "--cookie",
        default=None,
        help=(
            "raw Cookie header to send with each request. Paste from DevTools "
            "if the built-in warmup isn't enough to bypass 429 / anti-bot."
        ),
    )
    p_ko.add_argument(
        "--no-warmup",
        action="store_true",
        help="skip the storefront pre-visit that collects session cookies",
    )
    p_ko.add_argument(
        "--delay",
        type=float,
        default=1.5,
        help="seconds to sleep between page fetches (default: 1.5)",
    )
    p_ko.add_argument(
        "--products-json",
        default=None,
        help="skip fetching and load products from this JSON file instead",
    )
    p_ko.add_argument(
        "--save-products",
        default=None,
        help="also write the fetched products list to this JSON file",
    )
    p_ko.set_defaults(func=_cmd_ko)

    # all
    p_all = sub.add_parser(
        "all",
        help="run en over every rubber, then ko",
        description="Shortcut for `en` (all rubbers) followed by `ko`.",
    )
    _add_common_args(p_all)
    p_all.set_defaults(func=_cmd_all)

    args = parser.parse_args(argv)

    log_fh = LOG_FILE.open("a", encoding="utf-8")
    log_fh.write(f"\n{'=' * 60}\n")
    log_fh.write(f"Run started: {datetime.now().isoformat()}  command={args.command}\n")
    log_fh.write(f"{'=' * 60}\n")

    sys.stdout = _TeeStream(sys.__stdout__, log_fh)
    sys.stderr = _TeeStream(sys.__stderr__, log_fh)

    try:
        rc = args.func(args)
    finally:
        sys.stdout = sys.__stdout__
        sys.stderr = sys.__stderr__
        log_fh.close()
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
