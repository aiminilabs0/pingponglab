#!/usr/bin/env python3
"""
Generate static HTML pages for PingPongLab clean URLs.

Reads rubber data and comparison files, then generates:
- js/slug-map.json (bidirectional abbr <-> slug mapping)
- Root index.html (redirect to /en/)
- Language homepages (/en/, /ko/, /cn/)
- Rubber detail pages (~86 per language)
- Comparison pages (all rubber pair combinations)
- sitemap.xml
- 404.html
"""

import json
import os
import re
import sys
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANGS = ['en', 'ko', 'cn']
BASE_URL = 'https://pingponglab.com'

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
        rubbers.append({'brand': brand, 'abbr': abbr, 'name': name, 'file': filepath})
    return rubbers


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


def make_page(template, title, description, canonical, og_title=None, og_description=None):
    """Create a page from template with custom meta tags."""
    html = template

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

    return html


def esc(text):
    """Escape for HTML attribute values."""
    return (text
            .replace('&', '&amp;')
            .replace('"', '&quot;')
            .replace('<', '&lt;')
            .replace('>', '&gt;'))


def write_file(path, content):
    """Write content to file, creating directories as needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w') as f:
        f.write(content)


# ── Language names ──

LANG_NAMES = {
    'en': 'English',
    'ko': 'Korean',
    'cn': 'Chinese'
}

LANG_TITLES = {
    'en': 'PingPongLab | Best Ping Pong Rubber',
    'ko': 'PingPongLab | 탁구 러버 비교',
    'cn': 'PingPongLab | 乒乓球胶皮对比'
}

LANG_DESCRIPTIONS = {
    'en': 'Compare ping pong rubbers by speed, spin, control, hardness, and weight. Find the best rubber for your style.',
    'ko': '탁구 러버를 스피드, 스핀, 컨트롤, 경도, 무게로 비교하세요. 나에게 맞는 최고의 러버를 찾아보세요.',
    'cn': '按速度、旋转、控制、硬度和重量对比乒乓球胶皮。找到最适合你打法的胶皮。'
}


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
    all_pages = []  # (url_path, priority) for sitemap
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
        canonical=f'{BASE_URL}/'
    )
    write_file(ROOT / '404.html', page_404)
    page_count += 1

    # ── Language homepages ──
    print('Generating language homepages...')
    for lang in LANGS:
        title = LANG_TITLES.get(lang, LANG_TITLES['en'])
        desc = LANG_DESCRIPTIONS.get(lang, LANG_DESCRIPTIONS['en'])
        canonical = f'{BASE_URL}/{lang}/'
        page = make_page(template, title=title, description=desc, canonical=canonical)
        write_file(ROOT / lang / 'index.html', page)
        all_pages.append((f'/{lang}/', '1.0'))
        page_count += 1
    print(f'  Generated {len(LANGS)} language homepages')

    # ── Rubber detail pages ──
    print('Generating rubber detail pages...')
    rubber_count = 0
    for r in rubbers:
        slug = slug_map['abbrToSlug'][r['abbr']]
        for lang in LANGS:
            title = f"{r['abbr']} Review | PingPongLab"
            desc = f"Detailed review of {r['abbr']} by {r['brand']}. Compare speed, spin, control, hardness, and weight."
            canonical = f'{BASE_URL}/{lang}/rubbers/{slug}'
            page = make_page(template, title=title, description=desc, canonical=canonical)
            write_file(ROOT / lang / 'rubbers' / slug / 'index.html', page)
            all_pages.append((f'/{lang}/rubbers/{slug}', '0.8'))
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
        for lang in LANGS:
            title = f"{name_a} vs {name_b} | PingPongLab"
            desc = f"Compare {name_a} and {name_b}: speed, spin, control, hardness, and weight side by side."
            canonical = f'{BASE_URL}/{lang}/rubbers/compare/{comp_slug}'
            page = make_page(template, title=title, description=desc, canonical=canonical)
            write_file(ROOT / lang / 'rubbers' / 'compare' / comp_slug / 'index.html', page)
            all_pages.append((f'/{lang}/rubbers/compare/{comp_slug}', '0.6'))
            comp_count += 1
    print(f'  Generated {comp_count} comparison pages')

    # ── Sitemap ──
    print('Generating sitemap.xml...')
    sitemap_entries = []
    for url_path, priority in all_pages:
        sitemap_entries.append(
            f'  <url>\n'
            f'    <loc>{BASE_URL}{url_path}</loc>\n'
            f'    <priority>{priority}</priority>\n'
            f'  </url>'
        )
    sitemap = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + '\n'.join(sitemap_entries) + '\n'
        '</urlset>\n'
    )
    write_file(ROOT / 'sitemap.xml', sitemap)
    print(f'  {len(all_pages)} URLs in sitemap')

    page_count += rubber_count + comp_count
    print(f'\nDone! Generated {page_count} total pages.')


if __name__ == '__main__':
    main()
