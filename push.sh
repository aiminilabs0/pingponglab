#!/usr/bin/env bash
set -euo pipefail

./scripts/bump_version.sh

LAST_MODIFIED="$(date -u '+%Y-%m-%d')"
sed -i '' -E "s/^const LAST_MODIFIED = '.*';$/const LAST_MODIFIED = '${LAST_MODIFIED}';/" "js/config.js"

git add index.html
git add js/config.js
git commit -m 'ver'
git push origin main
