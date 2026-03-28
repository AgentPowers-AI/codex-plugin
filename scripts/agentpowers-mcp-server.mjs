#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const SERVER_INFO = {
  name: "agentpowers-marketplace-mcp",
  version: "0.3.7",
};

const DEFAULT_PROTOCOL_VERSION = "2024-11-05";
const SITE_ORIGIN = process.env.AGENTPOWERS_SITE_ORIGIN || "https://agentpowers.ai";
const OPENAPI_URL = process.env.AGENTPOWERS_OPENAPI_URL || "https://docs.agentpowers.ai/openapi.json";
const USER_AGENT = "AgentPowers-Codex-MCP/0.3.7";
const AUTH_FILE = path.join(os.homedir(), ".agentpowers", "auth.json");
const PINS_FILE = path.join(os.homedir(), ".agentpowers", "pins.json");
const PLUGIN_STATE_FILE = path.join(os.homedir(), ".agentpowers", "plugin-state.json");

const EXCLUDED_HASH_NAMES = new Set([".DS_Store", "Thumbs.db"]);

const INSTALL_TARGETS = [
  "codex",
  "claude-code",
  "claude-ai",
  "claude-cowork",
  "cursor",
  "windsurf",
  "antigravity",
  "gemini-cli",
  "github-copilot",
  "opencode",
  "openclaw",
  "kiro",
];

const INSTALL_TARGET_SET = new Set(INSTALL_TARGETS);
const INSTALL_TARGETS_WITH_ALL = ["all", ...INSTALL_TARGETS];
const CLI_PRIMARY_SUPPORTED_TOOLS = new Set(["codex", "claude-code"]);

const TOOL_ALIASES = {
  codex: "codex",
  claude: "claude-code",
  "claude-code": "claude-code",
  "claude-ai": "claude-ai",
  "claude-cowork": "claude-cowork",
  "claude-desktop": "claude-cowork",
  cursor: "cursor",
  windsurf: "windsurf",
  antigravity: "antigravity",
  gemini: "gemini-cli",
  "gemini-cli": "gemini-cli",
  copilot: "github-copilot",
  "github-copilot": "github-copilot",
  "open-code": "opencode",
  opencode: "opencode",
  openclaw: "openclaw",
  kiro: "kiro",
};

const PLATFORMS = [
  { slug: "claude-code", name: "Claude Code", tagline: "Anthropic terminal-native coding assistant" },
  { slug: "claude-cowork", name: "Claude Desktop", tagline: "Anthropic desktop agent for workflows" },
  { slug: "claude-ai", name: "claude.ai", tagline: "Anthropic web-based Claude interface" },
  { slug: "cursor", name: "Cursor", tagline: "AI-first code editor" },
  { slug: "codex", name: "Codex", tagline: "OpenAI autonomous coding agent" },
  { slug: "windsurf", name: "Windsurf", tagline: "AI coding editor by Codeium" },
  { slug: "antigravity", name: "Antigravity", tagline: "AI development platform" },
  { slug: "gemini-cli", name: "Gemini CLI", tagline: "Google CLI-based coding agent" },
  { slug: "github-copilot", name: "GitHub Copilot", tagline: "GitHub AI coding assistant" },
  { slug: "openclaw", name: "OpenClaw", tagline: "Open-source AI agent platform" },
  { slug: "opencode", name: "OpenCode", tagline: "Open-source terminal AI coding agent" },
  { slug: "kiro", name: "Kiro", tagline: "AWS AI-powered development environment" },
];

function normalizeApiBase(raw) {
  const base = (raw || "https://api.agentpowers.ai/v1").replace(/\/+$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

const API_BASE = normalizeApiBase(
  process.env.AGENTPOWERS_API_BASE || process.env.PUBLIC_API_URL || "https://api.agentpowers.ai/v1",
);
const API_ROOT = API_BASE.replace(/\/v1$/, "");

function ensureLeadingSlash(value) {
  if (!value) return "/";
  return value.startsWith("/") ? value : `/${value}`;
}

function mkUrl(base, p) {
  return `${base}${ensureLeadingSlash(p)}`;
}

function mkContent(text) {
  return {
    content: [{ type: "text", text }],
  };
}

function parseJsonSafe(raw, fallback = null) {
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function stripAnsi(raw) {
  return String(raw || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function fmtPrice(cents) {
  if (typeof cents !== "number") return "Unknown";
  return cents === 0 ? "Free" : `$${(cents / 100).toFixed(2)}`;
}

function authorName(skill) {
  if (!skill || typeof skill !== "object") return "Unknown";
  if (skill.author && typeof skill.author === "object" && skill.author.display_name) {
    return String(skill.author.display_name);
  }
  if (skill.author_display_name) return String(skill.author_display_name);
  return "Unknown";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toBool(value, defaultValue = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(v)) return true;
    if (["0", "false", "no", "n", "off"].includes(v)) return false;
  }
  if (typeof value === "number") return value !== 0;
  return defaultValue;
}

function toNumber(value, defaultValue) {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function normalizeToolKey(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.replace(/[_.\s]+/g, "-");
}

function resolveTargetTool(value, defaultTool = "codex", allowAll = false) {
  const fallback = allowAll ? "all" : defaultTool;
  const normalized = normalizeToolKey(value || fallback);
  if (allowAll && normalized === "all") return "all";

  const mapped = TOOL_ALIASES[normalized] || normalized;
  if (!INSTALL_TARGET_SET.has(mapped)) {
    const supported = INSTALL_TARGETS.join(", ");
    const suffix = allowAll ? ", all" : "";
    throw new Error(`Unknown target_tool '${value}'. Supported tools: ${supported}${suffix}.`);
  }
  return mapped;
}

function toolConfigDirName(tool) {
  if (tool === "claude-code") return ".claude";
  return `.${tool}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJsonFile(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return parseJsonSafe(fs.readFileSync(filePath, "utf8"), fallback);
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  const parent = path.dirname(filePath);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function loadApiToken() {
  if (process.env.AGENTPOWERS_API_TOKEN) {
    return process.env.AGENTPOWERS_API_TOKEN;
  }
  const auth = readJsonFile(AUTH_FILE, {});
  return typeof auth.token === "string" && auth.token.trim() ? auth.token.trim() : null;
}

function loadPins() {
  const pins = readJsonFile(PINS_FILE, {});
  return pins && typeof pins === "object" ? pins : {};
}

function removePin(slug) {
  const pins = loadPins();
  if (!pins[slug]) return false;
  delete pins[slug];
  writeJsonFile(PINS_FILE, pins);
  return true;
}

function loadPluginState() {
  const state = readJsonFile(PLUGIN_STATE_FILE, {});
  if (!state || typeof state !== "object") return { checkouts: {} };
  if (!state.checkouts || typeof state.checkouts !== "object") state.checkouts = {};
  return state;
}

function savePluginState(state) {
  writeJsonFile(PLUGIN_STATE_FILE, state);
}

function rememberCheckout(record) {
  if (!record || !record.purchase_id) return;
  const state = loadPluginState();
  state.checkouts[record.purchase_id] = {
    ...state.checkouts[record.purchase_id],
    ...record,
    updated_at: new Date().toISOString(),
  };
  savePluginState(state);
}

function getCheckoutRecord(purchaseId) {
  const state = loadPluginState();
  return state.checkouts[purchaseId] || null;
}

function listCheckoutRecords() {
  const state = loadPluginState();
  return Object.entries(state.checkouts || {}).map(([id, value]) => ({ purchase_id: id, ...value }));
}

function buildAuthHeaders(authRequired = false) {
  const headers = {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };
  const token = loadApiToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (authRequired && !token) {
    throw new Error("Not authenticated. Run login_account (or `ap login`) first.");
  }
  return headers;
}

async function httpJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      ...buildAuthHeaders(Boolean(options.authRequired)),
      ...(options.headers || {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const rawText = await response.text();
  const data = parseJsonSafe(rawText, rawText || {});

  if (!response.ok) {
    const detail = typeof data === "object" && data && "detail" in data
      ? JSON.stringify(data.detail)
      : (typeof data === "string" ? data : JSON.stringify(data));
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${detail}`);
  }

  return data;
}

async function apiV1(pathValue, options = {}) {
  return httpJson(mkUrl(API_BASE, pathValue), options);
}

async function apiRoot(pathValue, options = {}) {
  return httpJson(mkUrl(API_ROOT, pathValue), options);
}

function appendLimited(current, addition, limit = 400_000) {
  const next = current + addition;
  if (next.length <= limit) return next;
  return next.slice(next.length - limit);
}

async function runCommand(command, args = [], options = {}) {
  const timeoutMs = toNumber(options.timeoutMs, 120_000);
  const cwd = options.cwd || process.cwd();
  const env = { ...process.env, ...(options.env || {}) };

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500);
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        code: -1,
        signal: null,
        stdout,
        stderr,
        timedOut: false,
        error: String(err),
      });
    });

    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk.toString("utf8"));
    });

    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk.toString("utf8"));
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        signal: signal || null,
        stdout,
        stderr,
        timedOut,
        error: null,
      });
    });
  });
}

