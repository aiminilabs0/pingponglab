#!/usr/bin/env bash
set -euo pipefail

# TODO:: Modify!!!!!!
# Comparison text is written under rubbers_comparison/<lang>/<rubber2>/<this rubber>.
# compare-all-existing-rubbers uses <rubber1>/<rubber2>; this script reverses that order
# because the popular flow fills the comparison into the other rubber's directory tree.
current_rubber="Omega 8 Pro"

# Resolve paths relative to this script so it works from any cwd.
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../../.." && pwd)"
output_root="$repo_root/rubbers_comparison"
param_file="$script_dir/0_rubber2"
combined_file="$script_dir/1_llm_output"

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

if [[ ! -f "$param_file" ]]; then
  echo "Error: '$param_file' not found"
  exit 1
fi

if [[ ! -f "$combined_file" ]]; then
  echo "Error: '$combined_file' not found"
  exit 1
fi

# Read parameter from 0_rubber2 (trim trailing newlines/whitespace)
param="$(<"$param_file")"
param="${param%"${param##*[![:space:]]}"}"

if [[ -z "${param//[[:space:]]/}" ]]; then
  echo "Error: '$param_file' is empty"
  exit 1
fi

param_abbr="$(resolve_rubber_abbr "$param")"
current_rubber_abbr="$(resolve_rubber_abbr "$current_rubber")"

# Require existing comparison dirs (rubber2 first); do not create them here.
for lang in en ko cn; do
  dest_dir="$output_root/$lang/${param_abbr}"
  if [[ ! -d "$dest_dir" ]]; then
    echo "Error: directory does not exist: $dest_dir"
    exit 1
  fi
done

sanitize_and_write() {
  local source_file="$1"
  local output_file="$2"

  perl -ne 'print unless /^\s*-\s*:contentReference\[oaicite:\d+\]\{index=\d+\}\s*$/' "$source_file" \
    | tr -d '\r' \
    | perl -pe 's/[[:space:]]*:contentReference\[oaicite:\d+\]\{index=\d+\}//g' \
    | sed -E 's/[[:space:]]+$//' \
    > "$output_file"
}

extract_markdown_block() {
  local source_file="$1"
  local block_index="$2"
  local output_file="$3"

  awk -v target="$block_index" '
    /^```/ {
      if (!in_block) {
        in_block = 1
        block_count++
        next
      }
      if (in_block) {
        if (block_count == target) {
          exit
        }
        in_block = 0
        next
      }
    }
    in_block && block_count == target { print }
  ' "$source_file" > "$output_file"
}

en_tmp="$(mktemp)"
ko_tmp="$(mktemp)"
cn_tmp="$(mktemp)"
trap 'rm -f "$en_tmp" "$ko_tmp" "$cn_tmp"' EXIT

extract_markdown_block "$combined_file" 1 "$en_tmp"
extract_markdown_block "$combined_file" 2 "$ko_tmp"
extract_markdown_block "$combined_file" 3 "$cn_tmp"

if [[ ! -s "$en_tmp" || ! -s "$ko_tmp" || ! -s "$cn_tmp" ]]; then
  echo "Error: '$combined_file' must contain 3 fenced markdown blocks (en, ko, cn)."
  exit 1
fi

sanitize_and_write "$en_tmp" "$output_root/en/${param_abbr}/${current_rubber_abbr}"
sanitize_and_write "$ko_tmp" "$output_root/ko/${param_abbr}/${current_rubber_abbr}"
sanitize_and_write "$cn_tmp" "$output_root/cn/${param_abbr}/${current_rubber_abbr}"

echo "Recently updated files:"
echo "  - $output_root/en/${param_abbr}/${current_rubber_abbr}"
echo "  - $output_root/ko/${param_abbr}/${current_rubber_abbr}"
echo "  - $output_root/cn/${param_abbr}/${current_rubber_abbr}"
