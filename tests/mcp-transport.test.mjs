// Tests for MCP stdio transport compliance.
//
// Per https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
// stdio messages are delimited by newlines (NDJSON). Codex's own
// `codex mcp-server` confirms this. The original implementation used LSP
// `Content-Length:` framing — non-spec-compliant and incompatible with
// every spec-following MCP client (Codex, Claude Code, Cursor, etc.).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "..", "scripts", "agentpowers-mcp-server.mjs");

function spawnServer(extraEnv = {}) {
  return spawn("node", [SERVER], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...extraEnv },
  });
}

async function exchange(child, payload, { framing }) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`timeout. stdout=<<<${stdout}>>> stderr=<<<${stderr}>>>`));
    }, 4000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (framing === "ndjson") {
        const nl = stdout.indexOf("\n");
        if (nl !== -1) {
          clearTimeout(timer);
          const line = stdout.slice(0, nl);
          child.kill("SIGTERM");
          try {
            resolve(JSON.parse(line));
          } catch (err) {
            reject(new Error(`bad JSON line: ${line}. stderr=${stderr}`));
          }
        }
      } else if (framing === "lsp") {
        const headerEnd = stdout.indexOf("\r\n\r\n");
        if (headerEnd !== -1) {
          const match = /content-length:\s*(\d+)/i.exec(stdout.slice(0, headerEnd));
          if (match) {
            const len = Number(match[1]);
            const bodyStart = headerEnd + 4;
            if (stdout.length >= bodyStart + len) {
              clearTimeout(timer);
              const body = stdout.slice(bodyStart, bodyStart + len);
              child.kill("SIGTERM");
              try {
                resolve(JSON.parse(body));
              } catch (err) {
                reject(new Error(`bad LSP body: ${body}`));
              }
            }
          }
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);

    if (framing === "ndjson") {
      child.stdin.write(JSON.stringify(payload) + "\n");
    } else if (framing === "lsp") {
      const body = JSON.stringify(payload);
      child.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
    } else {
      reject(new Error(`unknown framing: ${framing}`));
    }
  });
}

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0" },
  },
};

test("server responds to NDJSON initialize (MCP spec compliance)", async () => {
  const child = spawnServer();
  const response = await exchange(child, INIT, { framing: "ndjson" });
  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, 1);
  assert.ok(response.result, "response should have a result");
  assert.equal(response.result.protocolVersion, "2024-11-05");
  assert.ok(response.result.serverInfo, "serverInfo should be present");
  assert.equal(response.result.serverInfo.name, "agentpowers-marketplace-mcp");
});

test("server emits NDJSON (single line, no Content-Length header)", async () => {
  const child = spawnServer();
  const raw = await new Promise((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("timeout waiting for response"));
    }, 4000);
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      if (buf.includes("\n")) {
        clearTimeout(t);
        child.kill("SIGTERM");
        resolve(buf);
      }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify(INIT) + "\n");
  });
  assert.ok(
    !/^Content-Length:/i.test(raw),
    `output started with Content-Length header (LSP framing) — should be NDJSON. raw=<<<${raw.slice(0, 200)}>>>`,
  );
  const firstLine = raw.split("\n")[0];
  const parsed = JSON.parse(firstLine);
  assert.equal(parsed.id, 1);
});

test("server still accepts LSP Content-Length framing (backwards compat)", async () => {
  const child = spawnServer();
  const response = await exchange(child, INIT, { framing: "lsp" });
  assert.equal(response.id, 1);
  assert.ok(response.result, "LSP-framed init should still produce a result");
});

test("framing detection waits for enough bytes (LSP-prefix chunk)", async () => {
  // If the first stdin chunk is just "Content-L", the server must NOT pick
  // NDJSON yet — it has to keep waiting and only commit once it can prove
  // which framing the peer is using.
  const child = spawnServer();
  const body = JSON.stringify(INIT);
  const fullFrame = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
  const splitAt = "Content-L".length;
  const part1 = fullFrame.slice(0, splitAt);
  const part2 = fullFrame.slice(splitAt);
  const response = await new Promise((resolve, reject) => {
    let stdout = "";
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`timeout. stdout=<<<${stdout}>>>`));
    }, 4000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const headerEnd = stdout.indexOf("\r\n\r\n");
      if (headerEnd !== -1) {
        const m = /content-length:\s*(\d+)/i.exec(stdout.slice(0, headerEnd));
        if (m) {
          const need = headerEnd + 4 + Number(m[1]);
          if (stdout.length >= need) {
            clearTimeout(t);
            child.kill("SIGTERM");
            try {
              resolve(JSON.parse(stdout.slice(headerEnd + 4, need)));
            } catch (err) {
              reject(err);
            }
          }
        }
      }
    });
    child.on("error", reject);
    child.stdin.write(part1);
    setTimeout(() => child.stdin.write(part2), 30);
  });
  assert.equal(response.id, 1, "split LSP frame should still be initialized correctly");
  assert.ok(response.result);
});

test("server lists tools via NDJSON", async () => {
  const child = spawnServer();
  const result = await new Promise((resolve, reject) => {
    let stdout = "";
    let pending = 2;
    let initResult = null;
    let toolsResult = null;
    const t = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`timeout. stdout=<<<${stdout.slice(0, 500)}>>>`));
    }, 5000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      let nl;
      while ((nl = stdout.indexOf("\n")) !== -1) {
        const line = stdout.slice(0, nl);
        stdout = stdout.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1) initResult = msg;
          if (msg.id === 2) toolsResult = msg;
          pending = (initResult ? 0 : 1) + (toolsResult ? 0 : 1);
          if (pending === 0) {
            clearTimeout(t);
            child.kill("SIGTERM");
            resolve({ initResult, toolsResult });
            return;
          }
        } catch (err) {
          /* ignore partial */
        }
      }
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify(INIT) + "\n");
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
    );
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n",
    );
  });
  assert.ok(result.toolsResult, "tools/list should return a response");
  const tools = result.toolsResult.result?.tools || [];
  assert.ok(tools.length >= 20, `expected >= 20 tools, got ${tools.length}`);
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("search_marketplace"), "search_marketplace tool missing");
  assert.ok(names.includes("install_skill"), "install_skill tool missing");
});
