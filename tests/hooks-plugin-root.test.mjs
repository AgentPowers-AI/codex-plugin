// Security regression tests: Codex plugin hooks must run the PLUGIN's own
// scripts, never scripts resolved from the user's current repository.
//
// The original hooks.json did `ROOT=$(git rev-parse --show-toplevel || pwd)`
// and then ran "$ROOT/scripts/session-start-context.sh" (SessionStart) and
// "$ROOT/scripts/pre-tool-guard.sh" (every Bash tool call). ROOT is the git
// root of the session cwd, i.e. the user's project. A malicious cloned repo
// shipping scripts/session-start-context.sh got arbitrary code execution.
//
// Codex sets PLUGIN_ROOT (and CLAUDE_PLUGIN_ROOT for compatibility) to the
// installed plugin root for plugin hook commands:
// https://developers.openai.com/plugins/build/plugins

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const HOOKS = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "hooks.json"), "utf8"));

function hookCommands() {
  const out = [];
  for (const [event, groups] of Object.entries(HOOKS.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        if (hook.type === "command") out.push({ event, command: hook.command });
      }
    }
  }
  return out;
}

// A hostile project: a git repo whose scripts/ shadow every plugin script and
// write a marker file when executed.
function makeHostileRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ap-hostile-repo-"));
  const marker = path.join(dir, "PWNED");
  fs.mkdirSync(path.join(dir, "scripts"));
  for (const name of [
    "session-start-context.sh",
    "pre-tool-guard.sh",
    "agentpowers-marketplace-context.sh",
    "plugin-doctor.sh",
  ]) {
    const file = path.join(dir, "scripts", name);
    fs.writeFileSync(file, `#!/usr/bin/env bash\necho pwned >> "${marker}"\n`);
    fs.chmodSync(file, 0o755);
  }
  spawnSync("git", ["init", "-q"], { cwd: dir });
  return { dir, marker };
}

function runHook(command, { cwd, env, input = "" }) {
  return spawnSync("sh", ["-c", command], {
    cwd,
    input,
    encoding: "utf8",
    timeout: 15_000,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      // Fail the live API lookup fast and offline.
      AGENTPOWERS_API_BASE: "http://127.0.0.1:9/v1",
      ...env,
    },
  });
}

test("hooks.json never resolves scripts from the session cwd / git root", () => {
  for (const { event, command } of hookCommands()) {
    assert.ok(!/git\s+rev-parse/.test(command), `${event} hook must not use git rev-parse: ${command}`);
    assert.ok(!/\$\(\s*pwd\s*\)|`pwd`|\|\|\s*pwd/.test(command), `${event} hook must not fall back to pwd: ${command}`);
    assert.ok(/PLUGIN_ROOT/.test(command), `${event} hook must resolve via PLUGIN_ROOT: ${command}`);
  }
});

test("hooks run the plugin's scripts, not a hostile repo's, when PLUGIN_ROOT is set", () => {
  const { dir, marker } = makeHostileRepo();
  try {
    for (const { event, command } of hookCommands()) {
      const res = runHook(command, { cwd: dir, env: { PLUGIN_ROOT } });
      assert.ok(!fs.existsSync(marker), `${event} hook executed a script from the user's repo`);
      if (event === "SessionStart") {
        assert.equal(res.status, 0, `SessionStart failed: ${res.stderr}`);
        assert.match(res.stdout, /AgentPowers plugin context/);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("hooks fall back to CLAUDE_PLUGIN_ROOT and never to the cwd", () => {
  const { dir, marker } = makeHostileRepo();
  try {
    for (const { event, command } of hookCommands()) {
      runHook(command, { cwd: dir, env: { CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT } });
      assert.ok(!fs.existsSync(marker), `${event} hook (CLAUDE_PLUGIN_ROOT) executed a repo script`);
      runHook(command, { cwd: dir, env: {} });
      assert.ok(!fs.existsSync(marker), `${event} hook (no plugin root) executed a repo script`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PreToolUse guard still blocks destructive commands via the plugin root", () => {
  const { dir } = makeHostileRepo();
  try {
    const pre = hookCommands().find((h) => h.event === "PreToolUse");
    assert.ok(pre, "PreToolUse hook present");
    const payload = JSON.stringify({ tool_input: { command: "git reset --hard HEAD" } });
    const blocked = runHook(pre.command, { cwd: dir, env: { PLUGIN_ROOT }, input: payload });
    assert.equal(blocked.status, 2, `expected exit 2, got ${blocked.status}: ${blocked.stderr}`);
    const ok = runHook(pre.command, { cwd: dir, env: { PLUGIN_ROOT }, input: JSON.stringify({ tool_input: { command: "ls" } }) });
    assert.equal(ok.status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("helper scripts self-locate instead of trusting the cwd git root", () => {
  const { dir, marker } = makeHostileRepo();
  try {
    const res = spawnSync("bash", [path.join(PLUGIN_ROOT, "scripts", "session-start-context.sh")], {
      cwd: dir,
      encoding: "utf8",
      timeout: 15_000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, AGENTPOWERS_API_BASE: "http://127.0.0.1:9/v1" },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!fs.existsSync(marker), "session-start-context.sh ran the repo's marketplace-context script");
    assert.ok(res.stdout.includes(PLUGIN_ROOT), "context should report the plugin root, not the user's repo");
    for (const name of ["session-start-context.sh", "plugin-doctor.sh"]) {
      const src = fs.readFileSync(path.join(PLUGIN_ROOT, "scripts", name), "utf8");
      assert.ok(!/git\s+rev-parse/.test(src), `${name} must not resolve its root via git rev-parse`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
