#!/usr/bin/env bash
set -euo pipefail

# Bump the cache-busting version number in index.html and js/config.js.
# Usage:  ./scripts/bump-version.sh          (increments by 1)
#         ./scripts/bump-version.sh 42       (sets to 42)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HTML="$ROOT/index.html"
CONFIGJS="$ROOT/js/config.js"

current=$(sed -n 's/^const CACHE_VERSION = \([0-9]*\);.*/\1/p' "$CONFIGJS")
if [ -z "$current" ]; then
  echo "ERROR: could not read CACHE_VERSION from $CONFIGJS" >&2
  exit 1
fi

if [ -n "${1:-}" ]; then
  next="$1"
else
  next=$((current + 1))
fi

echo "Bumping version: $current → $next"

sed -i '' "s/\?v=$current/\?v=$next/g"   "$HTML"
sed -i '' "s/CACHE_VERSION = $current/CACHE_VERSION = $next/" "$CONFIGJS"

echo "Done. Updated files:"
echo "  $HTML"
echo "  $CONFIGJS"
