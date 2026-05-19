// Tests that the documented `codex mcp add` install command launches the
// MCP server correctly from ANY working directory, not just the cloned
// codex-plugin repo. The previous `bash -lc 'ROOT=$(git rev-parse...)'`
// pattern resolved `ROOT` to the user's cwd at runtime, breaking the server
// whenever the user ran `codex` from their project (not the plugin) dir.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const WRAPPER = path.join(PLUGIN_ROOT, "scripts", "agentpowers-mcp-launch.sh");

const INIT = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "t", version: "1" },
  },
});

async function spawnAndInit(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...opts,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`timeout. stdout=<<<${stdout}>>> stderr=<<<${stderr}>>>`));
    }, 5000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const nl = stdout.indexOf("\n");
      if (nl !== -1) {
        clearTimeout(timer);
        const line = stdout.slice(0, nl);
        child.kill("SIGTERM");
        try {
          resolve({ response: JSON.parse(line), stderr });
        } catch (err) {
          reject(new Error(`bad JSON: ${line}. stderr=${stderr}`));
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.stdin.write(INIT + "\n");
  });
}

test("launch wrapper exists and is executable", () => {
  assert.ok(fs.existsSync(WRAPPER), `${WRAPPER} should exist`);
  const stat = fs.statSync(WRAPPER);
  // 0o111 = any execute bit set
  assert.ok((stat.mode & 0o111) !== 0, `${WRAPPER} should be executable (mode=${stat.mode.toString(8)})`);
});

test("launch wrapper resolves the server from /tmp (user's project dir)", async () => {
  // The wrapper must locate the MCP server relative to its own location,
  // not relative to cwd. Run it from /tmp to simulate the user launching
  // codex from their project directory.
  const { response } = await spawnAndInit(WRAPPER, [], { cwd: os.tmpdir() });
  assert.equal(response.id, 1);
  assert.ok(response.result, "wrapper should successfully launch server");
  assert.equal(response.result.serverInfo.name, "agentpowers-marketplace-mcp");
});

test("launch wrapper resolves the server from $HOME", async () => {
  const { response } = await spawnAndInit(WRAPPER, [], { cwd: os.homedir() });
  assert.equal(response.id, 1);
  assert.ok(response.result);
});

test("launch wrapper resolves the server from inside an UNRELATED git repo", async () => {
  // Reproduces the original bug: `git rev-parse --show-toplevel` returns the
  // unrelated repo's root, and the server script isn't found there.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ap-codex-unrelated-"));
  try {
    // Create a real git repo so `git rev-parse --show-toplevel` returns this dir.
    await new Promise((resolve, reject) => {
      const init = spawn("git", ["init", "-q"], { cwd: tmp, stdio: "ignore" });
      init.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`git init failed: ${code}`))));
    });
    const { response } = await spawnAndInit(WRAPPER, [], { cwd: tmp });
    assert.equal(response.id, 1);
    assert.ok(response.result, "wrapper must work from inside unrelated git repos");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test(".mcp.json command does NOT rely on cwd-based git rev-parse", () => {
  const mcpJson = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, ".mcp.json"), "utf8"));
  const server = mcpJson.mcpServers["agentpowers-marketplace"];
  const cmdArgs = (server.args || []).join(" ") + " " + (server.command || "");
  assert.ok(
    !/git\s+rev-parse/.test(cmdArgs),
    `.mcp.json must not depend on \`git rev-parse\` for path resolution (was: ${cmdArgs})`,
  );
});

test("README's `codex mcp add` example does NOT rely on cwd-based git rev-parse", () => {
  const readme = fs.readFileSync(path.join(PLUGIN_ROOT, "README.md"), "utf8");
  // Find the `codex mcp add` example.
  const match = readme.match(/codex\s+mcp\s+add[\s\S]+?\n(?=```|\n##)/);
  assert.ok(match, "README must include a `codex mcp add` example");
  const example = match[0];
  assert.ok(
    !/git\s+rev-parse/.test(example),
    `README \`codex mcp add\` example must not rely on \`git rev-parse\` for path resolution. Got: ${example.slice(0, 200)}`,
  );
});
