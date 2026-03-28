---
name: agentpowers-marketplace
description: Use AgentPowers marketplace tools to search skills, log in, checkout, access purchases, and install skills.
---

# AgentPowers Marketplace

Use this skill when you want to use AgentPowers in Codex for marketplace discovery, account access, checkout, and purchased-skill installs.

## Environment

- `AGENTPOWERS_API_BASE`: optional API base (defaults to `https://api.agentpowers.ai/v1`).
- `AGENTPOWERS_API_TOKEN`: optional bearer token for authenticated endpoints.
- `AGENTPOWERS_OPENAPI_URL`: optional OpenAPI URL override (defaults to `https://docs.agentpowers.ai/openapi.json`).

## Quick Workflow

1. Check API connectivity:

```bash
bash scripts/agentpowers-marketplace-context.sh
```

2. Log in:

```bash
ap login
ap whoami
```

3. Search and inspect skills:

```bash
search_marketplace(query="security")
get_skill_details(slug="<skill-slug>")
```

4. Buy/install:

Free skill:
`install_skill(slug="<skill-slug>", target_tool="codex")`

Paid skill:
`install_skill(slug="<skill-slug>", target_tool="codex", wait_for_completion=true)`

Session confirm/download:
`confirm_purchase_session(session_id="cs_...", include_download_url=true)`
`download_purchased_skill(session_id="cs_...")`

5. Use MCP tools exposed by the plugin bridge:
- `search_marketplace`
- `get_skill_details`
- `install_skill` (free or paid, with checkout automation)
- `start_checkout`
- `check_purchase_status`
- `confirm_purchase_session`
- `download_purchased_skill`
- `list_purchases`
- `install_purchased_skill`
- `check_installed`
- `check_for_updates`
- `uninstall_skill`
- `login_account`
- `whoami_account`
- Plus compatibility/discovery tools (`search_skills`, `get_categories`, etc.)

## Notes

- API tools can read auth automatically from `~/.agentpowers/auth.json`.
- Session-based purchase confirmation/download can work with `session_id`.
- Use `/health` to verify API availability.
- Accepted install targets: `codex`, `claude-code`, `claude-ai`, `claude-cowork`, `cursor`,
  `windsurf`, `antigravity`, `gemini-cli`, `github-copilot`, `opencode`, `openclaw`, `kiro`.
- Friendly aliases: `gemini`, `open code`, `claude desktop`, `claude.ai`, `copilot`.
