#!/usr/bin/env python3
"""
Generate static HTML pages for PingPongLab clean URLs.

Reads rubber data and comparison files, then generates:
- js/slug-map.json (bidirectional abbr <-> slug mapping)
- Root index.html (redirect to /en/)
- Country homepages (/en/, /ko/, /cn/)
- Rubber detail pages (~86 per country)
- Comparison pages (all rubber pair combinations)
- sitemap.xml
- 404.html
"""

import json
import os
import re
import sys
from datetime import date
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COUNTRIES = ['en', 'ko', 'cn']
# <html lang="..."> values
COUNTRY_LANGS = {'en': 'en', 'ko': 'ko', 'cn': 'zh-CN'}
# Values used for the <link rel="alternate" hreflang="..."> tag.
# Use region-neutral codes for en/ko and the Simplified Chinese tag for cn.
HREFLANG_CODES = {'en': 'en', 'ko': 'ko', 'cn': 'zh-CN'}
# Open Graph locale codes.
OG_LOCALES = {'en': 'en_US', 'ko': 'ko_KR', 'cn': 'zh_CN'}

BASE_URL = 'https://pingponglab.com'
TODAY = date.today().isoformat()

# ── Slug utility ──

def to_slug(name):
    """Convert rubber name to URL slug."""
    s = name.lower()
    s = s.replace('&', '')
    s = re.sub(r'\s+', '-', s)
    s = re.sub(r'-{2,}', '-', s)
    s = s.strip('-')
    return s


# ── Load data ──

def load_rubber_index():
    """Load the rubber index file and extract abbreviations + names."""
    index_path = ROOT / 'stats' / 'rubbers' / 'index.json'
    with open(index_path) as f:
        files = json.load(f)
    rubbers = []
    for filepath in files:
        parts = filepath.split('/')
        brand = parts[1]
        abbr = parts[2].replace('.json', '')
        # Read the rubber JSON to get the full name
        rubber_path = ROOT / filepath
        with open(rubber_path) as f:
            rubber_data = json.load(f)
        name = rubber_data.get('name', abbr)
        only_locales = rubber_data.get('onlyLocales')
        if only_locales is not None and not isinstance(only_locales, list):
            only_locales = None
        rubbers.append({
            'brand': brand,
            'abbr': abbr,
            'name': name,
            'name_i18n': rubber_data.get('name_i18n') or {},
            'abbr_i18n': rubber_data.get('abbr_i18n') or {},
            'manufacturer': rubber_data.get('manufacturer') or brand,
            'details': rubber_data.get('manufacturer_details') or {},
            'price': rubber_data.get('price') or {},
            'urls': rubber_data.get('urls') or {},
            'file': filepath,
            'only_locales': only_locales,
        })
    return rubbers


# ── Localization helpers ──

def localized_name(rubber, country):
    """Return the best display name for ``rubber`` in ``country`` locale."""
    return (rubber.get('name_i18n', {}).get(country)
            or rubber.get('name')
            or rubber.get('abbr'))


# ── Korean josa (particle) selection ──
#
# Rubber names mix Hangul, digits, and Latin letters (e.g. 디그닉스05, D05,
# 트로닉스ZGR). The appropriate particle (와/과, 을/를, 이/가, 은/는, (으)로)
# depends on whether the *pronounced* last syllable has a 받침 (final
# consonant). We approximate pronunciation for non-Hangul tails by mapping
# digits and Latin letters to their standard Korean reading.

# Digit (0~9) readings and whether the reading ends with a 받침.
_DIGIT_HAS_JONG = {
    '0': True,   # 영  → ㅇ
    '1': True,   # 일  → ㄹ
    '2': False,  # 이
    '3': True,   # 삼  → ㅁ
    '4': False,  # 사
    '5': False,  # 오
    '6': True,   # 육  → ㄱ
    '7': True,   # 칠  → ㄹ
    '8': True,   # 팔  → ㄹ
    '9': False,  # 구
}

# Latin letter readings (single-letter pronunciations) and whether they end with a 받침.
_LETTER_HAS_JONG = {
    'A': False, 'B': False, 'C': False, 'D': False, 'E': False,
    'F': True,  'G': False, 'H': False, 'I': False, 'J': False,
    'K': False, 'L': True,  'M': True,  'N': True,  'O': False,
    'P': False, 'Q': False, 'R': True,  'S': True,  'T': False,
    'U': False, 'V': False, 'W': False, 'X': True,  'Y': False, 'Z': True,
}


