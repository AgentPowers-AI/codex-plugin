// Security regression tests: uninstall_skill / install_skill must never build a
// filesystem path from an unvalidated slug.
//
// The original uninstallSkill did fs.rmSync(path.join(root, "skills", slug),
// { recursive: true, force: true }) with only a trim/non-empty check, so
// slug="../.." resolved to the user's home directory and deleted it. The
// call is reachable from a prompt-injected MCP tool call.
//
// Each test runs the real server over stdio with HOME pointed at a throwaway
// directory, so a regression destroys only the temp dir (and fails loudly).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "..", "scripts", "agentpowers-mcp-server.mjs");

// HOME is nested several levels inside the throwaway dir so that even a
// regression that walks "../../.." up from ~/.codex/skills stays inside it.
const SANDBOXES = new Map();
function makeHome() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ap-codex-sandbox-"));
  const home = path.join(sandbox, "l1", "l2", "l3", "l4", "home");
  fs.mkdirSync(home, { recursive: true });
  SANDBOXES.set(home, sandbox);
  const codex = path.join(home, ".codex");
  fs.mkdirSync(path.join(codex, "skills", "good-skill"), { recursive: true });
  fs.writeFileSync(path.join(codex, "skills", "good-skill", "SKILL.md"), "# good\n");
  fs.mkdirSync(path.join(codex, "agents"), { recursive: true });
  fs.writeFileSync(path.join(codex, "config.toml"), "keep = true\n");
  fs.writeFileSync(path.join(home, "SENTINEL"), "home must survive\n");
  return home;
}

function callTool(home, name, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SERVER], {
      cwd: cwd || home,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        HOME: home,
        USERPROFILE: home,
        AGENTPOWERS_API_BASE: "http://127.0.0.1:9/v1",
      },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`timeout. stdout=<<<${stdout}>>> stderr=<<<${stderr}>>>`));
    }, 8000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 2) {
          clearTimeout(timer);
          child.kill("SIGTERM");
          resolve(msg);
          return;
        }
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    }) + "\n");
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args },
    }) + "\n");
  });
}

function resultText(msg) {
  if (msg.error) return String(msg.error.message || "");
  return (msg.result?.content || []).map((c) => c.text || "").join("\n");
}

function isRejected(msg) {
  return Boolean(msg.error) || msg.result?.isError === true;
}

const HOSTILE_SLUGS = [
  "../..",
  "..",
  ".",
  "../../..",
  "../SENTINEL",
  "good-skill/../..",
  "/",
  "/tmp",
  "~",
  "..%2F..",
  "%2e%2e%2f%2e%2e",
  "..\\..",
  "a/b",
  "good-skill\u0000",
  "Good-Skill",
  "-leading-dash",
  "x".repeat(300),
];

function assertHomeIntact(home) {
  assert.ok(fs.existsSync(path.join(home, "SENTINEL")), "home directory content was deleted");
  assert.ok(fs.existsSync(path.join(home, ".codex", "config.toml")), "~/.codex was deleted");
  assert.ok(fs.existsSync(path.join(home, ".codex", "skills", "good-skill", "SKILL.md")), "unrelated skill was deleted");
}

for (const slug of HOSTILE_SLUGS) {
  test(`uninstall_skill rejects hostile slug ${JSON.stringify(slug.slice(0, 40))}`, async () => {
    const home = makeHome();
    try {
      for (const target of ["codex", "all"]) {
        const msg = await callTool(home, "uninstall_skill", { slug, target_tool: target });
        assert.ok(isRejected(msg), `expected rejection for ${JSON.stringify(slug)}: ${resultText(msg)}`);
        assert.match(resultText(msg), /invalid slug/i);
        assertHomeIntact(home);
      }
    } finally {
      fs.rmSync(SANDBOXES.get(home) || home, { recursive: true, force: true });
    }
  });
}

