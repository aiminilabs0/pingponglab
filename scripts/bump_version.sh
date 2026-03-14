#!/usr/bin/env bash
set -euo pipefail

# Bump the cache-busting version number in HTML files and js/config.js.
# Usage:  ./scripts/bump_version.sh          (increments by 1)
#         ./scripts/bump_version.sh 42       (sets to 42)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIGJS="$ROOT/js/config.js"

current=$(sed -n 's/^const CACHE_VERSION = \([0-9]*\);.*/\1/p' "$CONFIGJS")
if [ -z "$current" ]; then
  echo "ERROR: could not read CACHE_VERSION from $CONFIGJS" >&2
  exit 1
fi

# HTML pages use the JS/CSS asset query version in script/link tags.
html_current=$(sed -n 's|.*\/js/config\.js?v=\([0-9][0-9]*\).*|\1|p' "$ROOT/index.html" | head -n 1)
if [ -z "$html_current" ]; then
  html_current="$current"
fi

if [ -n "${1:-}" ]; then
  next="$1"
else
  next=$((current + 1))
fi

echo "Bumping version: $current → $next"
echo "Updating HTML asset query version: $html_current → $next"

# Update every HTML file that still references the current version.
declare -a html_files=()
while IFS= read -r html_file; do
  html_files+=("$html_file")
done < <(rg --files-with-matches --glob '*.html' "\\?v=$html_current" "$ROOT")

if [ "${#html_files[@]}" -gt 0 ]; then
  for html_file in "${html_files[@]}"; do
    sed -i '' "s/\?v=$html_current/\?v=$next/g" "$html_file"
  done
fi

sed -i '' "s/CACHE_VERSION = $current/CACHE_VERSION = $next/" "$CONFIGJS"

echo "Done. Updated files:"
echo "  ${#html_files[@]} HTML files under $ROOT"
echo "  $CONFIGJS"
