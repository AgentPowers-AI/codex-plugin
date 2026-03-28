#!/usr/bin/env bash
set -euo pipefail

format="text"
strict=0

usage() {
  cat <<'EOF'
Usage: bash scripts/agentpowers-marketplace-context.sh [--compact|--json] [--strict]

Options:
  --compact   Print one-line summary (good for hooks).
  --json      Print JSON summary.
  --strict    Exit non-zero when required API signals are unavailable.
  -h, --help  Show this help message.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --compact) format="compact" ;;
    --json) format="json" ;;
    --strict) strict=1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

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

curl_args=(
  -sS
  --connect-timeout 10
  --max-time 20
  -H "Accept: application/json"
  -H "User-Agent: AgentPowers-Codex-Plugin/0.3.7"
)
if [[ -n "${AGENTPOWERS_API_TOKEN:-}" ]]; then
  curl_args+=(-H "Authorization: Bearer ${AGENTPOWERS_API_TOKEN}")
fi

fetch_json() {
  local url="$1"
  curl "${curl_args[@]}" "$url" 2>/dev/null || true
}

health_json="$(fetch_json "$api_root/health")"
skills_json="$(fetch_json "$api_base/skills?limit=1")"
categories_json="$(fetch_json "$api_base/categories")"
sellers_json="$(fetch_json "$api_base/sellers?limit=1")"
auth_json="$(fetch_json "$api_base/auth/me")"

python3 - "$format" "$strict" "$api_base" "$health_json" "$skills_json" "$categories_json" "$sellers_json" "$auth_json" <<'PY'
import json
import sys

fmt = sys.argv[1]
strict = bool(int(sys.argv[2]))
api_base = sys.argv[3]
health_raw = sys.argv[4]
skills_raw = sys.argv[5]
categories_raw = sys.argv[6]
sellers_raw = sys.argv[7]
auth_raw = sys.argv[8]


def parse(raw):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


health = parse(health_raw) or {}
skills = parse(skills_raw) or {}
categories = parse(categories_raw) or {}
sellers = parse(sellers_raw) or {}
auth = parse(auth_raw)

health_status = health.get("status")
health_version = health.get("version")

items = skills.get("items") if isinstance(skills, dict) else None
skills_total = skills.get("total") if isinstance(skills, dict) else None
sample_slug = None
if isinstance(items, list) and items:
    first = items[0]
    if isinstance(first, dict):
        sample_slug = first.get("slug")

category_items = categories.get("categories") if isinstance(categories, dict) else None
category_count = len(category_items) if isinstance(category_items, list) else None

sellers_total = sellers.get("total") if isinstance(sellers, dict) else None

auth_state = "not logged in"
if isinstance(auth, dict) and auth:
    if "detail" in auth:
        detail = auth.get("detail")
        if isinstance(detail, str) and detail.strip():
            auth_state = f"token invalid ({detail})"
    else:
        who = auth.get("email") or auth.get("name") or "authenticated user"
        auth_state = f"logged in as {who}"

result = {
    "api_base": api_base,
    "health_status": health_status,
    "health_version": health_version,
    "skills_total": skills_total,
    "sample_skill_slug": sample_slug,
    "category_count": category_count,
    "sellers_total": sellers_total,
    "auth_state": auth_state,
}

fail_reasons = []
if health_status != "ok":
    fail_reasons.append("health status is not ok")
if not isinstance(skills_total, int):
    fail_reasons.append("skills total unavailable")
if not isinstance(category_count, int):
    fail_reasons.append("category count unavailable")

if fmt == "json":
    print(json.dumps(result, indent=2))
elif fmt == "compact":
    print(
        "api={api} health={health}/{version} skills={skills} sample={sample} categories={cats} sellers={sellers}".format(
            api=api_base,
            health=health_status or "unavailable",
            version=health_version or "-",
            skills=skills_total if isinstance(skills_total, int) else "unavailable",
            sample=sample_slug or "-",
            cats=category_count if isinstance(category_count, int) else "unavailable",
            sellers=sellers_total if isinstance(sellers_total, int) else "unavailable",
        )
        + f" auth={auth_state}"
    )
else:
    print("AgentPowers marketplace snapshot")
    print(f"- API base: {api_base}")
    print(f"- Health: {health_status or 'unavailable'} (version {health_version or '-'})")
    print(f"- Skills total: {skills_total if isinstance(skills_total, int) else 'unavailable'}")
    print(f"- Sample skill: {sample_slug or '-'}")
    print(f"- Categories: {category_count if isinstance(category_count, int) else 'unavailable'}")
    print(f"- Sellers total: {sellers_total if isinstance(sellers_total, int) else 'unavailable'}")
    print(f"- Account: {auth_state}")

if strict and fail_reasons:
    print("Strict mode failure: " + "; ".join(fail_reasons), file=sys.stderr)
    sys.exit(1)
PY