test("uninstall_skill rejects an absolute path to an existing directory", async () => {
  const home = makeHome();
  try {
    const msg = await callTool(home, "uninstall_skill", { slug: home, target_tool: "codex" });
    assert.ok(isRejected(msg));
    assertHomeIntact(home);
  } finally {
    fs.rmSync(SANDBOXES.get(home) || home, { recursive: true, force: true });
  }
});

test("uninstall_skill still removes a normally installed skill", async () => {
  const home = makeHome();
  try {
    const msg = await callTool(home, "uninstall_skill", { slug: "good-skill", target_tool: "codex" });
    assert.ok(!isRejected(msg), resultText(msg));
    assert.match(resultText(msg), /Uninstalled good-skill/);
    assert.ok(!fs.existsSync(path.join(home, ".codex", "skills", "good-skill")), "skill dir should be removed");
    assert.ok(fs.existsSync(path.join(home, ".codex", "config.toml")));
    assert.ok(fs.existsSync(path.join(home, "SENTINEL")));
  } finally {
    fs.rmSync(SANDBOXES.get(home) || home, { recursive: true, force: true });
  }
});

test("uninstall_skill accepts a surrounding-whitespace slug (trimmed) that is otherwise valid", async () => {
  const home = makeHome();
  try {
    const msg = await callTool(home, "uninstall_skill", { slug: "  good-skill  ", target_tool: "codex" });
    assert.ok(!isRejected(msg), resultText(msg));
    assert.ok(!fs.existsSync(path.join(home, ".codex", "skills", "good-skill")));
  } finally {
    fs.rmSync(SANDBOXES.get(home) || home, { recursive: true, force: true });
  }
});

test("install_skill rejects hostile slugs before touching the network or disk", async () => {
  const home = makeHome();
  try {
    for (const slug of ["../..", "/tmp", "..%2F..", "a/b"]) {
      const msg = await callTool(home, "install_skill", { slug, license_code: "X", target_tool: "cursor" });
      assert.ok(isRejected(msg), `expected rejection for ${slug}`);
      assert.match(resultText(msg), /invalid slug/i);
      assertHomeIntact(home);
    }
  } finally {
    fs.rmSync(SANDBOXES.get(home) || home, { recursive: true, force: true });
  }
});

// The install mirror fallback (non-CLI target such as cursor) used to rmSync
// <target>/<kind>/<slug> and the bridge copy with an unvalidated slug. Drive it
// end to end with a fake `ap` CLI to prove the guarded path still works.
function makeFakeAp(sandboxRoot) {
  const bin = path.join(sandboxRoot, "fakebin");
  fs.mkdirSync(bin, { recursive: true });
  const script = [
    "#!/bin/sh",
    'if [ "$1" = "--help" ]; then exit 0; fi',
    'if [ "$1" = "install" ]; then',
    '  slug="$2"; tool=""',
    '  while [ $# -gt 0 ]; do if [ "$1" = "--for" ]; then tool="$2"; fi; shift; done',
    '  if [ "$tool" = "codex" ] || { [ ".codex" = ".claude" ] && [ "$tool" = "claude-code" ]; }; then',
    '    mkdir -p "$HOME/.codex/skills/$slug" && echo "# $slug" > "$HOME/.codex/skills/$slug/SKILL.md"; exit 0',
    "  fi",
    '  echo "Unknown tool: $tool"; exit 1',
    "fi",
    "exit 1",
  ].join("\n");
  fs.writeFileSync(path.join(bin, "ap"), script + "\n");
  fs.chmodSync(path.join(bin, "ap"), 0o755);
  return bin;
}

