#!/usr/bin/env bash
# update_price.sh
# Fetches prices from megaspin.net and updates price.en/ko/cn in rubber JSON files.
# Usage: ./script/update_price.sh [optional/path/to/rubber.json ...]
#   No args → processes all rubbers/**/*.json with a megaspin en.product URL.
#   With args → processes only the given files.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUBBERS_DIR="$SCRIPT_DIR/../rubbers"

FILES=()
if [[ $# -gt 0 ]]; then
    FILES=("$@")
else
    while IFS= read -r line; do FILES+=("$line"); done < <(find "$RUBBERS_DIR" -name "*.json" | sort)
fi

python3 - "${FILES[@]}" <<'PYEOF'
import sys, json, re, urllib.request, os, time

files = sys.argv[1:]

def fetch_page(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", errors="replace")

def parse_price(html):
    # Current price from schema.org meta — most reliable
    price_m = re.search(r'<meta\s+itemprop="price"\s+content="([\d.]+)"', html)
    if not price_m:
        return None
    current = float(price_m.group(1))

    # Regular (list) price: <div><s><span style="font-size: 15px;">$51.95</span></s></div>
    list_m = re.search(r'<div><s><span[^>]*>\s*\$([\d.]+)\s*</span></s></div>', html)

    # Discount line: <div>Save $12.00 (23%)</div>
    disc_m = re.search(r'Save\s+\$[\d.,]+\s+\((\d+)%\)', html)

    if list_m and disc_m:
        regular = float(list_m.group(1))
        discount = "-" + disc_m.group(1) + "%"
        if regular > current:
            return {"regular": f"${regular:.2f}", "sale": f"${current:.2f}", "discount": discount}

    # No sale — just a regular price, no badge
    return {"regular": f"${current:.2f}", "sale": "", "discount": ""}

updated = 0
skipped = 0

for path in files:
    with open(path) as f:
        data = json.load(f)

    url = (data.get("urls") or {}).get("en", {}).get("product", "")
    if "megaspin.net" not in url:
        skipped += 1
        continue

    name = data.get("name", os.path.basename(path))
    print(f"  {name} ... ", end="", flush=True)

    try:
        html = fetch_page(url)
        entry = parse_price(html)
        if entry is None:
            print("price not found, skipping")
            skipped += 1
            continue
    except Exception as e:
        print(f"error: {e}")
        skipped += 1
        continue

    data["price"] = {"en": entry, "ko": entry, "cn": entry}

    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")

    if entry["sale"]:
        print(f"regular {entry['regular']}  sale {entry['sale']}  ({entry['discount']})")
    else:
        print(entry["regular"])

    updated += 1
    time.sleep(0.3)   # be polite to megaspin

print(f"\nDone: {updated} updated, {skipped} skipped (no megaspin URL).")
PYEOF
