#!/usr/bin/env bash
# update_price.sh
# Fetches prices from megaspin.net and updates price.en/cn in rubber JSON files (ko unchanged).
# Usage: ./script/update_price.sh [--with-aid|--strip-aid] <path/to/rubber.json ...>
#   No args → print this usage message.
#   With file args → processes only the given files.
#   --with-aid → call megaspin with the original URL, including `aid`.
#   --strip-aid → remove the `aid` query param before calling megaspin.

set -euo pipefail

usage() {
    cat <<'EOF'
Usage: ./script/update_price.sh [--with-aid|--strip-aid] <path/to/rubber.json ...>
  No args → print this usage message.
  With file args → processes only the given files.
  --with-aid → call megaspin with the original URL, including `aid`.
  --strip-aid → remove the `aid` query param before calling megaspin.
EOF
}
if [[ $# -eq 0 ]]; then
    usage
    exit 1
fi

REQUEST_MODE="with-aid"
FILES=()
for arg in "$@"; do
    if [[ "$arg" == "--strip-aid" ]]; then
        if [[ "$REQUEST_MODE" == "with-aid" ]]; then
            REQUEST_MODE="strip-aid"
        elif [[ "$REQUEST_MODE" != "strip-aid" ]]; then
            usage
            exit 1
        fi
    elif [[ "$arg" == "--with-aid" ]]; then
        if [[ "$REQUEST_MODE" == "strip-aid" ]]; then
            usage
            exit 1
        fi
        REQUEST_MODE="with-aid"
    else
        FILES+=("$arg")
    fi
done

if [[ ${#FILES[@]} -eq 0 ]]; then
    while IFS= read -r -d '' f; do FILES+=("$f"); done < <(find "$(dirname "$0")/../rubbers" -name "*.json" -print0)
fi

python3 - "$REQUEST_MODE" "${FILES[@]}" <<'PYEOF'
import sys, json, re, urllib.request, urllib.parse, os, time

request_mode = sys.argv[1]
strip_aid_enabled = request_mode == "strip-aid"
files = sys.argv[2:]

def fetch_page(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", errors="replace")

def strip_aid(url):
    parsed = urllib.parse.urlsplit(url)
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    query = [(key, value) for key, value in query if key != "aid"]
    return urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))

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
        fetch_url = strip_aid(url) if strip_aid_enabled else url
        html = fetch_page(fetch_url)
        entry = parse_price(html)
        if entry is None:
            print("price not found, skipping")
            skipped += 1
            continue
    except Exception as e:
        print(f"error: {e}")
        skipped += 1
        continue

    old_price = dict(data.get("price") or {})

    current_en = old_price.get("en") or {}
    if current_en and current_en != entry:
        from datetime import date
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
