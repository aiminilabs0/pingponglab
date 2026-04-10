#!/usr/bin/env bash
set -euo pipefail

# Modify!!!!
current_rubber="Omega 7 Guang"

# Resolve paths relative to this script so it works from any cwd.
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../../.." && pwd)"
output_root="$repo_root/rubbers_comparison"

resolve_rubber_abbr() {
  local rubber_name="$1"

  REPO_ROOT="$repo_root" RUBBER_NAME="$rubber_name" python3 - <<'PY'
import json
import os
import sys
from pathlib import Path

repo_root = Path(os.environ["REPO_ROOT"])
rubber_name = os.environ["RUBBER_NAME"].strip()

for json_file in sorted((repo_root / "rubbers").glob("*/*.json")):
    with json_file.open(encoding="utf-8") as fh:
        data = json.load(fh)

    if data.get("abbr") == rubber_name or data.get("name") == rubber_name:
        print(data["abbr"])
        sys.exit(0)

print(f"Error: could not resolve rubber abbreviation for '{rubber_name}'", file=sys.stderr)
sys.exit(1)
PY
}

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <parameter>"
  echo "Example: $0 \"BlueGrip J1\""
  exit 1
fi

parameter="$1"
parameter="${parameter%"${parameter##*[![:space:]]}"}"

if [[ -z "${parameter//[[:space:]]/}" ]]; then
  echo "Error: parameter is empty"
  exit 1
fi

current_rubber_abbr="$(resolve_rubber_abbr "$current_rubber")"
parameter_abbr="$(resolve_rubber_abbr "$parameter")"

src_en="$script_dir/0. english_desc"
src_ko="$script_dir/1. korean_desc"
src_cn="$script_dir/2. chinese_desc"

for source_file in "$src_en" "$src_ko" "$src_cn"; do
  if [[ ! -f "$source_file" ]]; then
    echo "Error: '$source_file' not found"
    exit 1
  fi
done

dest_en="$output_root/en/$parameter_abbr/$current_rubber_abbr"
dest_ko="$output_root/ko/$parameter_abbr/$current_rubber_abbr"
dest_cn="$output_root/cn/$parameter_abbr/$current_rubber_abbr"

mkdir -p "$(dirname -- "$dest_en")" "$(dirname -- "$dest_ko")" "$(dirname -- "$dest_cn")"

cp "$src_en" "$dest_en"
cp "$src_ko" "$dest_ko"
cp "$src_cn" "$dest_cn"

echo "Copied files:"
echo "  - $src_en -> $dest_en"
echo "  - $src_ko -> $dest_ko"
echo "  - $src_cn -> $dest_cn"