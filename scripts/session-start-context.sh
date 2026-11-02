#!/usr/bin/env bash
set -euo pipefail

# Resolve this plugin's own directory from the script location, never from the
# user's cwd / git root (a hostile repo could otherwise shadow plugin scripts).
script_source="${BASH_SOURCE[0]}"
while [ -h "$script_source" ]; do
  script_dir="$(cd -P "$(dirname "$script_source")" >/dev/null 2>&1 && pwd)"
  script_source="$(readlink "$script_source")"
  [[ "$script_source" != /* ]] && script_source="$script_dir/$script_source"
done
plugin_root="$(cd -P "$(dirname "$script_source")/.." >/dev/null 2>&1 && pwd)"

if [[ ! -d "$plugin_root" ]]; then
  exit 0
fi

api_snapshot="unavailable (set AGENTPOWERS_API_BASE or PUBLIC_API_URL if needed)"
if snapshot="$(bash "$plugin_root/scripts/agentpowers-marketplace-context.sh" --compact 2>/dev/null)"; then
  if [[ -n "${snapshot// }" ]]; then
    api_snapshot="$snapshot"
  fi
fi

cat <<EOF
AgentPowers plugin context:
- Plugin root: $plugin_root
- Live API: $api_snapshot
- MCP bridge: node scripts/agentpowers-mcp-server.mjs
- Auth flow: login_account tool (or ap login) uses browser-based Clerk auth.
- Purchase flow: install_skill automates checkout + status polling + install; session tools confirm_purchase_session/download_purchased_skill mirror frontend success behavior.
- Target tools: codex, claude-code, claude-ai, claude desktop/cowork, cursor, windsurf, antigravity, gemini-cli, copilot, opencode, openclaw, kiro.
- Quick API request: bash scripts/agentpowers-api-request.sh /skills?limit=3
- Plugin doctor: bash scripts/plugin-doctor.sh
EOF
