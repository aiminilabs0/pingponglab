#!/usr/bin/env python3
"""Extract product name + price from a Naver Smart Store category page.

Naver Smart Store renders category pages as a React app and embeds the
initial product list into the HTML under ``window.__PRELOADED_STATE__``.
This script fetches that HTML, pulls out the JSON blob, and walks it
looking for items that look like products (have a ``name`` and a price
field).

Usage:
  python scripts/fetch-naver-prices/fetch_naver_prices.py <URL>
  python scripts/fetch-naver-prices/fetch_naver_prices.py <URL> --pages 3
  python scripts/fetch-naver-prices/fetch_naver_prices.py <URL> --format json

Example:
  python scripts/fetch-naver-prices/fetch_naver_prices.py \
      'https://smartstore.naver.com/takdragon/category/5912fd19b3f1413fa94742e50795a356?st=POPULAR&dt=LIST&page=1&size=80'
"""

from __future__ import annotations

import argparse
import csv
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
from typing import Any

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
    opener.addheaders = []  # we set headers per-request
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
    # Should be unreachable
    if last_exc:
        raise last_exc
    raise RuntimeError("fetch failed")


def warmup(opener: urllib.request.OpenerDirector, url: str) -> None:
    """Visit the storefront root to pick up session cookies."""
    parsed = urllib.parse.urlsplit(url)
    # e.g. path = /takdragon/category/...; take first segment as store slug
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
    # 1) Classic assignment patterns: window.__FOO__ = {...};
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

    # 2) <script id="__NEXT_DATA__" type="application/json">{...}</script>
    for m in re.finditer(
        r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
        html,
        flags=re.DOTALL,
    ):
        try:
            yield ("__NEXT_DATA__", json.loads(m.group(1)))
        except json.JSONDecodeError:
            continue

    # 3) <script type="application/ld+json">...</script> (schema.org ItemList etc.)
    for m in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        flags=re.DOTALL,
    ):
        try:
            yield ("ld+json", json.loads(m.group(1).strip()))
        except json.JSONDecodeError:
            continue

    # 4) Any <script type="application/json">...</script>
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

    # 5) Last resort: scan every inline <script> body for the first balanced
    #    JSON object that parses. Useful if Naver rotates the assignment name.
    for m in re.finditer(r"<script\b[^>]*>([\s\S]*?)</script>", html):
        body = m.group(1)
        if "{" not in body:
            continue
        # Look for productNo / salePrice hints to avoid parsing every blob
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

    # Regular price (MSRP / pre-discount listed price).
    regular = _num(
        node.get("salePrice")
        or node.get("mobileSalePrice")
        or node.get("productPrice")
        or node.get("retailPrice")
    )

    # Discounted / final price after benefits applied.
    sale = _num(
        node.get("discountedSalePrice")
        or node.get("mobileDiscountedSalePrice")
        or bv.get("discountedSalePrice")
        or bv.get("mobileDiscountedSalePrice")
    )

    # Discount percent.
    ratio_raw = (
        node.get("discountedRatio")
        or node.get("discountRatio")
        or bv.get("discountedRatio")
        or bv.get("discountRatio")
    )
    ratio = int(ratio_raw) if isinstance(ratio_raw, (int, float)) else None

    # If we have a sale and it equals regular, there's no actual discount.
    if sale is not None and regular is not None and sale >= regular:
        sale = None

    # Compute ratio if missing.
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
                    # price = regular/MSRP; salePrice = discounted price if on sale,
                    # else same as price. This matches the natural English reading
                    # and the `regular` / `sale` split used in rubbers JSON.
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


def build_page_url(url: str, page: int, size: int | None) -> str:
    parsed = urllib.parse.urlsplit(url)
    query = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
    query["page"] = str(page)
    if size is not None:
        query["size"] = str(size)
    return urllib.parse.urlunsplit(
        parsed._replace(query=urllib.parse.urlencode(query))
    )


def format_price(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if isinstance(value, (int, float)):
        return f"{value:,}원"
    return str(value)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="Naver Smart Store category URL")
    parser.add_argument(
        "--pages",
        type=int,
        default=1,
        help="number of pages to fetch (default: 1)",
    )
    parser.add_argument(
        "--size",
        type=int,
        default=None,
        help="page size override (default: use url's size or Naver default)",
    )
    parser.add_argument(
        "--format",
        choices=["text", "tsv", "csv", "json"],
        default="text",
        help="output format (default: text)",
    )
    parser.add_argument(
        "-o",
        "--output",
        help="write output to file instead of stdout",
    )
    parser.add_argument(
        "--cookie",
        default=None,
        help=(
            "raw Cookie header to send with each request. "
            "Paste from DevTools > Network > any request to smartstore.naver.com "
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
        "--save-html",
        metavar="PATH",
        help="write the raw HTML of each page to PATH.<n>.html (debug)",
    )
    args = parser.parse_args()

    opener = _build_opener()

    if not args.no_warmup:
        warmup(opener, args.url)

    all_products: list[dict] = []
    seen: set = set()

    for i in range(args.pages):
        if i > 0 and args.delay > 0:
            time.sleep(args.delay)
        page_url = build_page_url(args.url, i + 1, args.size)
        try:
            html = fetch_html(
                opener,
                page_url,
                referer=args.url,
                cookie=args.cookie,
            )
        except Exception as exc:
            print(f"page {i + 1}: fetch error: {exc}", file=sys.stderr)
            continue

        if args.save_html:
            path = f"{args.save_html}.{i + 1}.html"
            with open(path, "w", encoding="utf-8") as f:
                f.write(html)
            print(f"  saved raw HTML -> {path} ({len(html)} chars)", file=sys.stderr)

        state = extract_embedded_state(html)
        if state is None:
            print(
                f"page {i + 1}: could not find embedded product JSON "
                f"(window.__PRELOADED_STATE__ etc.)",
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
        print(
            f"page {i + 1}: {len(products)} products ({new} new)",
            file=sys.stderr,
        )

    out = open(args.output, "w", encoding="utf-8", newline="") if args.output else sys.stdout

    try:
        if args.format == "json":
            json.dump(all_products, out, ensure_ascii=False, indent=2)
            out.write("\n")
        elif args.format == "tsv":
            for p in all_products:
                out.write(f"{p['name']}\t{p['price']}\n")
        elif args.format == "csv":
            writer = csv.writer(out)
            writer.writerow(
                ["name", "price", "salePrice", "discountRatio", "id"]
            )
            for p in all_products:
                writer.writerow(
                    [
                        p["name"],
                        p["price"],
                        p["salePrice"],
                        p["discountRatio"],
                        p["id"],
                    ]
                )
        else:
            for p in all_products:
                regular = p["price"]
                sale = p["salePrice"]
                if sale is not None and regular is not None and sale != regular:
                    disc = f" ({p['discountRatio']}%)" if p["discountRatio"] else ""
                    out.write(
                        f"{p['name']}\t{format_price(regular)} → {format_price(sale)}{disc}\n"
                    )
                else:
                    out.write(f"{p['name']}\t{format_price(regular)}\n")
    finally:
        if args.output:
            out.close()

    print(f"\nDone: {len(all_products)} unique products.", file=sys.stderr)
    return 0 if all_products else 1


if __name__ == "__main__":
    raise SystemExit(main())
