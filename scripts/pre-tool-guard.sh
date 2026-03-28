#!/usr/bin/env bash
set -euo pipefail

payload="$(cat || true)"

if [[ -z "${payload// }" ]]; then
  exit 0
fi

blocked_patterns=(
  "git reset --hard"
  "git checkout --"
  "git clean -fd"
  "git clean -xdf"
  "rm -rf /"
  "rm -fr /"
  ":(){ :|:& };:"
)

for pattern in "${blocked_patterns[@]}"; do
  if printf '%s' "$payload" | grep -Fqi "$pattern"; then
    echo "Blocked by AgentPowers pre-tool guard: detected destructive pattern '$pattern'." >&2
    exit 2
  fi
done

exit 0
