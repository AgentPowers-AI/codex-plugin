#!/usr/bin/env bash
# Self-locating launcher for the AgentPowers Codex MCP server.
#
# Codex's `mcp add` does not let users set a per-server cwd, so the launcher
# must resolve the server script relative to its own location, not the user's
# working directory. The previous approach used `git rev-parse --show-toplevel`
# at runtime, which broke as soon as the user ran `codex` from any directory
# other than the cloned codex-plugin repo.
set -euo pipefail

# Resolve the directory containing this script even if invoked via a symlink.
SCRIPT_SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SCRIPT_SOURCE" ]; do
    SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" >/dev/null 2>&1 && pwd)"
    SCRIPT_SOURCE="$(readlink "$SCRIPT_SOURCE")"
    [[ "$SCRIPT_SOURCE" != /* ]] && SCRIPT_SOURCE="$SCRIPT_DIR/$SCRIPT_SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_SOURCE")" >/dev/null 2>&1 && pwd)"

exec node "$SCRIPT_DIR/agentpowers-mcp-server.mjs" "$@"
