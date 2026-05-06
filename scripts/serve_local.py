#!/usr/bin/env python3
"""Local dev server that mimics GitHub Pages.

Differences from `python3 -m http.server`:
- Falls back to `404.html` (with the original URL preserved) for missing paths,
  so the in-page redirect script in `404.html` (e.g. /us → /en, /kr → /ko) runs
  locally exactly like it does on GitHub Pages.

Usage:
    PORT=8000 python3 scripts/serve_local.py
"""

import http.server
import os
import socketserver
import sys
from pathlib import Path

PORT = int(os.environ.get('PORT', '4000'))
ROOT = Path(__file__).resolve().parent.parent
NOT_FOUND_PAGE = ROOT / '404.html'


class GitHubPagesHandler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler that falls back to /404.html for missing paths."""

    def send_head(self):
        path = self.translate_path(self.path)
        # If the path doesn't exist (and isn't a directory with index.html),
        # serve 404.html so the in-page redirect script can take over.
        if not os.path.exists(path) and NOT_FOUND_PAGE.is_file():
            try:
                f = open(NOT_FOUND_PAGE, 'rb')
            except OSError:
                return super().send_head()
            fs = os.fstat(f.fileno())
            self.send_response(404)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(fs.st_size))
            self.end_headers()
            return f
        return super().send_head()


def main():
    os.chdir(ROOT)
    with socketserver.TCPServer(('', PORT), GitHubPagesHandler) as httpd:
        print(f'Serving on http://localhost:{PORT} (404.html fallback enabled)')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print()
            sys.exit(0)


if __name__ == '__main__':
    main()
