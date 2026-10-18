#!/bin/bash
# Deterministic checks for every long-list name. Findings of fact, outside the jury.
# Output TSV: name, npm (free|taken), top GitHub repo with that exact name (stars), length, prefix-safe.
# GitHub search allows 30 requests a minute, hence the pause.
set -u
list="$1"
printf 'name\tnpm\tgithub_exact_top\tstars\tlen\tprefix_ok\n'
grep -v '^#' "$list" | cut -f1 | while read -r name; do
  [ -z "$name" ] && continue
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://registry.npmjs.org/$name")
  case "$code" in 404) npm=free ;; 200) npm=taken ;; *) npm="http-$code" ;; esac
  top=$(gh api -X GET search/repositories -f q="$name in:name" -f sort=stars -f per_page=10 \
        --jq "[.items[] | select((.name|ascii_downcase) == \"$name\")][0] | if . == null then \"none\t0\" else \"\(.full_name)\t\(.stargazers_count)\" end" 2>/dev/null || printf 'error\t-')
  len=${#name}
  if printf '%s' "$name" | grep -qE '^[a-z]{3,16}$'; then ok=yes; else ok=no; fi
  printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$npm" "$top" "$len" "$ok"
  sleep 2.2
done