test("install fallback mirrors a valid slug into the target tool and cleans only the bridge copy", async () => {
  const home = makeHome();
  const sandbox = SANDBOXES.get(home);
  const bin = makeFakeAp(sandbox);
  const origPath = process.env.PATH;
  process.env.PATH = `${bin}:${origPath}`;
  try {
    const msg = await callTool(home, "install_skill", { slug: "fresh-skill", license_code: "LIC", target_tool: "cursor" });
    assert.ok(!isRejected(msg), resultText(msg));
    assert.match(resultText(msg), /fallback/i);
    assert.ok(fs.existsSync(path.join(home, ".cursor", "skills", "fresh-skill", "SKILL.md")), "mirrored into cursor");
    assert.ok(!fs.existsSync(path.join(home, ".codex", "skills", "fresh-skill")), "temporary bridge copy removed");
    assertHomeIntact(home);
  } finally {
    process.env.PATH = origPath;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

// The project root (<cwd>/.claude) comes from an untrusted repository. A path
// text check alone cannot see where an ancestor symlink leads.
function makeVictim(sandbox) {
  const victim = path.join(sandbox, "victim");
  fs.mkdirSync(path.join(victim, "projects"), { recursive: true });
  fs.writeFileSync(path.join(victim, "projects", "KEEP"), "must survive\n");
  return victim;
}

test("uninstall_skill does not follow a project .claude/skills symlink", async () => {
  const home = makeHome();
  const sandbox = SANDBOXES.get(home);
  try {
    const victim = makeVictim(sandbox);
    const proj = path.join(sandbox, "proj");
    fs.mkdirSync(path.join(proj, ".claude"), { recursive: true });
    fs.symlinkSync(victim, path.join(proj, ".claude", "skills"));
    await callTool(home, "uninstall_skill", { slug: "projects", target_tool: "claude-code" }, { cwd: proj });
    assert.ok(fs.existsSync(path.join(victim, "projects", "KEEP")), "followed .claude/skills symlink out of the project");
    assertHomeIntact(home);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test("uninstall_skill does not follow a project .claude symlink", async () => {
  const home = makeHome();
  const sandbox = SANDBOXES.get(home);
  try {
    const victimRoot = path.join(sandbox, "victim-root");
    fs.mkdirSync(path.join(victimRoot, "skills", "projects"), { recursive: true });
    fs.writeFileSync(path.join(victimRoot, "skills", "projects", "KEEP"), "must survive\n");
    const proj = path.join(sandbox, "proj");
    fs.mkdirSync(proj, { recursive: true });
    fs.symlinkSync(victimRoot, path.join(proj, ".claude"));
    await callTool(home, "uninstall_skill", { slug: "projects", target_tool: "claude-code" }, { cwd: proj });
    assert.ok(fs.existsSync(path.join(victimRoot, "skills", "projects", "KEEP")), "followed .claude symlink out of the project");
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test("uninstall_skill removes a symlinked skill entry itself, never its target", async () => {
  const home = makeHome();
  const sandbox = SANDBOXES.get(home);
  try {
    const victim = makeVictim(sandbox);
    const proj = path.join(sandbox, "proj");
    fs.mkdirSync(path.join(proj, ".claude", "skills"), { recursive: true });
    fs.symlinkSync(path.join(victim, "projects"), path.join(proj, ".claude", "skills", "linky"));
    await callTool(home, "uninstall_skill", { slug: "linky", target_tool: "claude-code" }, { cwd: proj });
    assert.ok(fs.existsSync(path.join(victim, "projects", "KEEP")), "deleted through a symlinked entry");
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test("uninstall_skill removes a skill installed only in the project .claude root", async () => {
  const home = makeHome();
  const sandbox = SANDBOXES.get(home);
  try {
    const proj = path.join(sandbox, "proj");
    fs.mkdirSync(path.join(proj, ".claude", "skills", "proj-skill"), { recursive: true });
    fs.writeFileSync(path.join(proj, ".claude", "skills", "proj-skill", "SKILL.md"), "# p\n");
    const msg = await callTool(home, "uninstall_skill", { slug: "proj-skill", target_tool: "claude-code" }, { cwd: proj });
    assert.ok(!isRejected(msg), resultText(msg));
    assert.ok(!fs.existsSync(path.join(proj, ".claude", "skills", "proj-skill")), "project skill should be removed");
    assertHomeIntact(home);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
