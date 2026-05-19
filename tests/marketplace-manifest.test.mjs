// Tests that the repo presents itself as a Codex marketplace, so
// `codex plugin marketplace add AgentPowers-AI/codex-plugin` succeeds.
// Codex looks for `.agents/plugins/marketplace.json` (preferred) or
// `.claude-plugin/marketplace.json` at the marketplace root.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const MANIFEST = path.join(PLUGIN_ROOT, ".agents", "plugins", "marketplace.json");

test("marketplace manifest exists at .agents/plugins/marketplace.json", () => {
  assert.ok(
    fs.existsSync(MANIFEST),
    `expected marketplace manifest at ${MANIFEST}`,
  );
});

test("marketplace manifest is valid JSON with required top-level keys", () => {
  const raw = fs.readFileSync(MANIFEST, "utf8");
  const data = JSON.parse(raw);
  assert.ok(typeof data.name === "string" && data.name.length > 0, "name required");
  assert.ok(data.interface && typeof data.interface.displayName === "string", "interface.displayName required");
  assert.ok(Array.isArray(data.plugins) && data.plugins.length >= 1, "plugins array with >= 1 entry required");
});

test("marketplace manifest lists the agentpowers plugin", () => {
  const data = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const ap = data.plugins.find((p) => p.name === "agentpowers");
  assert.ok(ap, "marketplace must contain a plugin named 'agentpowers'");
  assert.ok(ap.source, "plugin must declare a source");
  assert.equal(ap.source.source, "local", "source.source must be 'local'");
  assert.ok(typeof ap.source.path === "string", "source.path required");
});

test("the marketplace plugin path actually contains a Codex plugin", () => {
  const data = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const ap = data.plugins.find((p) => p.name === "agentpowers");
  // Source path is relative to the marketplace manifest's directory.
  const manifestDir = path.dirname(MANIFEST);
  const pluginDir = path.resolve(manifestDir, ap.source.path);
  const pluginJson = path.join(pluginDir, ".codex-plugin", "plugin.json");
  assert.ok(
    fs.existsSync(pluginJson),
    `marketplace points to ${pluginDir} but no .codex-plugin/plugin.json found there`,
  );
  // Sanity-check that plugin.json is valid and names the right plugin.
  const plugin = JSON.parse(fs.readFileSync(pluginJson, "utf8"));
  assert.equal(plugin.name, "agentpowers", "plugin.json.name should match marketplace entry");
});
