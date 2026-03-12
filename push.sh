#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Error: expected exactly 1 parameter." >&2
  echo "Usage: $0 <commit_message>" >&2
  exit 1
fi

commit_name="$1"

./scripts/bump_version.sh

git add index.html
git add js/config.js
git commit -m "$commit_name"
git push origin main
