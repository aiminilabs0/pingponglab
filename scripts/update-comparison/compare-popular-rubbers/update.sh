#!/usr/bin/env bash
set -euo pipefail

# Modify!!!!
current_rubber="Etika 51"

# Resolve paths relative to this script so it works from any cwd.
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../../.." && pwd)"
output_root="$repo_root/rubbers_comparison"

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

src_en="$script_dir/0. english_desc"
src_ko="$script_dir/1. korean_desc"
src_cn="$script_dir/2. chinese_desc"

for source_file in "$src_en" "$src_ko" "$src_cn"; do
  if [[ ! -f "$source_file" ]]; then
    echo "Error: '$source_file' not found"
    exit 1
  fi
done

dest_en="$output_root/en/$parameter/$current_rubber"
dest_ko="$output_root/ko/$parameter/$current_rubber"
dest_cn="$output_root/cn/$parameter/$current_rubber"

mkdir -p "$(dirname -- "$dest_en")" "$(dirname -- "$dest_ko")" "$(dirname -- "$dest_cn")"

cp "$src_en" "$dest_en"
cp "$src_ko" "$dest_ko"
cp "$src_cn" "$dest_cn"

echo "Copied files:"
echo "  - $src_en -> $dest_en"
echo "  - $src_ko -> $dest_ko"
echo "  - $src_cn -> $dest_cn"