function formatCommandResult(result) {
  const out = stripAnsi(result.stdout || "").trim();
  const err = stripAnsi(result.stderr || "").trim();
  const chunks = [];
  if (out) chunks.push(out);
  if (err) chunks.push(err);
  if (!chunks.length) return "(no output)";
  return chunks.join("\n");
}

async function runAp(args, options = {}) {
  return runCommand("ap", args, {
    timeoutMs: options.timeoutMs || 180_000,
    cwd: options.cwd || process.cwd(),
    env: {
      NO_COLOR: "1",
      TERM: "dumb",
      ...options.env,
    },
  });
}

async function ensureApAvailable() {
  const result = await runAp(["--help"], { timeoutMs: 10_000 });
  if (result.code !== 0) {
    throw new Error(`AgentPowers CLI not available. Install with: pip install agentpowers\n${formatCommandResult(result)}`);
  }
}

async function openInBrowser(url) {
  let command = null;
  let args = [];

  if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  const result = await runCommand(command, args, { timeoutMs: 10_000 });
  return {
    ok: result.code === 0,
    command: `${command} ${args.join(" ")}`,
    output: formatCommandResult(result),
  };
}

function collectFilesForHash(baseDir, currentDir, out) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryName = entry.name;
    if (EXCLUDED_HASH_NAMES.has(entryName)) continue;
    if (entryName === "__pycache__") continue;
    if (entryName.endsWith(".pyc")) continue;

    const absolute = path.join(currentDir, entryName);
    const relative = path.relative(baseDir, absolute);

    if (entry.isDirectory()) {
      collectFilesForHash(baseDir, absolute, out);
    } else if (entry.isFile()) {
      out.push(relative);
    }
  }
}

function hashDirectory(dirPath) {
  const files = [];
  collectFilesForHash(dirPath, dirPath, files);
  files.sort();

  const hash = crypto.createHash("sha256");
  for (const relative of files) {
    const absolute = path.join(dirPath, relative);
    hash.update(relative);
    hash.update("\0");
    hash.update(fs.readFileSync(absolute));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function getInstallRoots() {
  const roots = INSTALL_TARGETS.map((tool) => ({
    tool,
    scope: "global",
    root: path.join(os.homedir(), toolConfigDirName(tool)),
  }));

  const projectClaude = path.join(process.cwd(), ".claude");
  if (fs.existsSync(projectClaude)) {
    roots.push({
      tool: "claude-code",
      scope: "project",
      root: projectClaude,
    });
  }

  return roots;
}

function getGlobalToolRoot(tool) {
  return path.join(os.homedir(), toolConfigDirName(tool));
}

function getToolInstallEntries(tool, slug) {
  const root = getGlobalToolRoot(tool);
  const entries = [];

  for (const kind of ["skills", "agents"]) {
    const installPath = path.join(root, kind, slug);
    try {
      if (fs.existsSync(installPath) && fs.statSync(installPath).isDirectory()) {
        entries.push({ kind, install_path: installPath });
      }
    } catch {
      // Ignore unreadable or transient paths.
    }
  }

  return entries;
}

function collectInstalledEntries(options = {}) {
  const includeHashCheck = toBool(options.includeHashCheck, true);
  const pins = loadPins();
  const roots = getInstallRoots();
  const entries = [];

  for (const root of roots) {
    for (const kind of ["skills", "agents"]) {
      const dirPath = path.join(root.root, kind);
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) continue;

      const slugs = fs.readdirSync(dirPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));

      for (const slug of slugs) {
        const installPath = path.join(dirPath, slug);
        const pin = pins[slug] || null;
        let edited = null;

        if (includeHashCheck && pin && typeof pin.content_hash === "string") {
          try {
            const currentHash = hashDirectory(installPath);
            edited = currentHash !== pin.content_hash;
          } catch {
            edited = null;
          }
        }

        entries.push({
          slug,
          type: kind === "agents" ? "agent" : "skill",
          tool: root.tool,
          scope: root.scope,
          install_path: installPath,
          source: pin?.source || "local",
          version: pin?.version || null,
          security_status: pin?.security_status || null,
          installed_at: pin?.installed_at || null,
          edited,
        });
      }
    }
  }

  return entries;
}

function compareSemver(installed, latest) {
  const parse = (value) => String(value || "").split(".").map((part) => Number(part));
  const a = parse(installed);
  const b = parse(latest);
  if (a.some((x) => Number.isNaN(x)) || b.some((x) => Number.isNaN(x))) return null;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const ai = a[i] || 0;
    const bi = b[i] || 0;
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }
  return 0;
}

function formatInstalledEntries(entries) {
  if (!entries.length) return "No installed skills or agents found across configured tool roots.";

  const lines = [];
  lines.push(`Installed items: ${entries.length}`);
  lines.push("");

  for (const item of entries) {
    const version = item.version || "-";
    const security = item.security_status || "-";
    const edited = item.edited === null ? "unknown" : item.edited ? "yes" : "no";
    lines.push(
      `- ${item.slug} (${item.type}) | tool=${item.tool} (${item.scope}) | source=${item.source} | version=${version} | security=${security} | edited=${edited}`,
    );
    lines.push(`  path: ${item.install_path}`);
  }

  return lines.join("\n");
}

async function ensureAuthenticated() {
  const token = loadApiToken();
  if (!token) {
    throw new Error("Not authenticated. Run login_account first.");
  }

  try {
    await apiV1("/auth/me", { authRequired: true });
  } catch (error) {
    throw new Error(`Authentication failed. Run login_account again. (${error instanceof Error ? error.message : String(error)})`);
  }
}

async function searchMarketplace(args = {}) {
  const query = String(args.query || "").trim();
  const category = String(args.category || "").trim();
  const type = String(args.type || "").trim();
  const limit = Math.max(1, Math.min(50, toNumber(args.limit, 20)));

  if (!query && !category && !type) {
    return {
      isError: true,
      ...mkContent("Provide at least one filter: query, category, or type."),
    };
  }

  if (query) {
    const params = new URLSearchParams();
    params.set("q", query);
    if (category) params.set("category", category);
    if (type) params.set("type", type);
    params.set("limit", String(limit));

    const raw = await apiV1(`/search?${params.toString()}`);
    const sources = Object.entries(raw || {}).filter(([, section]) => section && typeof section === "object");

    if (!sources.length) {
      return mkContent(`No marketplace results for "${query}".`);
    }

    const lines = [];
    for (const [source, section] of sources) {
      const items = asArray(section.items || []).slice(0, limit);
      const total = Number.isFinite(section.total) ? section.total : items.length;
      lines.push(`## ${source} (${total} results)`);

      if (!items.length) {
        lines.push("- No matches.");
        lines.push("");
        continue;
      }

      for (const item of items) {
        const slug = item.slug || "-";
        const title = item.title || slug;
        const price = item.price_cents !== undefined ? fmtPrice(item.price_cents) : (item.price || "Unknown");
        const security = item.security_status || item.ap_security_status || "unknown";
        lines.push(`- **${title}** (${slug}) | type=${item.type || "skill"} | price=${price} | security=${security}`);
        if (item.description) lines.push(`  ${item.description}`);
        if (source === "agentpowers") {
          lines.push(`  ${SITE_ORIGIN}/skills/${slug}`);
        } else if (item.source_url) {
          lines.push(`  ${item.source_url}`);
        }
      }
      lines.push("");
    }

    return mkContent(lines.join("\n"));
  }

  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (type) params.set("type", type);
  params.set("limit", String(limit));

  const raw = await apiV1(`/skills?${params.toString()}`);
  const items = asArray(raw.items);
  if (!items.length) return mkContent("No skills found with the provided filters.");

  const lines = [`Found ${raw.total ?? items.length} AgentPowers listings:`];
  for (const item of items) {
    const slug = item.slug || "-";
    lines.push(`- **${item.title || slug}** (${slug}) | ${fmtPrice(item.price_cents)} | ${item.type || "skill"} | ${item.category || "uncategorized"}`);
  }

  return mkContent(lines.join("\n"));
}