def _has_final_consonant(word):
    """Return True if the last pronounced syllable of ``word`` ends with a
    Korean 받침 (final consonant), False otherwise. Unknown characters
    default to False (no 받침)."""
    for ch in reversed(word.strip()):
        if ch.isspace():
            continue
        code = ord(ch)
        # Hangul syllable block: 가(0xAC00) ~ 힣(0xD7A3)
        if 0xAC00 <= code <= 0xD7A3:
            return ((code - 0xAC00) % 28) != 0
        if ch.isdigit():
            return _DIGIT_HAS_JONG.get(ch, False)
        if ch.isalpha():
            return _LETTER_HAS_JONG.get(ch.upper(), False)
        # Anything else (punctuation, symbols): skip and keep looking.
    return False


def josa(word, with_jong, without_jong):
    """Return ``with_jong`` if ``word`` ends in a 받침, else ``without_jong``.

    Example: ``josa('자이어03', '을', '를')`` → ``'을'`` (03 reads as 영삼,
    ending in ㅁ)."""
    return with_jong if _has_final_consonant(word) else without_jong


# Copy templates for rubber detail and comparison pages. Keep these short so
# titles stay under Google's ~60-char limit where possible.
RUBBER_TITLE = {
    'en': '{name} Review — {brand} Table Tennis Rubber | PingPongLab',
    'ko': '{name} 리뷰 — {brand} 탁구 러버 | PingPongLab',
    'cn': '{name} 评测 — {brand} 乒乓球胶皮 | PingPongLab',
}

RUBBER_DESC = {
    'en': ('Review of the {name} table tennis rubber by {brand}. '
           'Compare speed, spin, control, hardness and weight against other rubbers on PingPongLab.'),
    'ko': ('{brand} {name} 탁구 러버 리뷰. '
           '스피드, 스핀, 컨트롤, 경도, 무게를 다른 러버들과 비교해 보세요.'),
    'cn': ('{brand} {name} 乒乓球胶皮评测。'
           '与其他胶皮对比速度、旋转、控制、硬度与重量。'),
}

RUBBER_H1 = {
    'en': '{name} Review',
    'ko': '{name} 리뷰',
    'cn': '{name} 评测',
}

COMPARE_TITLE = {
    'en': '{a} vs {b} — Rubber Comparison | PingPongLab',
    'ko': '{a} vs {b} — 러버 비교 | PingPongLab',
    'cn': '{a} vs {b} — 胶皮对比 | PingPongLab',
}

def _compare_desc_ko(a, b):
    wa = josa(a, '과', '와')
    eul = josa(b, '을', '를')
    return (f'{a}{wa} {b}{eul} 나란히 비교 — '
            '스피드, 스핀, 컨트롤, 경도, 무게와 선수 사용 현황.')


COMPARE_DESC = {
    'en': lambda a, b: (f'Compare {a} and {b} side by side: speed, spin, control, '
                        f'hardness, weight, and player usage on PingPongLab.'),
    'ko': _compare_desc_ko,
    'cn': lambda a, b: (f'{a} 与 {b} 全面对比 — 速度、旋转、控制、硬度、重量与职业选手使用情况。'),
}

COMPARE_H1 = {
    'en': '{a} vs {b}',
    'ko': '{a} vs {b}',
    'cn': '{a} vs {b}',
}

BREADCRUMB_HOME = {'en': 'Home', 'ko': '홈', 'cn': '首页'}
BREADCRUMB_RUBBERS = {'en': 'Rubbers', 'ko': '러버', 'cn': '胶皮'}
BREADCRUMB_COMPARE = {'en': 'Compare', 'ko': '비교', 'cn': '对比'}


def load_seo_pages():
    """Load curated SEO landing pages (e.g. "Top 10 ..." lists).

    Returns a list of dicts with keys: slug, locales, title (dict per locale),
    description (dict per locale), rubbers (list of rubber names).
    Missing file returns empty list.
    """
    path = ROOT / 'stats' / 'rubbers' / 'seo-pages.json'
    if not path.exists():
        return []
    with open(path) as f:
        return json.load(f)


