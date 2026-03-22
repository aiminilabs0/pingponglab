#!/bin/bash
# Usage: ./update_announce.sh "Your announcement message"
#        ./update_announce.sh              # clears announcement

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "$1" ]; then
  MODE="clear"
  export MESSAGE=""
else
  MODE="set"
  DATE=$(date +%Y-%m-%d)
  export MESSAGE="$1 ($DATE)"
fi

RESULT=$(
python3 - "$ROOT_DIR" "$MODE" <<'PY'
import os
import re
import sys
from pathlib import Path

root_dir = Path(sys.argv[1])
mode = sys.argv[2]
message = os.environ["MESSAGE"]

announce_pattern = re.compile(r'<div class="announcement" id="announcement"[^>]*>[^<]*</div>')
fade_script = "\n        <script>setTimeout(()=>{const a=document.getElementById('announcement');a.classList.add('fade-out');a.addEventListener('transitionend',()=>a.remove())},5000);</script>"

if mode == "set":
    new_announce = f'<div class="announcement" id="announcement">{message}</div>'
else:
    new_announce = '<div class="announcement" id="announcement" hidden></div>'

matched_files = 0
updated_files = 0

for html_file in root_dir.rglob("*.html"):
    content = html_file.read_text(encoding="utf-8")
    updated_content, replacements = announce_pattern.subn(new_announce, content, count=1)
    if replacements > 0:
        matched_files += 1
        # Remove existing fade-out script if present
        updated_content = updated_content.replace(fade_script, "")
        # Re-add script only when setting a message
        if mode == "set":
            updated_content = updated_content.replace(
                new_announce,
                new_announce + fade_script
            )
        if updated_content != content:
            html_file.write_text(updated_content, encoding="utf-8")
            updated_files += 1

print(f"{updated_files}|{matched_files}")
PY
)

UPDATED_FILES="${RESULT%%|*}"
MATCHED_FILES="${RESULT##*|}"

if [ "$MODE" = "clear" ]; then
  echo "Announcement cleared"
else
  echo "Announcement updated: $MESSAGE"
fi
echo "Files updated: $UPDATED_FILES (matched: $MATCHED_FILES)"
