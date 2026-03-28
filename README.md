# AgentPowers Plugin For Codex

Codex plugin for the AgentPowers marketplace with full account, checkout, purchase, and install automation.

## Highlights

- Live marketplace search and detail pulls from AgentPowers API.
- Account-aware flows (`login`, `whoami`, profile, purchases).
- Checkout orchestration (`start_checkout`, status polling, session confirmation).
- Purchase install automation (`install_skill`, `install_purchased_skill`).
- Cross-tool install targeting with alias support.
- Compatibility fallback when local `ap` CLI does not yet support a target directly.

## How It Works

1. Codex calls the local MCP bridge in `scripts/agentpowers-mcp-server.mjs`.
2. The bridge calls AgentPowers API endpoints and `ap` CLI commands.
3. For unsupported `ap --for <tool>` targets, the bridge installs via `codex` and mirrors files to the requested tool root.
4. The plugin returns install path + command output to the user.

## Supported Install Targets

Canonical targets:

- `codex`
- `claude-code`
- `claude-ai`
- `claude-cowork` (Claude Desktop)
- `cursor`
- `windsurf`
- `antigravity`
- `gemini-cli`
- `github-copilot`
- `opencode`
- `openclaw`
- `kiro`

Friendly aliases:

- `gemini` -> `gemini-cli`
- `open code` -> `opencode`
- `claude desktop` -> `claude-cowork`
- `claude.ai` -> `claude-ai`
- `copilot` -> `github-copilot`

## Core MCP Tools

Account:

- `login_account`
- `whoami_account`
- `logout_account`
- `get_account_profile`

Discovery:

- `search_marketplace`
- `get_skill_details`
- `get_categories`
- `get_seller_profile`
- `get_skill_reviews`
- `get_security_results`
- `get_marketplace_snapshot`

Commerce and install:

- `start_checkout`
- `check_purchase_status`
- `confirm_purchase_session`
- `download_purchased_skill`
- `list_purchases`
- `install_skill`
- `install_purchased_skill`
- `check_installed`
- `check_for_updates`
- `uninstall_skill`

## Non-Technical Setup

If you just want this working without any coding:

1. Open Codex, then open the Plugins tab.
2. Add/install the AgentPowers plugin from this repository.
3. Start a chat and say: "Log me into AgentPowers."
4. After login, say: "Find and install the best AgentPowers skill for me."

That’s it. The plugin handles login, checkout flow, purchase confirmation, and install automation for you.

## Quick Start

```bash
# Validate plugin structure + API + MCP bridge
bash scripts/plugin-doctor.sh

# Live API snapshot
bash scripts/agentpowers-marketplace-context.sh

# Direct API request helper
bash scripts/agentpowers-api-request.sh '/skills?limit=5'
```

## Example Workflows

Install by marketplace search:

```text
search_marketplace(query="code review", limit=5)
get_skill_details(slug="hello-world", source="clawhub")
install_skill(slug="hello-world", source="clawhub", target_tool="cursor", global=true)
```

Checkout + purchase confirmation:

```text
start_checkout(slug="stripe-test-skill")
confirm_purchase_session(session_id="cs_test_...", wait_for_completion=true, include_download_url=true)
install_purchased_skill(session_id="cs_test_...", target_tool="codex")
```

## Repository Layout

- `.codex-plugin/plugin.json`: plugin metadata, marketplace card config, prompts, icon/logo.
- `.mcp.json`: MCP server registration.
- `.app.json`: app connector metadata.
- `hooks.json`: plugin lifecycle hooks.
- `skills/agentpowers-marketplace/SKILL.md`: bundled skill instructions.
- `scripts/agentpowers-mcp-server.mjs`: MCP bridge implementation.
- `scripts/plugin-doctor.sh`: verification script.
- `assets/`: screenshots and branding assets.

## Troubleshooting

- `AgentPowers CLI not available`: install or repair `ap` CLI.
- `Not authenticated`: run `login_account` or `ap login`.
- `Security scan failed: timeout`: retry install (external source scan service can intermittently time out).
- Unknown `target_tool`: use one of the canonical targets listed above or a supported alias.
