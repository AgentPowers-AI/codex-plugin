#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
plugin_root="$repo_root"

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
- Repo root: $repo_root
- Live API: $api_snapshot
- MCP bridge: node scripts/agentpowers-mcp-server.mjs
- Auth flow: login_account tool (or ap login) uses browser-based Clerk auth.
- Purchase flow: install_skill automates checkout + status polling + install; session tools confirm_purchase_session/download_purchased_skill mirror frontend success behavior.
- Target tools: codex, claude-code, claude-ai, claude desktop/cowork, cursor, windsurf, antigravity, gemini-cli, copilot, opencode, openclaw, kiro.
- Quick API request: bash scripts/agentpowers-api-request.sh /skills?limit=3
- Plugin doctor: bash scripts/plugin-doctor.sh
EOF
