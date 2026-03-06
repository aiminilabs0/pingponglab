#!/usr/bin/env bash
set -euo pipefail

# Resolve paths relative to this script so it works from any cwd.
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../.." && pwd)"
param_file="$script_dir/0_rubber"

if [[ ! -f "$param_file" ]]; then
  echo "Error: '$param_file' not found"
  exit 1
fi

# Read parameter from 0_rubber (trim trailing newlines/whitespace)
param="$(<"$param_file")"
param="${param%"${param##*[![:space:]]}"}"

if [[ -z "${param//[[:space:]]/}" ]]; then
  echo "Error: '$param_file' is empty"
  exit 1
fi

# TODO:: Modify!!!!!!
base_rubber="Zyre 03"

# Read each language source file and write to the matching directory
mkdir -p \
  "$repo_root/rubbers_comparison/en/${base_rubber}" \
  "$repo_root/rubbers_comparison/ko/${base_rubber}" \
  "$repo_root/rubbers_comparison/cn/${base_rubber}"

cat "$script_dir/1_english" > "$repo_root/rubbers_comparison/en/${base_rubber}/${param}"
cat "$script_dir/2_한국어"  > "$repo_root/rubbers_comparison/ko/${base_rubber}/${param}"
cat "$script_dir/3_중국어"  > "$repo_root/rubbers_comparison/cn/${base_rubber}/${param}"