async function getSkillDetails(args = {}) {
  const slug = String(args.slug || "").trim();
  if (!slug) return { isError: true, ...mkContent("Missing required argument: slug") };

  const source = String(args.source || "").trim();
  const qs = source ? `?source=${encodeURIComponent(source)}` : "";
  const skill = await apiV1(`/detail/${encodeURIComponent(slug)}${qs}`);

  const platforms = asArray(skill.platforms);
  const lines = [
    `# ${skill.title || slug}`,
    "",
    `**Slug:** ${skill.slug || slug}`,
    `**Source:** ${source || skill.source || "agentpowers"}`,
    `**Price:** ${fmtPrice(skill.price_cents)}`,
    `**Type:** ${skill.type || "skill"}`,
    `**Category:** ${skill.category || "uncategorized"}`,
    `**Author:** ${authorName(skill)}`,
    `**Version:** ${skill.version || "-"}`,
    `**Downloads:** ${skill.download_count ?? 0}`,
    `**Security:** ${skill.security_status || skill.ap_security_status || "unknown"}`,
    `**Platforms:** ${platforms.length ? platforms.join(", ") : "All MCP-compatible"}`,
    "",
    "## Description",
    String(skill.description || "No description."),
  ];

  if (skill.long_description) {
    lines.push("", "## Full Description", String(skill.long_description));
  }

  if (!source || source === "agentpowers") {
    lines.push("", `**Marketplace link:** ${SITE_ORIGIN}/skills/${skill.slug || slug}`);
  }

  return mkContent(lines.join("\n"));
}

async function getCategories() {
  const data = await apiV1("/categories");
  const categories = asArray(data.categories);
  if (!categories.length) return mkContent("No categories found.");

  const lines = [`${data.total_count ?? "Unknown"} skills across ${categories.length} categories:`];
  lines.push("");

  for (const category of categories) {
    const slug = category.category || "-";
    const name = category.name || slug;
    const count = category.count ?? 0;
    const keywords = category.sample_keywords || "-";
    lines.push(`- **${name}** (${slug}) — ${count} skills`);
    lines.push(`  keywords: ${keywords}`);
  }

  return mkContent(lines.join("\n"));
}

async function getSellerProfile(args = {}) {
  const sellerSlug = String(args.seller_slug || "").trim();
  if (!sellerSlug) return { isError: true, ...mkContent("Missing required argument: seller_slug") };

  const seller = await apiV1(`/sellers/${encodeURIComponent(sellerSlug)}`);
  const skills = asArray(seller.skills);

  const lines = [
    `# ${seller.display_name || sellerSlug}`,
    seller.bio ? `\n${seller.bio}` : "",
    "",
    `**Verified:** ${seller.verified ? "yes" : "no"}`,
    `**Total skills:** ${seller.total_skills ?? 0}`,
    `**Total downloads:** ${seller.total_downloads ?? 0}`,
    `**Joined:** ${seller.joined_at || "Unknown"}`,
  ];

  if (seller.website_url) lines.push(`**Website:** ${seller.website_url}`);
  if (seller.github_url) lines.push(`**GitHub:** ${seller.github_url}`);
  if (seller.linkedin_url) lines.push(`**LinkedIn:** ${seller.linkedin_url}`);
  if (seller.twitter_url) lines.push(`**Twitter:** ${seller.twitter_url}`);

  if (skills.length) {
    lines.push("", "## Published skills");
    for (const skill of skills) {
      lines.push(`- **${skill.title || skill.slug}** (${skill.slug}) — ${fmtPrice(skill.price_cents)} | downloads=${skill.download_count ?? 0}`);
    }
  }

  lines.push("", `**Profile:** ${SITE_ORIGIN}/sellers/${sellerSlug}`);
  return mkContent(lines.join("\n"));
}

async function getSkillReviews(args = {}) {
  const skillSlug = String(args.skill_slug || "").trim();
  if (!skillSlug) return { isError: true, ...mkContent("Missing required argument: skill_slug") };

  const limit = Math.max(1, Math.min(50, toNumber(args.limit, 10)));
  const data = await apiV1(`/skills/${encodeURIComponent(skillSlug)}/reviews?limit=${limit}`);
  const items = asArray(data.items);
  if (!items.length) return mkContent(`No reviews yet for ${skillSlug}.`);

  const avg = items.reduce((acc, review) => acc + (Number(review.rating) || 0), 0) / items.length;
  const lines = [`Reviews for ${skillSlug} (${data.total ?? items.length}, avg ${avg.toFixed(1)}/5):`, ""];

  for (const review of items) {
    const rating = Number(review.rating) || 0;
    const stars = `${"★".repeat(Math.max(0, Math.min(5, rating)))}${"☆".repeat(Math.max(0, 5 - rating))}`;
    lines.push(`- **${review.author_display_name || "Unknown"}** — ${stars} (${rating}/5)`);
    lines.push(`  ${review.text || ""}`);
  }

  return mkContent(lines.join("\n"));
}

async function getSecurityResults(args = {}) {
  const skillSlug = String(args.skill_slug || "").trim();
  if (!skillSlug) return { isError: true, ...mkContent("Missing required argument: skill_slug") };

  const data = await apiV1(`/security/results/${encodeURIComponent(skillSlug)}`);
  const findings = asArray(data.findings);

  const lines = [
    `# Security results for ${data.slug || skillSlug}`,
    "",
    `**Status:** ${data.status || "unknown"}`,
    `**Score:** ${data.score ?? "n/a"}`,
    `**Trust level:** ${data.trust_level || "n/a"}`,
    "",
  ];

  if (!findings.length) {
    lines.push("No findings reported.");
  } else {
    lines.push("## Findings");
    for (const finding of findings) {
      if (typeof finding === "string") {
        lines.push(`- ${finding}`);
      } else if (finding && typeof finding === "object") {
        lines.push(`- ${finding.message || finding.detail || finding.title || JSON.stringify(finding)}`);
      } else {
        lines.push(`- ${String(finding)}`);
      }
    }
  }

  return mkContent(lines.join("\n"));
}

async function getMarketplaceSnapshot() {
  const [health, skills, categories, sellers] = await Promise.all([
    apiRoot("/health"),
    apiV1("/skills?limit=1"),
    apiV1("/categories"),
    apiV1("/sellers?limit=1"),
  ]);

  const sample = asArray(skills.items)[0] || {};
  let authState = "not logged in";

  if (loadApiToken()) {
    try {
      const me = await apiV1("/auth/me", { authRequired: true });
      authState = `logged in as ${me.email || me.name || "unknown"}`;
    } catch {
      authState = "token present but invalid/expired";
    }
  }

  const lines = [
    "AgentPowers marketplace snapshot",
    "",
    `- API base: ${API_BASE}`,
    `- Health: ${health.status || "unknown"} (version ${health.version || "-"})`,
    `- Skills total: ${skills.total ?? "unknown"}`,
    `- Sample skill: ${sample.slug || "-"}`,
    `- Categories: ${asArray(categories.categories).length}`,
    `- Sellers total: ${sellers.total ?? "unknown"}`,
    `- Account: ${authState}`,
  ];

  return mkContent(lines.join("\n"));
}

function getPlatforms() {
  const lines = PLATFORMS.map((platform) => (
    `- **${platform.name}** (${platform.slug})\n  ${platform.tagline}\n  ${SITE_ORIGIN}/tools/${platform.slug}`
  ));
  return mkContent(`AgentPowers supports ${PLATFORMS.length} AI platforms:\n\n${lines.join("\n\n")}`);
}

async function getOpenApiSummary() {
  const spec = await httpJson(OPENAPI_URL, { authRequired: false });
  const paths = spec && typeof spec === "object" && spec.paths ? Object.keys(spec.paths) : [];
  const servers = spec && typeof spec === "object" && Array.isArray(spec.servers)
    ? spec.servers.map((s) => s.url).filter(Boolean)
    : [];

  const lines = [
    "# AgentPowers OpenAPI summary",
    "",
    `- OpenAPI: ${spec.openapi || "-"}`,
    `- Title: ${spec.info?.title || "-"}`,
    `- Version: ${spec.info?.version || "-"}`,
    `- Servers: ${servers.length ? servers.join(", ") : "-"}`,
    `- Path count: ${paths.length}`,
    "",
    "## Sample paths",
    ...paths.slice(0, 12).map((p) => `- ${p}`),
    "",
    `Spec URL: ${OPENAPI_URL}`,
  ];

  return mkContent(lines.join("\n"));
}

