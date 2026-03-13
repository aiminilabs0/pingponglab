#!/bin/bash
# Usage: ./update_announce.sh "Your announcement message"

if [ -z "$1" ]; then
  echo "Usage: ./update_announce.sh \"Your announcement message\""
  exit 1
fi

DATE=$(date +%Y-%m-%d)
MESSAGE="$1 ($DATE)"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

export MESSAGE
RESULT=$(
python3 - "$ROOT_DIR" <<'PY'
import os
import re
import sys
from pathlib import Path

root_dir = Path(sys.argv[1])
message = os.environ["MESSAGE"]
replacement = f'<div class="announcement" id="announcement">{message}</div>'
pattern = re.compile(r'<div class="announcement" id="announcement">.*?</div>')

matched_files = 0
updated_files = 0

for html_file in root_dir.rglob("*.html"):
    content = html_file.read_text(encoding="utf-8")
    updated_content, replacements = pattern.subn(replacement, content, count=1)
    if replacements > 0:
        matched_files += 1
        if updated_content != content:
            html_file.write_text(updated_content, encoding="utf-8")
            updated_files += 1

print(f"{updated_files}|{matched_files}")
PY
)

UPDATED_FILES="${RESULT%%|*}"
MATCHED_FILES="${RESULT##*|}"

echo "Announcement updated: $MESSAGE"
echo "Files updated: $UPDATED_FILES (matched: $MATCHED_FILES)"