def load_comparison_pairs():
    """Find all comparison pairs that have content (from en directory)."""
    comp_dir = ROOT / 'rubbers_comparison' / 'en'
    pairs = set()
    if not comp_dir.exists():
        return pairs
    for rubber_dir in comp_dir.iterdir():
        if not rubber_dir.is_dir():
            continue
        name_a = rubber_dir.name
        for comp_file in rubber_dir.iterdir():
            if comp_file.is_dir():
                continue
            name_b = comp_file.name
            # Store as sorted tuple to avoid duplicates
            pair = tuple(sorted([name_a, name_b]))
            pairs.add(pair)
    return pairs


# ── Slug map generation ──

def generate_slug_map(rubbers):
    """Generate bidirectional slug <-> abbr mapping with collision detection.
    Slugs are derived from the rubber's full name (not abbreviation)."""
    abbr_to_slug = {}
    slug_to_abbr = {}

    for r in rubbers:
        abbr = r['abbr']
        name = r['name']
        slug = to_slug(name)

        if slug in slug_to_abbr:
            print(f"ERROR: Slug collision! '{name}' (abbr '{abbr}') and "
                  f"'{slug_to_abbr[slug]}' both map to '{slug}'",
                  file=sys.stderr)
            sys.exit(1)

        abbr_to_slug[abbr] = slug
        slug_to_abbr[slug] = abbr

    return {'abbrToSlug': abbr_to_slug, 'slugToAbbr': slug_to_abbr}


# ── Template processing ──

def read_template():
    """Read the main index.html template."""
    template_path = ROOT / 'index.html'
    with open(template_path) as f:
        return f.read()


def make_page(template, title, description, canonical,
              og_title=None, og_description=None, country=None,
              alternates=None, heading=None, jsonld_blocks=None):
    """Create a page from template with custom meta tags.

    ``alternates`` is an optional mapping ``{country_code: full_url}`` used to
    emit ``<link rel="alternate" hreflang="...">`` tags pointing at the same
    page in each supported language. When provided, it also drives the
    per-page ``og:locale:alternate`` list.

    ``heading`` (if set) rewrites the visible ``<h1 class="header-title">`` so
    crawlers see a page-specific heading in the body.

    ``jsonld_blocks`` is an optional list of JSON-serialisable dicts that
    will be injected as ``<script type="application/ld+json">`` tags right
    before ``</head>``.
    """
    html = template

    # Set lang attribute on <html> tag
    if country and country in COUNTRY_LANGS:
        lang = COUNTRY_LANGS[country]
        html = re.sub(r'<html lang="[^"]*">', f'<html lang="{lang}">', html, count=1)

    # Replace title
    html = re.sub(
        r'<title>[^<]*</title>',
        f'<title>{esc(title)}</title>',
        html, count=1
    )

    # Replace meta description
    html = re.sub(
        r'<meta name="description" content="[^"]*">',
        f'<meta name="description" content="{esc(description)}">',
        html, count=1
    )

    # Replace canonical
    html = re.sub(
        r'<link rel="canonical" href="[^"]*">',
        f'<link rel="canonical" href="{esc(canonical)}">',
        html, count=1
    )

    # Rewrite hreflang alternate links. We always emit one entry per
    # supported locale (when available) plus an ``x-default`` pointing at
    # the English URL, which is the best fallback for search engines.
    html = _rewrite_hreflang(html, alternates or {country: canonical})

    # Replace OG tags
    og_t = og_title or title
    og_d = og_description or description
    html = re.sub(
        r'<meta property="og:title" content="[^"]*">',
        f'<meta property="og:title" content="{esc(og_t)}">',
        html, count=1
    )
    html = re.sub(
        r'<meta property="og:description" content="[^"]*">',
        f'<meta property="og:description" content="{esc(og_d)}">',
        html, count=1
    )
    html = re.sub(
        r'<meta property="og:url" content="[^"]*">',
        f'<meta property="og:url" content="{esc(canonical)}">',
        html, count=1
    )
    # og:locale / og:locale:alternate
    if country in OG_LOCALES:
        html = re.sub(
            r'<meta property="og:locale" content="[^"]*">',
            f'<meta property="og:locale" content="{OG_LOCALES[country]}">',
            html, count=1
        )
        alt_locales = [OG_LOCALES[c] for c in COUNTRIES
                       if c != country and c in (alternates or {})]
        # If no alternates map was passed, still advertise the other site locales.
        if not alt_locales:
            alt_locales = [OG_LOCALES[c] for c in COUNTRIES if c != country]
        html = _rewrite_og_locale_alternates(html, alt_locales)
    html = re.sub(
        r'<meta name="twitter:title" content="[^"]*">',
        f'<meta name="twitter:title" content="{esc(og_t)}">',
        html, count=1
    )
    html = re.sub(
        r'<meta name="twitter:description" content="[^"]*">',
        f'<meta name="twitter:description" content="{esc(og_d)}">',
        html, count=1
    )

    # Rewrite the visible heading for crawlers / no-JS users.
    if heading:
        html = re.sub(
            r'<h1 class="header-title">[^<]*</h1>',
            f'<h1 class="header-title">{esc(heading)}</h1>',
            html, count=1
        )

    # Inject structured data blocks. Escape ``</`` defensively so a stray
    # closing tag inside any string value cannot terminate the script early.
    if jsonld_blocks:
        def _serialize(block):
            return json.dumps(block, ensure_ascii=False).replace('</', '<\\/')
        scripts = '\n'.join(
            '    <script type="application/ld+json">' + _serialize(block) + '</script>'
            for block in jsonld_blocks
        )
        html = html.replace('</head>', scripts + '\n</head>', 1)

    return html