async function loginAccount(args = {}) {
  await ensureApAvailable();
  const timeoutSec = Math.max(30, Math.min(900, toNumber(args.timeout_sec, 240)));

  const result = await runAp(["login"], { timeoutMs: timeoutSec * 1000 });
  const output = formatCommandResult(result);

  if (result.code !== 0) {
    return {
      isError: true,
      ...mkContent(`Login failed.\n\n${output}`),
    };
  }

  let meLine = "";
  try {
    const me = await apiV1("/auth/me", { authRequired: true });
    meLine = `\n\nAuthenticated as: ${me.email || me.name || "unknown"}`;
  } catch {
    meLine = "\n\nLogin command completed, but account verification failed. Try whoami_account.";
  }

  return mkContent(`Login completed.\n\n${output}${meLine}`);
}

async function logoutAccount() {
  await ensureApAvailable();
  const result = await runAp(["logout"], { timeoutMs: 30_000 });
  const output = formatCommandResult(result);

  if (result.code !== 0) {
    return {
      isError: true,
      ...mkContent(`Logout failed.\n\n${output}`),
    };
  }

  return mkContent(`Logged out successfully.\n\n${output}`);
}

async function whoamiAccount() {
  await ensureApAvailable();
  const cli = await runAp(["whoami"], { timeoutMs: 30_000 });
  const cliOutput = formatCommandResult(cli);

  let apiOutput = "Not authenticated via API token.";
  if (loadApiToken()) {
    try {
      const me = await apiV1("/auth/me", { authRequired: true });
      apiOutput = JSON.stringify(me, null, 2);
    } catch (error) {
      apiOutput = `Auth check failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const lines = [
    "CLI whoami output:",
    cliOutput,
    "",
    "API /v1/auth/me output:",
    apiOutput,
  ];

  if (cli.code !== 0) {
    return {
      isError: true,
      ...mkContent(lines.join("\n")),
    };
  }

  return mkContent(lines.join("\n"));
}

async function getAccountProfile() {
  await ensureAuthenticated();
  const profile = await apiV1("/users/profile", { authRequired: true });

  const lines = [
    "# Account profile",
    "",
    `- Email: ${profile.email || "-"}`,
    `- Display name: ${profile.display_name || "-"}`,
    `- Seller slug: ${profile.display_name_slug || "-"}`,
    `- GitHub: ${profile.github_username || "-"}`,
    `- Joined: ${profile.joined_at || "-"}`,
    `- Account status: ${profile.account_status || "-"}`,
    `- Deletion scheduled at: ${profile.deletion_scheduled_at || "-"}`,
    "",
    "## Bio",
    profile.bio || "-",
  ];

  return mkContent(lines.join("\n"));
}

function formatPurchases(purchases) {
  if (!purchases.length) return "No purchases found.";

  const lines = [`Purchases: ${purchases.length}`, ""];
  for (const purchase of purchases) {
    const amount = typeof purchase.amount_cents === "number" ? fmtPrice(purchase.amount_cents) : "Unknown";
    const installedCmd = purchase.license_code
      ? `ap install ${purchase.skill_slug} --code ${purchase.license_code} --for codex`
      : null;

    lines.push(`- **${purchase.skill_title || purchase.skill_slug}** (${purchase.skill_slug})`);
    lines.push(`  status=${purchase.status} | amount=${amount} | purchased_at=${purchase.purchased_at || "-"}`);
    lines.push(`  purchase_id=${purchase.purchase_id}`);
    if (purchase.license_code) lines.push(`  license_code=${purchase.license_code}`);
    if (installedCmd) lines.push(`  install_cmd=${installedCmd}`);
  }

  return lines.join("\n");
}

async function listPurchases(args = {}) {
  await ensureAuthenticated();
  const statusFilter = String(args.status || "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(200, toNumber(args.limit, 100)));

  const raw = await apiV1("/purchases", { authRequired: true });
  let items = asArray(raw.items);

  if (statusFilter) {
    items = items.filter((item) => String(item.status || "").toLowerCase() === statusFilter);
  }

  items.sort((a, b) => String(b.purchased_at || "").localeCompare(String(a.purchased_at || "")));
  items = items.slice(0, limit);

  return mkContent(formatPurchases(items));
}

async function createCheckout(slug, options = {}) {
  await ensureAuthenticated();

  const successUrl = String(options.success_url || `${SITE_ORIGIN}/purchase/success`).trim();
  const cancelUrl = String(options.cancel_url || `${SITE_ORIGIN}/skills/${slug}`).trim();

  const payload = {
    skill_slug: slug,
    success_url: successUrl,
    cancel_url: cancelUrl,
  };

  const checkout = await apiV1("/checkout", {
    method: "POST",
    body: payload,
    authRequired: true,
  });

  rememberCheckout({
    purchase_id: checkout.purchase_id,
    slug,
    checkout_url: checkout.checkout_url,
    status: checkout.status || "pending",
    success_url: successUrl,
    cancel_url: cancelUrl,
    created_at: new Date().toISOString(),
  });

  return checkout;
}

async function startCheckout(args = {}) {
  const slug = String(args.slug || "").trim();
  if (!slug) return { isError: true, ...mkContent("Missing required argument: slug") };

  const checkout = await createCheckout(slug, args);
  const autoOpen = toBool(args.auto_open_browser, true);

  let browserLine = "";
  if (autoOpen && checkout.checkout_url) {
    const openResult = await openInBrowser(checkout.checkout_url);
    browserLine = openResult.ok
      ? `Opened browser with: ${openResult.command}`
      : `Could not auto-open browser (${openResult.command}). Open manually: ${checkout.checkout_url}`;
  }

  const lines = [
    "Checkout created.",
    `purchase_id: ${checkout.purchase_id}`,
    `status: ${checkout.status || "pending"}`,
    `checkout_url: ${checkout.checkout_url}`,
  ];

  if (browserLine) lines.push(browserLine);
  lines.push("Next: run check_purchase_status with this purchase_id.");

  return mkContent(lines.join("\n"));
}

async function pollPurchaseStatus(args = {}) {
  const purchaseId = String(args.purchase_id || "").trim();
  const sessionId = String(args.session_id || "").trim();

  if (!purchaseId && !sessionId) {
    throw new Error("Provide purchase_id or session_id.");
  }

  if (!sessionId) {
    await ensureAuthenticated();
  }

  const waitForCompletion = toBool(args.wait_for_completion, false);
  const timeoutSec = Math.max(10, Math.min(1800, toNumber(args.timeout_sec, 300)));
  const pollSec = Math.max(2, Math.min(30, toNumber(args.poll_interval_sec, 5)));

  const started = Date.now();

  async function readStatus() {
    if (sessionId) {
      return apiV1(`/purchases/confirm?session_id=${encodeURIComponent(sessionId)}`, { authRequired: false });
    }
    return apiV1(`/purchases/${encodeURIComponent(purchaseId)}/status`, { authRequired: true });
  }

  let status = await readStatus();

  while (waitForCompletion && String(status.status || "").toLowerCase() === "pending") {
    if ((Date.now() - started) / 1000 >= timeoutSec) break;
    await sleep(pollSec * 1000);
    status = await readStatus();
  }

  if (status.purchase_id) {
    rememberCheckout({
      purchase_id: status.purchase_id,
      slug: status.skill_slug,
      status: status.status,
      license_code: status.license_code || null,
      purchased_at: status.purchased_at || null,
    });
  }

  return status;
}

async function fetchPurchasedDownload(sessionId) {
  return apiV1(`/purchases/download?session_id=${encodeURIComponent(sessionId)}`, { authRequired: false });
}

function isUnknownToolInstallError(output) {
  const normalized = String(output || "").toLowerCase();
  return normalized.includes("unknown tool")
    || normalized.includes("invalid value for '--for'");
}

function isTransientInstallError(output) {
  const normalized = String(output || "").toLowerCase();
  return normalized.includes("timed out")
    || normalized.includes("timeout")
    || normalized.includes("connection reset")
    || normalized.includes("temporarily unavailable");
}

async function installViaMirrorFallback(slug, licenseCode, targetTool, options = {}) {
  const source = String(options.source || "").trim();
  const globalInstall = toBool(options.global, false);
  const timeoutMs = Math.max(30_000, toNumber(options.timeout_ms, 300_000));
  const bridgeTool = "codex";

  const beforeEntries = getToolInstallEntries(bridgeTool, slug);
  const bridgeArgs = ["install", slug, "--for", bridgeTool];
  if (licenseCode) bridgeArgs.push("--code", licenseCode);
  if (source) bridgeArgs.push("--source", source);
  if (globalInstall) bridgeArgs.push("--global");

  const retryAttempts = Math.max(1, Math.min(3, toNumber(options.fallback_retry_attempts, 2)));
  let bridgeResult = null;
  let bridgeOutput = "";
  let attempt = 0;

  while (attempt < retryAttempts) {
    attempt += 1;
    bridgeResult = await runAp(bridgeArgs, { timeoutMs });
    bridgeOutput = formatCommandResult(bridgeResult);

    if (bridgeResult.code === 0) break;
    if (attempt >= retryAttempts || !isTransientInstallError(bridgeOutput)) {
      throw new Error(`Install fallback failed while installing for '${bridgeTool}'.\n\n${bridgeOutput}`);
    }
    await sleep(1500);
  }

  const afterEntries = getToolInstallEntries(bridgeTool, slug);
  if (!afterEntries.length) {
    throw new Error(
      `Install fallback could not locate ${slug} under ${getGlobalToolRoot(bridgeTool)} after install.`,
    );
  }

  const beforeSet = new Set(beforeEntries.map((entry) => entry.install_path));
  const freshEntries = afterEntries.filter((entry) => !beforeSet.has(entry.install_path));
  const entriesToCopy = freshEntries.length ? freshEntries : afterEntries;

  const targetRoot = getGlobalToolRoot(targetTool);
  const mirroredPaths = [];
  for (const entry of entriesToCopy) {
    const targetPath = path.join(targetRoot, entry.kind, slug);
    if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.cpSync(entry.install_path, targetPath, { recursive: true });
    mirroredPaths.push(targetPath);
  }

  const cleanupPaths = [];
  for (const entry of freshEntries) {
    if (!fs.existsSync(entry.install_path)) continue;
    fs.rmSync(entry.install_path, { recursive: true, force: true });
    cleanupPaths.push(entry.install_path);
  }

  const lines = [
    `Compatibility install fallback used for target_tool='${targetTool}'.`,
    `Bridge attempts: ${attempt}/${retryAttempts}.`,
    `Mirrored ${slug} from '${bridgeTool}' into '${targetTool}' paths:`,
    ...mirroredPaths.map((item) => `- ${item}`),
  ];

  if (cleanupPaths.length) {
    lines.push("Removed temporary bridge install paths:");
    for (const item of cleanupPaths) lines.push(`- ${item}`);
  }

  lines.push("", `Bridge install output (${bridgeTool}):`, bridgeOutput);
  return lines.join("\n");
}

function buildInstallCommand(skillSlug, licenseCode, options = {}) {
  const targetTool = resolveTargetTool(
    options.target_tool || options.for_tool || process.env.AGENTPOWERS_DEFAULT_TOOL || "codex",
    "codex",
    false,
  );
  const source = String(options.source || "").trim();
  const globalInstall = toBool(options.global, false);

  const parts = ["ap", "install", skillSlug];
  if (licenseCode) parts.push("--code", licenseCode);
  parts.push("--for", targetTool);
  if (source) parts.push("--source", source);
  if (globalInstall) parts.push("--global");
  return parts.join(" ");
}

async function downloadPurchasedSkillFiles(args = {}) {
  const sessionId = String(args.session_id || "").trim();
  if (!sessionId) return { isError: true, ...mkContent("Missing required argument: session_id") };

  const download = await fetchPurchasedDownload(sessionId);
  const downloadUrl = download.url || download.download_url;

  if (!downloadUrl) {
    return { isError: true, ...mkContent("Purchase download endpoint returned no URL.") };
  }

  const lines = [
    "Purchased files download ready.",
    `skill_slug: ${download.slug || "-"}`,
    `download_url: ${downloadUrl}`,
  ];

  if (toBool(args.auto_open_browser, true)) {
    const openResult = await openInBrowser(downloadUrl);
    if (openResult.ok) {
      lines.push(`Opened browser with: ${openResult.command}`);
    } else {
      lines.push(`Could not auto-open browser (${openResult.command}). Open manually: ${downloadUrl}`);
    }
  }

  return mkContent(lines.join("\n"));
}

async function confirmPurchaseSession(args = {}) {
  const sessionId = String(args.session_id || "").trim();
  if (!sessionId) return { isError: true, ...mkContent("Missing required argument: session_id") };

  const status = await pollPurchaseStatus({
    session_id: sessionId,
    wait_for_completion: args.wait_for_completion,
    timeout_sec: args.timeout_sec,
    poll_interval_sec: args.poll_interval_sec,
  });

  const lines = [
    "Checkout session status:",
    `purchase_id: ${status.purchase_id || "-"}`,
    `skill_slug: ${status.skill_slug || "-"}`,
    `status: ${status.status || "unknown"}`,
    `license_code: ${status.license_code || "-"}`,
    `purchased_at: ${status.purchased_at || "-"}`,
  ];

  if (status.skill_slug && status.license_code) {
    lines.push(`install_command: ${buildInstallCommand(status.skill_slug, status.license_code, args)}`);
  }

  const includeDownloadUrl = toBool(args.include_download_url, true);
  if (includeDownloadUrl && String(status.status || "").toLowerCase() === "completed") {
    try {
      const download = await fetchPurchasedDownload(sessionId);
      const downloadUrl = download.url || download.download_url;
      if (downloadUrl) {
        lines.push(`download_url: ${downloadUrl}`);

        if (toBool(args.auto_open_browser, false)) {
          const openResult = await openInBrowser(downloadUrl);
          if (openResult.ok) {
            lines.push(`Opened browser with: ${openResult.command}`);
          } else {
            lines.push(`Could not auto-open browser (${openResult.command}). Open manually: ${downloadUrl}`);
          }
        }
      } else {
        lines.push("download_url: unavailable");
      }
    } catch (error) {
      lines.push(`download_url: unavailable (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  if (toBool(args.auto_install, false) && String(status.status || "").toLowerCase() === "completed") {
    if (!status.skill_slug || !status.license_code) {
      lines.push("Auto-install skipped: missing skill_slug or license_code.");
    } else {
      try {
        const installOutput = await runInstallWithLicense(status.skill_slug, status.license_code, args);
        lines.push("", "Auto-install completed:", installOutput);
      } catch (error) {
        lines.push("", `Auto-install failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return mkContent(lines.join("\n"));
}

async function runInstallWithLicense(slug, licenseCode, options = {}) {
  await ensureApAvailable();

  const targetTool = resolveTargetTool(
    options.target_tool || options.for_tool || process.env.AGENTPOWERS_DEFAULT_TOOL || "codex",
    "codex",
    false,
  );
  const source = String(options.source || "").trim();
  const globalInstall = toBool(options.global, false);

  const args = ["install", slug, "--for", targetTool];
  if (licenseCode) args.push("--code", licenseCode);
  if (source) args.push("--source", source);
  if (globalInstall) args.push("--global");

  const result = await runAp(args, { timeoutMs: Math.max(30_000, toNumber(options.timeout_ms, 300_000)) });
  const output = formatCommandResult(result);

  if (result.code !== 0) {
    if (!CLI_PRIMARY_SUPPORTED_TOOLS.has(targetTool) && isUnknownToolInstallError(output)) {
      const fallbackOutput = await installViaMirrorFallback(slug, licenseCode, targetTool, options);
      return [
        fallbackOutput,
        "",
        "Primary CLI target install failed first; fallback was applied successfully.",
        `Primary CLI output (${targetTool}):`,
        output,
      ].join("\n");
    }
    throw new Error(`Install failed.\n\n${output}`);
  }

  return output;
}

async function installPurchasedSkill(args = {}) {
  const purchaseId = String(args.purchase_id || "").trim();
  const sessionId = String(args.session_id || "").trim();
  const skillSlug = String(args.skill_slug || "").trim();
  let licenseCode = String(args.license_code || "").trim() || null;
  let resolvedSlug = skillSlug || null;

  if (sessionId) {
    const status = await apiV1(`/purchases/confirm?session_id=${encodeURIComponent(sessionId)}`, { authRequired: false });
    if (String(status.status || "").toLowerCase() !== "completed") {
      return mkContent(`Checkout session ${sessionId} is ${status.status || "unknown"}. Complete payment first.`);
    }
    resolvedSlug = status.skill_slug || resolvedSlug;
    licenseCode = status.license_code || licenseCode;
  }

  if (purchaseId) {
    await ensureAuthenticated();
    const status = await apiV1(`/purchases/${encodeURIComponent(purchaseId)}/status`, { authRequired: true });
    if (String(status.status || "").toLowerCase() !== "completed") {
      return mkContent(`Purchase ${purchaseId} is ${status.status || "unknown"}. Complete payment first.`);
    }
    resolvedSlug = status.skill_slug || resolvedSlug;
    licenseCode = status.license_code || licenseCode;
  }

  if (!resolvedSlug) {
    return { isError: true, ...mkContent("Provide session_id, purchase_id, or skill_slug.") };
  }

  if (!licenseCode) {
    await ensureAuthenticated();
    const purchasesRaw = await apiV1("/purchases", { authRequired: true });
    const purchases = asArray(purchasesRaw.items)
      .filter((item) => item.skill_slug === resolvedSlug && String(item.status).toLowerCase() === "completed")
      .sort((a, b) => String(b.purchased_at || "").localeCompare(String(a.purchased_at || "")));

    if (purchases[0]?.license_code) {
      licenseCode = purchases[0].license_code;
    }
  }

  if (!licenseCode) {
    return {
      isError: true,
      ...mkContent(`No license code found for ${resolvedSlug}. If needed, regenerate from website/dashboard then retry.`),
    };
  }

  const output = await runInstallWithLicense(resolvedSlug, licenseCode, args);
  return mkContent(`Installed ${resolvedSlug} using your purchase license.\n\n${output}`);
}

async function checkPurchaseStatus(args = {}) {
  const status = await pollPurchaseStatus(args);
  const autoInstall = toBool(args.auto_install, false);
  const sessionId = String(args.session_id || "").trim();

  const lines = [
    `purchase_id: ${status.purchase_id || "-"}`,
    `skill_slug: ${status.skill_slug || "-"}`,
    `status: ${status.status || "unknown"}`,
    `license_code: ${status.license_code || "-"}`,
    `purchased_at: ${status.purchased_at || "-"}`,
  ];

  if (status.skill_slug && status.license_code) {
    lines.push(`install_command: ${buildInstallCommand(status.skill_slug, status.license_code, args)}`);
  }

  const includeDownloadUrl = toBool(args.include_download_url, false);
  if (includeDownloadUrl && sessionId && String(status.status || "").toLowerCase() === "completed") {
    try {
      const download = await fetchPurchasedDownload(sessionId);
      const downloadUrl = download.url || download.download_url;
      if (downloadUrl) {
        lines.push(`download_url: ${downloadUrl}`);
      } else {
        lines.push("download_url: unavailable");
      }
    } catch (error) {
      lines.push(`download_url: unavailable (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  if (autoInstall && String(status.status || "").toLowerCase() === "completed") {
    if (!status.skill_slug || !status.license_code) {
      lines.push("Auto-install skipped: missing skill_slug or license_code.");
    } else {
      try {
        const installOutput = await runInstallWithLicense(status.skill_slug, status.license_code, args);
        lines.push("", "Auto-install completed:", installOutput);
      } catch (error) {
        lines.push("", `Auto-install failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return mkContent(lines.join("\n"));
}

async function installSkill(args = {}) {
  const slug = String(args.slug || "").trim();
  if (!slug) return { isError: true, ...mkContent("Missing required argument: slug") };

  const source = String(args.source || "").trim();
  const explicitCode = String(args.license_code || args.code || "").trim();

  if (explicitCode) {
    const output = await runInstallWithLicense(slug, explicitCode, args);
    return mkContent(`Installed ${slug} with provided license code.\n\n${output}`);
  }

  const qs = source ? `?source=${encodeURIComponent(source)}` : "";
  const detail = await apiV1(`/detail/${encodeURIComponent(slug)}${qs}`);
  const priceCents = Number(detail.price_cents || 0);

  if (priceCents <= 0) {
    const output = await runInstallWithLicense(slug, null, args);
    return mkContent(`Installed free skill ${slug}.\n\n${output}`);
  }

  await ensureAuthenticated();

  const purchasesRaw = await apiV1("/purchases", { authRequired: true });
  const existing = asArray(purchasesRaw.items)
    .filter((item) => item.skill_slug === slug && String(item.status || "").toLowerCase() === "completed" && item.license_code)
    .sort((a, b) => String(b.purchased_at || "").localeCompare(String(a.purchased_at || "")))[0];

  if (existing?.license_code) {
    const output = await runInstallWithLicense(slug, existing.license_code, args);
    return mkContent(`Skill ${slug} is already purchased. Installed using saved license.\n\n${output}`);
  }

  const checkout = await createCheckout(slug, args);
  const autoOpen = toBool(args.auto_open_browser, true);
  const waitForCompletion = toBool(args.wait_for_completion, true);

  const lines = [
    `Created checkout for paid skill ${slug}.`,
    `purchase_id: ${checkout.purchase_id}`,
    `checkout_url: ${checkout.checkout_url}`,
  ];

  if (autoOpen && checkout.checkout_url) {
    const openResult = await openInBrowser(checkout.checkout_url);
    if (openResult.ok) {
      lines.push(`Opened browser with: ${openResult.command}`);
    } else {
      lines.push(`Could not auto-open browser (${openResult.command}). Open manually: ${checkout.checkout_url}`);
    }
  }

  if (!waitForCompletion) {
    lines.push("Payment not polled. Run check_purchase_status with the purchase_id after checkout.");
    return mkContent(lines.join("\n"));
  }

  const status = await pollPurchaseStatus({
    purchase_id: checkout.purchase_id,
    wait_for_completion: true,
    timeout_sec: args.timeout_sec,
    poll_interval_sec: args.poll_interval_sec,
  });

  lines.push(`Final status: ${status.status || "unknown"}`);

  if (String(status.status || "").toLowerCase() === "completed" && status.license_code) {
    try {
      const installOutput = await runInstallWithLicense(slug, status.license_code, args);
      lines.push("Install completed:");
      lines.push(installOutput);
    } catch (error) {
      lines.push(`Install failed after checkout: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    lines.push("Checkout not completed yet. Re-run check_purchase_status later.");
  }

  return mkContent(lines.join("\n"));
}

async function checkInstalled(args = {}) {
  const targetTool = resolveTargetTool(args.target_tool || args.for_tool || "all", "all", true);
  const entries = collectInstalledEntries({ includeHashCheck: true });

  const filtered = targetTool === "all"
    ? entries
    : entries.filter((entry) => entry.tool === targetTool);

  return mkContent(formatInstalledEntries(filtered));
}

function removeDirectoryIfExists(dirPath, removed) {
  if (!fs.existsSync(dirPath)) return;
  fs.rmSync(dirPath, { recursive: true, force: true });
  removed.push(dirPath);
}

async function uninstallSkill(args = {}) {
  const slug = String(args.slug || "").trim();
  if (!slug) return { isError: true, ...mkContent("Missing required argument: slug") };

  const targetTool = resolveTargetTool(args.target_tool || args.for_tool || "codex", "codex", true);
  const removed = [];

  const selectedTools = targetTool === "all" ? INSTALL_TARGETS : [targetTool];
  const toolRoots = selectedTools.map((tool) => path.join(os.homedir(), toolConfigDirName(tool)));

  if (selectedTools.includes("claude-code")) {
    const projectClaude = path.join(process.cwd(), ".claude");
    if (fs.existsSync(projectClaude)) toolRoots.push(projectClaude);
  }

  for (const root of toolRoots) {
    removeDirectoryIfExists(path.join(root, "skills", slug), removed);
    removeDirectoryIfExists(path.join(root, "agents", slug), removed);
  }

  const pinRemoved = removePin(slug);

  if (!removed.length && !pinRemoved) {
    return {
      isError: true,
      ...mkContent(`No installation found for ${slug} in target_tool=${targetTool}.`),
    };
  }

  const lines = [`Uninstalled ${slug}.`];
  if (removed.length) {
    lines.push("Removed paths:");
    for (const item of removed) lines.push(`- ${item}`);
  }
  lines.push(`Pin removed: ${pinRemoved ? "yes" : "no"}`);

  return mkContent(lines.join("\n"));
}

async function checkForUpdates(args = {}) {
  const targetTool = resolveTargetTool(args.target_tool || args.for_tool || "all", "all", true);
  const entries = collectInstalledEntries({ includeHashCheck: true });
  const filtered = targetTool === "all"
    ? entries
    : entries.filter((entry) => entry.tool === targetTool);

  if (!filtered.length) {
    return mkContent("No installed skills/agents found to check for updates.");
  }

  const bySlug = new Map();
  for (const entry of filtered) {
    if (!bySlug.has(entry.slug)) bySlug.set(entry.slug, entry);
  }

  const outdated = [];
  const upToDate = [];
  const unknown = [];

  for (const entry of bySlug.values()) {
    const source = String(entry.source || "local").toLowerCase();
    const installedVersion = entry.version;

    if (!installedVersion || source === "local") {
      unknown.push({
        slug: entry.slug,
        reason: "No pinned marketplace version/source",
        source,
      });
      continue;
    }

    try {
      const qs = source !== "agentpowers" ? `?source=${encodeURIComponent(source)}` : "";
      const detail = await apiV1(`/detail/${encodeURIComponent(entry.slug)}${qs}`);
      const latestVersion = detail.version || null;

      if (!latestVersion) {
        unknown.push({ slug: entry.slug, reason: "Latest version unavailable", source });
        continue;
      }

      const cmp = compareSemver(installedVersion, latestVersion);
      if (cmp === null) {
        unknown.push({
          slug: entry.slug,
          reason: `Cannot compare versions (${installedVersion} vs ${latestVersion})`,
          source,
        });
      } else if (cmp < 0) {
        outdated.push({
          slug: entry.slug,
          source,
          installed: installedVersion,
          latest: latestVersion,
          edited: entry.edited,
        });
      } else {
        upToDate.push({
          slug: entry.slug,
          source,
          installed: installedVersion,
          latest: latestVersion,
          edited: entry.edited,
        });
      }
    } catch (error) {
      unknown.push({
        slug: entry.slug,
        reason: error instanceof Error ? error.message : String(error),
        source,
      });
    }
  }

  const lines = [
    `Update check results (${targetTool}):`,
    `- Outdated: ${outdated.length}`,
    `- Up to date: ${upToDate.length}`,
    `- Unknown: ${unknown.length}`,
    "",
  ];

  if (outdated.length) {
    lines.push("## Outdated");
    for (const item of outdated) {
      const edited = item.edited === null ? "unknown" : item.edited ? "yes" : "no";
      lines.push(`- ${item.slug} (${item.source}) installed=${item.installed} latest=${item.latest} edited=${edited}`);
      lines.push(`  Suggested: ap update ${item.slug}`);
    }
    lines.push("");
  }

  if (upToDate.length) {
    lines.push("## Up to date");
    for (const item of upToDate) {
      const edited = item.edited === null ? "unknown" : item.edited ? "yes" : "no";
      lines.push(`- ${item.slug} (${item.source}) version=${item.installed} edited=${edited}`);
    }
    lines.push("");
  }

  if (unknown.length) {
    lines.push("## Unknown");
    for (const item of unknown) {
      lines.push(`- ${item.slug} (${item.source}): ${item.reason}`);
    }
  }

  return mkContent(lines.join("\n"));
}

const TOOL_DEFS = [
  {
    name: "search_marketplace",
    description: "Search AgentPowers marketplace skills/agents across native and external sources.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keywords" },
        category: { type: "string", description: "Category slug" },
        type: { type: "string", enum: ["skill", "agent"] },
        limit: { type: "number", description: "Result limit (1-50)" },
      },
    },
    handler: searchMarketplace,
  },
  {
    name: "get_skill_details",
    description: "Get detailed metadata for a skill or agent slug.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        source: { type: "string", description: "Optional source override (for external sources)" },
      },
      required: ["slug"],
    },
    handler: getSkillDetails,
  },
  {
    name: "login_account",
    description: "Run browser-based AgentPowers login (equivalent to `ap login`).",
    inputSchema: {
      type: "object",
      properties: {
        timeout_sec: { type: "number", description: "Login timeout in seconds (default 240)" },
      },
    },
    handler: loginAccount,
  },
  {
    name: "logout_account",
    description: "Log out from AgentPowers account (equivalent to `ap logout`).",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: logoutAccount,
  },
  {
    name: "whoami_account",
    description: "Show current account identity from CLI and API.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: whoamiAccount,
  },
  {
    name: "get_account_profile",
    description: "Fetch authenticated account profile from AgentPowers.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: getAccountProfile,
  },
  {
    name: "list_purchases",
    description: "List your purchases, licenses, and install commands.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Optional status filter (completed/pending/failed/refunded)" },
        limit: { type: "number", description: "Maximum records (default 100)" },
      },
    },
    handler: listPurchases,
  },
  {
    name: "start_checkout",
    description: "Create checkout session for a paid skill and open payment page.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        auto_open_browser: { type: "boolean", description: "Open checkout URL in browser (default true)" },
        success_url: { type: "string" },
        cancel_url: { type: "string" },
      },
      required: ["slug"],
    },
    handler: startCheckout,
  },
  {
    name: "check_purchase_status",
    description: "Check purchase status by purchase_id/session_id; optionally wait and auto-install on completion.",
    inputSchema: {
      type: "object",
      properties: {
        purchase_id: { type: "string" },
        session_id: { type: "string" },
        wait_for_completion: { type: "boolean" },
        timeout_sec: { type: "number" },
        poll_interval_sec: { type: "number" },
        auto_install: { type: "boolean" },
        include_download_url: { type: "boolean", description: "When session_id is provided and status is completed, also fetch download URL." },
        target_tool: { type: "string", enum: INSTALL_TARGETS },
        source: { type: "string" },
      },
    },
    handler: checkPurchaseStatus,
  },
  {
    name: "confirm_purchase_session",
    description: "Frontend-style purchase confirmation by Stripe session_id with optional download URL and auto-install.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        wait_for_completion: { type: "boolean" },
        timeout_sec: { type: "number" },
        poll_interval_sec: { type: "number" },
        include_download_url: { type: "boolean" },
        auto_open_browser: { type: "boolean", description: "Open download URL in browser when available (default false)." },
        auto_install: { type: "boolean" },
        target_tool: { type: "string", enum: INSTALL_TARGETS },
        source: { type: "string" },
        global: { type: "boolean" },
      },
      required: ["session_id"],
    },
    handler: confirmPurchaseSession,
  },
  {
    name: "download_purchased_skill",
    description: "Get purchased-skill package download URL by checkout session_id, and optionally open it.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        auto_open_browser: { type: "boolean", description: "Open download URL in browser (default true)." },
      },
      required: ["session_id"],
    },
    handler: downloadPurchasedSkillFiles,
  },
  {
    name: "install_skill",
    description: "Install a skill with full automation: free install, paid checkout, polling, and final install.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        target_tool: { type: "string", enum: INSTALL_TARGETS },
        source: { type: "string", description: "Optional external source" },
        license_code: { type: "string", description: "Optional explicit license code" },
        auto_open_browser: { type: "boolean" },
        wait_for_completion: { type: "boolean" },
        timeout_sec: { type: "number" },
        poll_interval_sec: { type: "number" },
        global: { type: "boolean", description: "Force global install location" },
      },
      required: ["slug"],
    },
    handler: installSkill,
  },
  {
    name: "install_purchased_skill",
    description: "Install a previously purchased skill using session_id, purchase_id, or skill_slug.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        purchase_id: { type: "string" },
        skill_slug: { type: "string" },
        license_code: { type: "string" },
        target_tool: { type: "string", enum: INSTALL_TARGETS },
        source: { type: "string" },
      },
    },
    handler: installPurchasedSkill,
  },
  {
    name: "check_installed",
    description: "List installed skills/agents for codex and claude roots, with version/source/edit signal.",
    inputSchema: {
      type: "object",
      properties: {
        target_tool: { type: "string", enum: INSTALL_TARGETS_WITH_ALL },
      },
    },
    handler: checkInstalled,
  },
  {
    name: "uninstall_skill",
    description: "Uninstall a skill/agent from codex/claude locations and remove pin metadata.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        target_tool: { type: "string", enum: INSTALL_TARGETS_WITH_ALL },
      },
      required: ["slug"],
    },
    handler: uninstallSkill,
  },
  {
    name: "check_for_updates",
    description: "Check installed marketplace skills for newer versions without applying updates.",
    inputSchema: {
      type: "object",
      properties: {
        target_tool: { type: "string", enum: INSTALL_TARGETS_WITH_ALL },
      },
    },
    handler: checkForUpdates,
  },

  // Compatibility + discovery tools
  {
    name: "search_skills",
    description: "Compatibility alias for search_marketplace.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        category: { type: "string" },
        type: { type: "string", enum: ["skill", "agent"] },
        limit: { type: "number" },
      },
    },
    handler: searchMarketplace,
  },
  {
    name: "get_categories",
    description: "List marketplace categories and counts.",
    inputSchema: { type: "object", properties: {} },
    handler: getCategories,
  },
  {
    name: "get_seller_profile",
    description: "Get seller public profile and published skills.",
    inputSchema: {
      type: "object",
      properties: {
        seller_slug: { type: "string" },
      },
      required: ["seller_slug"],
    },
    handler: getSellerProfile,
  },
  {
    name: "get_skill_reviews",
    description: "Get reviews for a skill slug.",
    inputSchema: {
      type: "object",
      properties: {
        skill_slug: { type: "string" },
        limit: { type: "number" },
      },
      required: ["skill_slug"],
    },
    handler: getSkillReviews,
  },
  {
    name: "get_security_results",
    description: "Get security scan results for a skill slug.",
    inputSchema: {
      type: "object",
      properties: {
        skill_slug: { type: "string" },
      },
      required: ["skill_slug"],
    },
    handler: getSecurityResults,
  },
  {
    name: "get_marketplace_snapshot",
    description: "Get API/account snapshot for quick health checks.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: getMarketplaceSnapshot,
  },
  {
    name: "get_platforms",
    description: "List AI platforms supported by AgentPowers.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: getPlatforms,
  },
  {
    name: "get_openapi_summary",
    description: "Summarize the AgentPowers OpenAPI spec.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: getOpenApiSummary,
  },
];

