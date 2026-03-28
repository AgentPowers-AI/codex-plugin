#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/agentpowers-api-request.sh [METHOD] <PATH> [JSON_BODY]

Examples:
  bash scripts/agentpowers-api-request.sh /skills?limit=5
  bash scripts/agentpowers-api-request.sh GET /search?q=seo&limit=5
  bash scripts/agentpowers-api-request.sh /detail/stripe-test-skill
  bash scripts/agentpowers-api-request.sh /health

Notes:
  - Default METHOD is GET.
  - PATH values without /v1 are sent to the configured v1 API base.
  - /health targets the API root.
  - Set AGENTPOWERS_API_BASE (or PUBLIC_API_URL) to override API base.
  - Set AGENTPOWERS_API_TOKEN for authenticated requests.
EOF
}

if [[ $# -eq 0 ]]; then
  usage >&2
  exit 2
fi

method="GET"
if [[ "${1:-}" =~ ^(GET|POST|PATCH|DELETE|PUT)$ ]]; then
  method="$1"
  shift
fi

if [[ $# -lt 1 ]]; then
  usage >&2
  exit 2
fi

path="$1"
shift || true
body="${1:-}"

if [[ "$path" != /* ]]; then
  path="/$path"
fi

raw_base="${AGENTPOWERS_API_BASE:-${PUBLIC_API_URL:-https://api.agentpowers.ai/v1}}"
raw_base="${raw_base%/}"
if [[ "$raw_base" == */v1 ]]; then
  api_base="$raw_base"
else
  api_base="$raw_base/v1"
fi
api_root="${api_base%/v1}"

if [[ -z "${AGENTPOWERS_API_TOKEN:-}" && -f "$HOME/.agentpowers/auth.json" ]]; then
  AGENTPOWERS_API_TOKEN="$(python3 - <<'PY'
import json
from pathlib import Path
p = Path.home() / ".agentpowers" / "auth.json"
try:
    obj = json.loads(p.read_text())
    token = obj.get("token")
    if isinstance(token, str):
        print(token)
except Exception:
    pass
PY
)"
fi

if [[ "$path" == "/health" ]]; then
  url="$api_root/health"
elif [[ "$path" == /v1/* ]]; then
  url="$api_root$path"
else
  url="$api_base$path"
fi

tmp_body="$(mktemp)"
trap 'rm -f "$tmp_body"' EXIT

curl_args=(
  -sS
  --connect-timeout 10
  --max-time 30
  -X "$method"
  -H "Accept: application/json"
  -H "User-Agent: AgentPowers-Codex-Plugin/0.3.7"
  -o "$tmp_body"
  -w "%{http_code}"
)
if [[ -n "${AGENTPOWERS_API_TOKEN:-}" ]]; then
  curl_args+=(-H "Authorization: Bearer ${AGENTPOWERS_API_TOKEN}")
fi
if [[ -n "$body" ]]; then
  curl_args+=(-H "Content-Type: application/json" --data "$body")
fi

status="$(curl "${curl_args[@]}" "$url")"

echo "AgentPowers API request"
echo "- URL: $url"
echo "- Method: $method"
echo "- Status: $status"
echo

python3 - "$tmp_body" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
raw = path.read_text(encoding="utf-8", errors="replace")
try:
    data = json.loads(raw)
    print(json.dumps(data, indent=2))
except Exception:
    print(raw)
PY

if [[ "$status" =~ ^[45] ]]; then
  exit 1
fi
