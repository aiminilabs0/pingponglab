#!/usr/bin/env bash
set -euo pipefail

param_file="0_rubber"

if [[ ! -f "$param_file" ]]; then
  echo "Error: '$param_file' not found"
  exit 1
fi

# Read parameter from 0_rubber (trim trailing newlines/whitespace)
param="$(<"$param_file")"
param="${param%"${param##*[!$' \t\r\n']}" }"  # rtrim spaces/tabs/cr/lf
param="${param%"${param##*[!$'\n']}" }"       # (extra safety) rtrim newlines

if [[ -z "${param//[[:space:]]/}" ]]; then
  echo "Error: '$param_file' is empty"
  exit 1
fi

fname="Tenergy 05_${param}"

# Ensure output dirs exist
mkdir -p en ko cn

# Read each language source file and write to the matching directory
cat "1_english"  > "en/${fname}"
cat "2_한국어"   > "ko/${fname}"
cat "3_중국어"   > "cn/${fname}"