const TOOL_MAP = new Map(TOOL_DEFS.map((tool) => [tool.name, tool]));

const RESOURCE_DEFS = [
  {
    uri: "agentpowers://marketplace/snapshot",
    name: "marketplace_snapshot",
    description: "Live API/account snapshot for marketplace integration.",
    mimeType: "text/plain",
  },
  {
    uri: "agentpowers://account/purchases",
    name: "purchase_snapshot",
    description: "Current purchase list (requires auth).",
    mimeType: "text/plain",
  },
  {
    uri: "agentpowers://docs/openapi-summary",
    name: "openapi_summary",
    description: "Summary of the AgentPowers OpenAPI schema.",
    mimeType: "text/plain",
  },
];

const PROMPT_DEFS = [
  {
    name: "find_skill_for_task",
    description: "Find and compare the best marketplace skill for a task.",
    arguments: [
      { name: "task", required: true, description: "Task the user wants to solve." },
    ],
  },
  {
    name: "buy_and_install_skill",
    description: "Run full login -> checkout -> install workflow for a paid skill.",
    arguments: [
      { name: "slug", required: true, description: "Skill slug to purchase and install." },
      { name: "tool", required: false, description: "Target tool, default codex." },
    ],
  },
];

function makePromptMessages(name, args = {}) {
  if (name === "buy_and_install_skill") {
    const slug = args.slug || "<skill-slug>";
    const tool = args.tool || "codex";
    return [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            `Help me buy and install ${slug} for ${tool}.`,
            "",
            "Please do this sequence:",
            "1. Run whoami_account (or login_account if needed)",
            "2. Run install_skill with wait_for_completion=true and target_tool set",
            "3. If checkout is still pending, run check_purchase_status until completed",
            "4. Confirm install path and command output",
          ].join("\n"),
        },
      },
    ];
  }

  const task = args.task || "the user request";
  return [
    {
      role: "user",
      content: {
        type: "text",
        text: [
          `I need the best AgentPowers marketplace skill for: ${task}`,
          "",
          "Please:",
          "1. Use search_marketplace",
          "2. Use get_skill_details on top candidates",
          "3. Use get_skill_reviews and get_security_results",
          "4. Recommend one skill and provide install command",
        ].join("\n"),
      },
    },
  ];
}

function sendMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
  process.stdout.write(payload);
}

function sendResponse(id, result) {
  sendMessage({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message, data) {
  sendMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  });
}

async function handleRequest(message) {
  const id = message.id;
  const method = message.method;
  const params = message.params || {};

  switch (method) {
    case "initialize": {
      sendResponse(id, {
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
        serverInfo: SERVER_INFO,
      });
      return;
    }
    case "notifications/initialized": {
      return;
    }
    case "ping": {
      sendResponse(id, {});
      return;
    }
    case "tools/list": {
      sendResponse(id, {
        tools: TOOL_DEFS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
      return;
    }
    case "tools/call": {
      const name = params.name;
      const args = params.arguments || {};
      const tool = TOOL_MAP.get(name);

      if (!tool) {
        sendResponse(id, { isError: true, ...mkContent(`Unknown tool: ${name}`) });
        return;
      }

      try {
        const output = await tool.handler(args);
        sendResponse(id, output);
      } catch (error) {
        sendResponse(id, {
          isError: true,
          ...mkContent(`Tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`),
        });
      }
      return;
    }
    case "resources/list": {
      sendResponse(id, { resources: RESOURCE_DEFS });
      return;
    }
    case "resources/read": {
      const uri = String(params.uri || "");
      let text;

      if (uri === "agentpowers://marketplace/snapshot") {
        text = (await getMarketplaceSnapshot()).content[0].text;
      } else if (uri === "agentpowers://account/purchases") {
        text = (await listPurchases({ limit: 100 })).content[0].text;
      } else if (uri === "agentpowers://docs/openapi-summary") {
        text = (await getOpenApiSummary()).content[0].text;
      } else {
        sendError(id, -32602, `Unknown resource URI: ${uri}`);
        return;
      }

      sendResponse(id, {
        contents: [
          {
            uri,
            mimeType: "text/plain",
            text,
          },
        ],
      });
      return;
    }
    case "prompts/list": {
      sendResponse(id, { prompts: PROMPT_DEFS });
      return;
    }
    case "prompts/get": {
      const promptName = String(params.name || "");
      if (!PROMPT_DEFS.some((p) => p.name === promptName)) {
        sendError(id, -32602, `Unknown prompt: ${promptName}`);
        return;
      }

      sendResponse(id, {
        messages: makePromptMessages(promptName, params.arguments || {}),
      });
      return;
    }
    default: {
      sendError(id, -32601, `Method not found: ${method}`);
    }
  }
}

function findHeaderTerminator(buffer) {
  const crlf = buffer.indexOf("\r\n\r\n");
  if (crlf !== -1) return { index: crlf, size: 4 };
  const lf = buffer.indexOf("\n\n");
  if (lf !== -1) return { index: lf, size: 2 };
  return null;
}

let inputBuffer = Buffer.alloc(0);

function parseMessages() {
  while (true) {
    const headerPos = findHeaderTerminator(inputBuffer);
    if (!headerPos) return;

    const rawHeaders = inputBuffer.slice(0, headerPos.index).toString("utf8");
    const lengthMatch = rawHeaders.match(/content-length:\s*(\d+)/i);

    if (!lengthMatch) {
      inputBuffer = inputBuffer.slice(headerPos.index + headerPos.size);
      continue;
    }

    const contentLength = Number(lengthMatch[1]);
    const bodyStart = headerPos.index + headerPos.size;
    const bodyEnd = bodyStart + contentLength;

    if (inputBuffer.length < bodyEnd) return;

    const rawBody = inputBuffer.slice(bodyStart, bodyEnd).toString("utf8");
    inputBuffer = inputBuffer.slice(bodyEnd);

    let message;
    try {
      message = JSON.parse(rawBody);
    } catch (error) {
      process.stderr.write(`Invalid JSON payload: ${error instanceof Error ? error.message : String(error)}\n`);
      continue;
    }

    const hasId = Object.prototype.hasOwnProperty.call(message, "id");
    if (!hasId && message.method === "notifications/initialized") {
      continue;
    }

    handleRequest(message).catch((error) => {
      if (hasId) {
        sendError(message.id, -32000, error instanceof Error ? error.message : String(error));
      }
    });
  }
}

async function runSelfTest() {
  try {
    await ensureApAvailable();
    const [health, categories] = await Promise.all([
      apiRoot("/health"),
      apiV1("/categories"),
    ]);

    const checkoutCount = listCheckoutRecords().length;
    console.log(
      `self-test ok | api=${API_BASE} | health=${health.status || "unknown"} | categories=${asArray(categories.categories).length} | checkouts=${checkoutCount}`,
    );
    return 0;
  } catch (error) {
    console.error(`self-test failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv.includes("--self-test")) {
  const code = await runSelfTest();
  process.exit(code);
}

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  parseMessages();
});

process.stdin.on("end", () => {
  process.exit(0);
});
