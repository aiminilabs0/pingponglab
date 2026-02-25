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

fname="Dignics 09C_${param}"

# Read each language source file and write to the matching directory
cat "1_english"  > "../../rubbers_comparison/en/${fname}"
cat "2_한국어"   > "../../rubbers_comparison/ko/${fname}"
cat "3_중국어"   > "../../rubbers_comparison/cn/${fname}"