# ── Hreflang / OG locale rewriting helpers ──

def _rewrite_hreflang(html, alternates):
    """Replace the ``<link rel="alternate" hreflang="...">`` block with
    one entry per locale in ``alternates`` + an ``x-default`` entry.

    The template ships with four alternate tags (en/ko/zh-CN/x-default); we
    strip all of them and emit a fresh block so we can drop locales that are
    not available for a given page (e.g. a cn-only landing page)."""
    lines = []
    for code in COUNTRIES:
        if code in alternates:
            lines.append(
                f'    <link rel="alternate" hreflang="{HREFLANG_CODES[code]}" '
                f'href="{esc(alternates[code])}">'
            )
    # x-default → en when available, otherwise first alternate.
    default_url = alternates.get('en') or next(iter(alternates.values()), None)
    if default_url:
        lines.append(
            f'    <link rel="alternate" hreflang="x-default" '
            f'href="{esc(default_url)}">'
        )
    replacement = '\n'.join(lines)

    # Strip every existing hreflang tag (including x-default) then inject the
    # new block right after the canonical link. Preserves surrounding content.
    html = re.sub(
        r'[ \t]*<link rel="alternate" hreflang="[^"]*" href="[^"]*">\n?',
        '', html
    )
    html = re.sub(
        r'(<link rel="canonical" href="[^"]*">)',
        r'\1\n' + replacement,
        html, count=1
    )
    return html


def _rewrite_og_locale_alternates(html, alt_locales):
    """Replace existing ``og:locale:alternate`` tags with the provided list."""
    html = re.sub(
        r'[ \t]*<meta property="og:locale:alternate" content="[^"]*">\n?',
        '', html
    )
    if not alt_locales:
        return html
    block = '\n'.join(
        f'    <meta property="og:locale:alternate" content="{code}">'
        for code in alt_locales
    )
    html = re.sub(
        r'(<meta property="og:locale" content="[^"]*">)',
        r'\1\n' + block,
        html, count=1
    )
    return html


def esc(text):
    """Escape for HTML attribute values."""
    return (text
            .replace('&', '&amp;')
            .replace('"', '&quot;')
            .replace('<', '&lt;')
            .replace('>', '&gt;'))


def inject_seo_preset(html, seo_data, heading=None):
    """Inject the __SEO_PAGE__ preset script into the HTML head.

    Also optionally rewrites the visible page heading (<h1 class="header-title">)
    so crawlers see the landing-page-specific title in the body.
    """
    payload = json.dumps(seo_data, ensure_ascii=False)
    script_tag = (
        '    <script>window.__SEO_PAGE__ = ' + payload + ';</script>\n'
        '</head>'
    )
    html = html.replace('</head>', script_tag, 1)

    if heading:
        html = re.sub(
            r'<h1 class="header-title">[^<]*</h1>',
            f'<h1 class="header-title">{esc(heading)}</h1>',
            html, count=1
        )

    return html


