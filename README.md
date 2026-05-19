<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/logo-agentpowers-darkmode.svg">
    <source media="(prefers-color-scheme: light)" srcset="./assets/logo-agentpowers-lightmode.svg">
    <img alt="AgentPowers" src="./assets/logo-agentpowers-lightmode.svg" width="420">
  </picture>
</p>

# AgentPowers Plugin For Codex

Install, buy, and manage AI skills from [AgentPowers](https://agentpowers.ai) directly inside Codex.

AgentPowers is a marketplace for production-ready AI skills and agents. This plugin connects Codex to your AgentPowers account so you can search the marketplace, complete checkout, access purchased skills, and install them in a few prompts.

## Why Use This Plugin?

- Find high-quality AI skills faster.
- Log in to AgentPowers without leaving your workflow.
- Run checkout and purchase confirmation from Codex.
- Install purchased skills for Codex and other supported tools.
- Keep everything in one place instead of juggling browser tabs and manual installs.

## What You Can Do In Plain English

- "Find the best AgentPowers skill for my project."
- "Log me in and show my purchased skills."
- "Start checkout for this skill and install it after payment."
- "Install my purchased skill for Cursor, Windsurf, or Gemini CLI."

## Non-Technical Setup (Codex App / Codex CLI marketplace)

If you prefer the marketplace install:

```bash
codex plugin marketplace add AgentPowers-AI/codex-plugin
```

Or in the Codex App:

1. Open Codex App.
2. Go to **Plugins**.
3. Click **+** and add `AgentPowers-AI/codex-plugin` as a marketplace.
4. Click **Add to Codex** on AgentPowers.
5. Start a new chat and type: `Log me into AgentPowers and find the best skill for my current project.`

That is enough to get started.

## Technical Setup (Codex CLI)

If you use terminal-first workflows, connect the MCP server directly:

```bash
git clone https://github.com/AgentPowers-AI/codex-plugin.git
cd codex-plugin

codex mcp add agentpowers-marketplace -- "$(pwd)/scripts/agentpowers-mcp-launch.sh"
codex mcp list
```

The `agentpowers-mcp-launch.sh` wrapper resolves the MCP server relative to
its own location, so you can launch `codex` from any directory afterwards.

Then start Codex and use it normally:

```bash
codex
```

Example first prompt:

```text
Log me into AgentPowers, list my purchases, and install the best match for my project.
```

## Supported Install Targets

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

Friendly aliases also work:

- `gemini` -> `gemini-cli`
- `open code` -> `opencode`
- `claude desktop` -> `claude-cowork`
- `claude.ai` -> `claude-ai`
- `copilot` -> `github-copilot`

## Checkout + Purchase Flow

For paid skills, the plugin handles:

1. Login check.
2. Checkout creation.
3. Payment status confirmation.
4. Purchase access validation.
5. Install automation.

So users can complete the full flow with natural-language prompts.

## Security And Trust

- Uses official AgentPowers API endpoints.
- Reuses your authenticated AgentPowers session/token.
- Includes guardrails for risky shell command patterns.
- Works with AgentPowers security checks for external-source installs.

## Troubleshooting

- `Not authenticated`: run `login_account` (or `ap login`).
- `AgentPowers CLI not available`: install or repair `ap` CLI.
- `Security scan failed: timeout`: retry install (intermittent upstream scan timeout).
- MCP server not visible in CLI: run `codex mcp list` and re-add the server.

## Repo Structure

- `.codex-plugin/plugin.json`: plugin metadata and storefront information.
- `.mcp.json`: MCP server registration settings.
- `hooks.json`: plugin lifecycle hooks.
- `scripts/agentpowers-mcp-server.mjs`: main AgentPowers MCP bridge.
- `scripts/plugin-doctor.sh`: one-command health check.
- `skills/agentpowers-marketplace/SKILL.md`: bundled operating guide.
- `assets/`: icons, logos, screenshots.
