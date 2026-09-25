# Contributing

## Merging while GitHub Actions is unavailable

GitHub Actions is billing-blocked for the AgentPowers-AI org (until the plan resets; it may recur), so the CI in `.github/workflows/` does not run on PRs. Every PR still passes the same checks before it merges:

- `.local-ci.json` mirrors the CI jobs step for step and records the sha256 of every file in `.github/workflows/`. When you change a workflow, update the mirrored steps and the hash in the same PR. The local gate fails on any mismatch.
- The gate (`PAI/TOOLS/ApGate/ApGate.ts` in Nate's PAI) runs each job in a clean checkout of the exact PR head merged into `main`. It posts a `local-ci` commit status that records the tested git tree, and a PR comment with the job table.
- Merge with the gate, never directly:

  ```sh
  bun "$CLAUDE_CONFIG_DIR/PAI/TOOLS/ApGate/ApGate.ts" merge codex-plugin <pr> --merge
  ```

  It merges when Actions is green, or when Actions did not run (billing) and a `local-ci` success exists on the exact head and tree. A real Actions failure always blocks. It runs local-ci itself when the result is missing or stale.
- Claude Code sessions with the PAI `ApMergeGate` hook cannot `gh pr merge` or push to `main` here. The hook prints the command above.

