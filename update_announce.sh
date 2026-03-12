#!/bin/bash
# Usage: ./update_announce.sh "Your announcement message"

if [ -z "$1" ]; then
  echo "Usage: ./update_announce.sh \"Your announcement message\""
  exit 1
fi

DATE=$(date +%Y-%m-%d)
MESSAGE="$1 ($DATE)"
FILE="$(dirname "$0")/index.html"

sed -i '' "s|<div class=\"announcement\" id=\"announcement\">.*</div>|<div class=\"announcement\" id=\"announcement\">${MESSAGE}</div>|" "$FILE"

echo "Announcement updated: $MESSAGE"
