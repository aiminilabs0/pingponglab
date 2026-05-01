#!/bin/bash
# Local dev server that mimics GitHub Pages by serving 404.html (with the URL
# preserved) for missing paths. This is required so the alias-redirect inline
# script in 404.html (e.g. /us → /en, /kr → /ko) can run locally.
exec python3 "$(dirname "$0")/scripts/serve_local.py" "$@"
