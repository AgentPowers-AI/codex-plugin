#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
plugin_root="$repo_root"

required_files=(
  "$plugin_root/.codex-plugin/plugin.json"
  "$plugin_root/.mcp.json"
  "$plugin_root/.app.json"
  "$plugin_root/hooks.json"
  "$plugin_root/scripts/agentpowers-marketplace-context.sh"
  "$plugin_root/scripts/agentpowers-api-request.sh"
  "$plugin_root/scripts/agentpowers-mcp-server.mjs"
  "$plugin_root/scripts/session-start-context.sh"
  "$plugin_root/scripts/pre-tool-guard.sh"
  "$plugin_root/skills/agentpowers-marketplace/SKILL.md"
)

json_files=(
  "$plugin_root/.codex-plugin/plugin.json"
  "$plugin_root/.mcp.json"
  "$plugin_root/.app.json"
  "$plugin_root/hooks.json"
)

status=0

echo "AgentPowers plugin doctor"
echo "Plugin root: $plugin_root"
echo
echo "1) Required files"
for file in "${required_files[@]}"; do
  if [[ -f "$file" ]]; then
    echo "  OK   $file"
  else
    echo "  MISS $file"
    status=1
  fi
done

echo
echo "2) JSON validation"
for file in "${json_files[@]}"; do
  if [[ -f "$file" ]] && python3 -m json.tool "$file" >/dev/null 2>&1; then
    echo "  OK   $file"
  else
    echo "  FAIL $file"
    status=1
  fi
done

echo
echo "3) Script execute bit"
for file in "$plugin_root"/scripts/*.sh; do
  if [[ -x "$file" ]]; then
    echo "  OK   $file"
  else
    echo "  FAIL $file (not executable)"
    status=1
  fi
done

echo
echo "4) Node script syntax"
mcp_server="$plugin_root/scripts/agentpowers-mcp-server.mjs"
if command -v node >/dev/null 2>&1 && node --check "$mcp_server" >/dev/null 2>&1; then
  echo "  OK   $mcp_server"
else
  echo "  FAIL $mcp_server"
  status=1
fi

echo
echo "5) API and MCP self-test"
if bash "$plugin_root/scripts/agentpowers-marketplace-context.sh" --strict >/dev/null 2>&1; then
  echo "  OK   API snapshot check"
else
  echo "  FAIL API snapshot check"
  status=1
fi

if command -v node >/dev/null 2>&1 && node "$mcp_server" --self-test >/dev/null 2>&1; then
  echo "  OK   MCP bridge self-test"
else
  echo "  FAIL MCP bridge self-test"
  status=1
fi

echo
echo "6) AgentPowers CLI availability"
if command -v ap >/dev/null 2>&1 && ap --help >/dev/null 2>&1; then
  echo "  OK   ap CLI installed"
else
  echo "  FAIL ap CLI missing (install with: pip install agentpowers)"
  status=1
fi

echo
if [[ $status -eq 0 ]]; then
  echo "AgentPowers plugin doctor passed."
else
  echo "AgentPowers plugin doctor found issues."
fi

exit $status