def write_file(path, content):
    """Write content to file only if it differs from the existing content."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text() == content:
        return
    with open(path, 'w') as f:
        f.write(content)


# ── Country names ──

COUNTRY_NAMES = {
    'en': 'USA',
    'ko': 'Korea',
    'cn': 'China'
}

COUNTRY_TITLES = {
    'en': 'PingPongLab | Best Ping Pong Rubber',
    'ko': 'PingPongLab | 탁구 러버 비교',
    'cn': 'PingPongLab | 乒乓球胶皮对比'
}

COUNTRY_DESCRIPTIONS = {
    'en': 'Compare ping pong rubbers by speed, spin, control, hardness, and weight. Find the best rubber for your style.',
    'ko': '탁구 러버를 스피드, 스핀, 컨트롤, 경도, 무게로 비교하세요. 나에게 맞는 최고의 러버를 찾아보세요.',
    'cn': '按速度、旋转、控制、硬度和重量对比乒乓球胶皮。找到最适合你打法的胶皮。'
}


def countries_for_rubber(rubber):
    """Site country codes (en/ko/cn) that should get static pages for this rubber.

    If ``onlyLocales`` is set in the rubber JSON, pages are generated only for those
    locales (must match entries in COUNTRIES). Otherwise all countries.
    """
    locs = rubber.get('only_locales')
    if not locs:
        return list(COUNTRIES)
    return [c for c in COUNTRIES if c in locs]


def countries_for_pair(rubber_a, rubber_b):
    """Countries where both rubbers are available (intersection of locale restrictions)."""
    allowed_a = set(countries_for_rubber(rubber_a))
    allowed_b = set(countries_for_rubber(rubber_b))
    return sorted(allowed_a & allowed_b)


# ── Structured data helpers ──

def breadcrumb_jsonld(items):
    """Return a BreadcrumbList JSON-LD dict from ``items``, a list of
    (name, url) tuples. A trailing item with a falsy url is treated as the
    current page and kept without a URL."""
    list_items = []
    for pos, (name, url) in enumerate(items, start=1):
        entry = {
            '@type': 'ListItem',
            'position': pos,
            'name': name,
        }
        if url:
            entry['item'] = url
        list_items.append(entry)
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        'itemListElement': list_items,
    }


_PRICE_CURRENCY = {'en': 'USD', 'ko': 'KRW', 'cn': 'USD'}


def _parse_price(price_str):
    """Return a float price from strings like '$59.95' or '95.0', or None."""
    if not price_str:
        return None
    cleaned = price_str.replace('$', '').replace(',', '').strip()
    try:
        val = float(cleaned)
        return val if val > 0 else None
    except (ValueError, TypeError):
        return None


def product_jsonld(rubber, country, canonical):
    """Return a Product + Review JSON-LD block for the given rubber page."""
    name = localized_name(rubber, country)
    details = rubber.get('details') or {}
    additional = []
    if details.get('hardness') is not None:
        additional.append({
            '@type': 'PropertyValue',
            'name': 'Hardness',
            'value': details['hardness'],
        })
    if details.get('weight') is not None:
        additional.append({
            '@type': 'PropertyValue',
            'name': 'Weight',
            'value': details['weight'],
            'unitCode': 'GRM',
        })
    if details.get('sheet'):
        additional.append({
            '@type': 'PropertyValue',
            'name': 'Sheet type',
            'value': details['sheet'],
        })
    if details.get('thickness'):
        thickness = details['thickness']
        if isinstance(thickness, list):
            value = ', '.join(str(t) for t in thickness)
        else:
            value = str(thickness)
        additional.append({
            '@type': 'PropertyValue',
            'name': 'Thickness (mm)',
            'value': value,
        })

    product = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        'name': name,
        'category': 'Table tennis rubber',
        'brand': {'@type': 'Brand', 'name': rubber.get('manufacturer') or rubber.get('brand')},
        'manufacturer': {'@type': 'Organization', 'name': rubber.get('manufacturer') or rubber.get('brand')},
        'url': canonical,
        'image': f'{BASE_URL}/images/share-preview.png',
    }
    if additional:
        product['additionalProperty'] = additional
    if details.get('release_year'):
        product['releaseDate'] = str(details['release_year'])
    if details.get('country'):
        product['countryOfOrigin'] = details['country']

    price_data = (rubber.get('price') or {}).get(country) or {}
    price_val = _parse_price(price_data.get('sale')) or _parse_price(price_data.get('regular'))
    if price_val is not None:
        # KRW prices are stored as thousands (e.g. "84.0" = ₩84,000)
        if country == 'ko':
            price_val = round(price_val * 1000)
        offer = {
            '@type': 'Offer',
            'priceCurrency': _PRICE_CURRENCY.get(country, 'USD'),
            'price': price_val,
            'availability': 'https://schema.org/InStock',
        }
        product_url = (rubber.get('urls') or {}).get(country, {}).get('product', '')
        if product_url:
            offer['url'] = product_url
        product['offers'] = offer

    return product


# ── Main generation ──

def main():
    print('Loading rubber data...')
    rubbers = load_rubber_index()
    print(f'  Found {len(rubbers)} rubbers')

    print('Loading comparison pairs with content...')
    content_pairs = load_comparison_pairs()
    print(f'  Found {len(content_pairs)} comparison pairs with content')

    all_pairs = set()
    abbrs = [r['abbr'] for r in rubbers]
    for a, b in combinations(abbrs, 2):
        pair = tuple(sorted([a, b]))
        all_pairs.add(pair)
    print(f'  Total rubber pair combinations: {len(all_pairs)}')

    print('Generating slug map...')
    slug_map = generate_slug_map(rubbers)
    slug_map_path = ROOT / 'js' / 'slug-map.json'
    write_file(slug_map_path, json.dumps(slug_map, indent=2, ensure_ascii=False))
    print(f'  Written to {slug_map_path}')

    template = read_template()
    # Each entry: (url_path, priority, alternates_dict)
    # ``alternates_dict`` maps country code → full URL for hreflang sitemap alternates.
    all_pages = []
    page_count = 0

    # ── Root redirect ──
    print('Generating root redirect...')
    redirect_html = '''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="refresh" content="0;url=/en/">
    <link rel="canonical" href="https://pingponglab.com/en/">
    <title>Redirecting to PingPongLab</title>
</head>
<body>
    <p>Redirecting to <a href="/en/">PingPongLab</a>...</p>
</body>
</html>'''
    # Save as root-redirect.html (won't overwrite the template index.html)
    write_file(ROOT / 'root-redirect.html', redirect_html)
    page_count += 1

    # ── 404 page ──
    print('Generating 404 page...')
    page_404 = make_page(
        template,
        title='Page Not Found | PingPongLab',
        description='The page you are looking for could not be found.',
        canonical=f'{BASE_URL}/',
        country='en',
        alternates={c: f'{BASE_URL}/{c}/' for c in COUNTRIES},
    )
    write_file(ROOT / '404.html', page_404)
    page_count += 1

    # ── Country homepages ──
    print('Generating country homepages...')
    homepage_alternates = {c: f'{BASE_URL}/{c}/' for c in COUNTRIES}
    for country in COUNTRIES:
        title = COUNTRY_TITLES.get(country, COUNTRY_TITLES['en'])
        desc = COUNTRY_DESCRIPTIONS.get(country, COUNTRY_DESCRIPTIONS['en'])
        canonical = f'{BASE_URL}/{country}/'
        home_breadcrumb = breadcrumb_jsonld([(BREADCRUMB_HOME[country], None)])
        page = make_page(
            template,
            title=title,
            description=desc,
            canonical=canonical,
            country=country,
            alternates=homepage_alternates,
            jsonld_blocks=[home_breadcrumb],
        )
        write_file(ROOT / country / 'index.html', page)
        all_pages.append((f'/{country}/', '1.0', homepage_alternates))
        page_count += 1
    print(f'  Generated {len(COUNTRIES)} country homepages')

    # ── Rubber detail pages ──
    print('Generating rubber detail pages...')
    rubber_count = 0
    abbr_to_rubber = {r['abbr']: r for r in rubbers}
    for r in rubbers:
        slug = slug_map['abbrToSlug'][r['abbr']]
        allowed = countries_for_rubber(r)
        alternates = {
            c: f'{BASE_URL}/{c}/rubbers/{slug}' for c in allowed
        }
        brand = r.get('manufacturer') or r.get('brand')
        for country in allowed:
            name = localized_name(r, country)
            title = RUBBER_TITLE[country].format(name=name, brand=brand)
            desc = RUBBER_DESC[country].format(name=name, brand=brand)
            heading = RUBBER_H1[country].format(name=name)
            canonical = f'{BASE_URL}/{country}/rubbers/{slug}'
            crumbs = breadcrumb_jsonld([
                (BREADCRUMB_HOME[country], f'{BASE_URL}/{country}/'),
                (BREADCRUMB_RUBBERS[country], f'{BASE_URL}/{country}/'),
                (name, None),
            ])
            product = product_jsonld(r, country, canonical)
            page = make_page(
                template,
                title=title,
                description=desc,
                canonical=canonical,
                country=country,
                alternates=alternates,
                heading=heading,
                jsonld_blocks=[product, crumbs],
            )
            write_file(ROOT / country / 'rubbers' / slug / 'index.html', page)
            all_pages.append((f'/{country}/rubbers/{slug}', '0.8', alternates))
            rubber_count += 1
    print(f'  Generated {rubber_count} rubber detail pages')

    # ── Comparison pages ──
    print('Generating comparison pages...')
    comp_count = 0
    for name_a, name_b in sorted(all_pairs):
        slug_a = slug_map['abbrToSlug'].get(name_a)
        slug_b = slug_map['abbrToSlug'].get(name_b)
        if not slug_a or not slug_b:
            print(f'  WARNING: Skipping comparison {name_a} vs {name_b} — slug not found')
            continue
        sorted_slugs = sorted([slug_a, slug_b])
        comp_slug = f'{sorted_slugs[0]}-vs-{sorted_slugs[1]}'
        ra = abbr_to_rubber.get(name_a)
        rb = abbr_to_rubber.get(name_b)
        if not ra or not rb:
            print(f'  WARNING: Skipping comparison {name_a} vs {name_b} — rubber data missing')
            continue
        pair_countries = countries_for_pair(ra, rb)
        alternates = {
            c: f'{BASE_URL}/{c}/rubbers/compare/{comp_slug}'
            for c in pair_countries
        }
        for country in pair_countries:
            local_a = localized_name(ra, country)
            local_b = localized_name(rb, country)
            title = COMPARE_TITLE[country].format(a=local_a, b=local_b)
            desc = COMPARE_DESC[country](local_a, local_b)
            heading = COMPARE_H1[country].format(a=local_a, b=local_b)
            canonical = f'{BASE_URL}/{country}/rubbers/compare/{comp_slug}'
            crumbs = breadcrumb_jsonld([
                (BREADCRUMB_HOME[country], f'{BASE_URL}/{country}/'),
                (BREADCRUMB_RUBBERS[country], f'{BASE_URL}/{country}/'),
                (f'{local_a} vs {local_b}', None),
            ])
            page = make_page(
                template,
                title=title,
                description=desc,
                canonical=canonical,
                country=country,
                alternates=alternates,
                heading=heading,
                jsonld_blocks=[crumbs],
            )
            write_file(ROOT / country / 'rubbers' / 'compare' / comp_slug / 'index.html', page)
            all_pages.append((f'/{country}/rubbers/compare/{comp_slug}', '0.6', alternates))
            comp_count += 1
    print(f'  Generated {comp_count} comparison pages')

    # ── SEO landing pages ──
    print('Generating SEO landing pages...')
    seo_pages = load_seo_pages()
    seo_count = 0
    # Accept either full name or abbreviation in seo-pages.json. Abbreviation
    # lookup matches the convention used by bestseller.json / URL `rubbers=` param.
    name_to_abbr = {r['name']: r['abbr'] for r in rubbers}
    abbr_set = {r['abbr'] for r in rubbers}

    # Build group → { country: slug } map so the client can redirect the
    # language selector between equivalent pages (e.g. en top-10 → ko top-10).
    group_translations = {}
    for page in seo_pages:
        group = page.get('group')
        slug = page.get('slug')
        if not group or not slug:
            continue
        for country in (page.get('locales') or list(COUNTRIES)):
            if country not in COUNTRIES:
                continue
            group_translations.setdefault(group, {})[country] = slug

    for page in seo_pages:
        slug = page.get('slug')
        if not slug:
            print('  WARNING: Skipping SEO page with no slug')
            continue
        locales = page.get('locales') or list(COUNTRIES)
        rubber_refs = page.get('rubbers') or []

        def _resolve(ref):
            if ref in abbr_set:
                return ref
            if ref in name_to_abbr:
                return name_to_abbr[ref]
            return None

        rubber_abbrs = []
        missing = []
        for ref in rubber_refs:
            abbr = _resolve(ref)
            if abbr is None:
                missing.append(ref)
            else:
                rubber_abbrs.append(abbr)
        if missing:
            print(f"  WARNING: SEO page '{slug}' references unknown rubbers: {missing}")

        titles = page.get('title') or {}
        descriptions = page.get('description') or {}

        # Build an alternates map spanning the whole translation group. This
        # lets each locale's landing page advertise equivalents via hreflang.
        group = page.get('group')
        group_alternates = {}
        if group and group in group_translations:
            group_alternates = {
                c: f'{BASE_URL}/{c}/{s}'
                for c, s in group_translations[group].items()
                if c in COUNTRIES
            }

        for country in locales:
            if country not in COUNTRIES:
                continue
            title = titles.get(country) or titles.get('en') or COUNTRY_TITLES[country]
            desc = descriptions.get(country) or descriptions.get('en') or COUNTRY_DESCRIPTIONS[country]
            canonical = f'{BASE_URL}/{country}/{slug}'
            # Fall back to a single-locale alternates map when no group is defined.
            alternates = group_alternates or {country: canonical}
            # Strip " | PingPongLab" (or similar brand suffix) for the visible heading
            heading = re.sub(r'\s*[|\-–—]\s*PingPongLab\s*$', '', title).strip() or title
            crumbs = breadcrumb_jsonld([
                (BREADCRUMB_HOME[country], f'{BASE_URL}/{country}/'),
                (heading, None),
            ])
            page_html = make_page(
                template,
                title=title,
                description=desc,
                canonical=canonical,
                country=country,
                alternates=alternates,
                heading=heading,
                jsonld_blocks=[crumbs],
            )
            seo_data = {
                'slug': slug,
                'country': country,
                'title': title,
                'rubbers': rubber_abbrs,
                'heading': heading,
            }
            if group_alternates:
                # Include every locale in the group (including the current one)
                # so the JS layer has a single source of truth.
                seo_data['translations'] = group_translations[group]
            page_html = inject_seo_preset(page_html, seo_data, heading=heading)
            write_file(ROOT / country / slug / 'index.html', page_html)
            all_pages.append((f'/{country}/{slug}', '0.9', alternates))
            seo_count += 1
    print(f'  Generated {seo_count} SEO landing pages')

    # ── Sitemap ──
    print('Generating sitemap.xml...')
    sitemap_entries = []
    for url_path, priority, alternates in all_pages:
        lines = [
            '  <url>',
            f'    <loc>{BASE_URL}{url_path}</loc>',
            f'    <lastmod>{TODAY}</lastmod>',
            f'    <priority>{priority}</priority>',
        ]
        if alternates:
            for code in COUNTRIES:
                if code in alternates:
                    lines.append(
                        f'    <xhtml:link rel="alternate" '
                        f'hreflang="{HREFLANG_CODES[code]}" '
                        f'href="{esc(alternates[code])}"/>'
                    )
            default_url = alternates.get('en') or next(iter(alternates.values()), None)
            if default_url:
                lines.append(
                    f'    <xhtml:link rel="alternate" '
                    f'hreflang="x-default" '
                    f'href="{esc(default_url)}"/>'
                )
        lines.append('  </url>')
        sitemap_entries.append('\n'.join(lines))

    sitemap = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n'
        '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
        + '\n'.join(sitemap_entries) + '\n'
        '</urlset>\n'
    )
    write_file(ROOT / 'sitemap.xml', sitemap)
    print(f'  {len(all_pages)} URLs in sitemap')

    page_count += rubber_count + comp_count + seo_count
    print(f'\nDone! Generated {page_count} total pages.')


if __name__ == '__main__':
    main()
