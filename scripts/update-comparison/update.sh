#!/usr/bin/env bash
set -euo pipefail

# Resolve paths relative to this script so it works from any cwd.
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../.." && pwd)"
param_file="$script_dir/0_rubber2"
combined_file="$script_dir/1_llm_output"

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

# TODO:: Modify!!!!!!
base_rubber="BlueGrip J1"

# Read each language source file and write to the matching directory
mkdir -p \
  "$repo_root/rubbers_comparison/en/${base_rubber}" \
  "$repo_root/rubbers_comparison/ko/${base_rubber}" \
  "$repo_root/rubbers_comparison/cn/${base_rubber}"

sanitize_and_write() {
  local source_file="$1"
  local output_file="$2"

  perl -ne 'print unless /^\s*-\s*:contentReference\[oaicite:\d+\]\{index=\d+\}\s*$/' "$source_file" \
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

sanitize_and_write "$en_tmp" "$repo_root/rubbers_comparison/en/${base_rubber}/${param}"
sanitize_and_write "$ko_tmp" "$repo_root/rubbers_comparison/ko/${base_rubber}/${param}"
sanitize_and_write "$cn_tmp" "$repo_root/rubbers_comparison/cn/${base_rubber}/${param}"

echo "Recently updated files:"
echo "  - $repo_root/rubbers_comparison/en/${base_rubber}/${param}"
echo "  - $repo_root/rubbers_comparison/ko/${base_rubber}/${param}"
echo "  - $repo_root/rubbers_comparison/cn/${base_rubber}/${param}"
