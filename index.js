import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

const DEFAULT_AGENT_ID = "main";
const PROVIDER_ID = "openai-codex";
const COMMAND_LIST = "codex_list";
const ACTION_ADD = "add";
const COMMAND_ADD_CODEX = "codexadd";
const COMMAND_VERIFY_CODEX = "vr";
const ACTION_NAME = "name";
const ACTION_CONFIRM_NAME = "confirm-name";
const CALLBACK_PREFIX = "http://localhost:1455/auth/callback?";
const OAUTH_STATE_PATH = path.join(os.homedir(), ".openclaw", "extensions", "codex-list", "oauth-state.json");
const OAUTH_IO_DIR = path.join(os.homedir(), ".openclaw", "extensions", "codex-list", "oauth-runtime");

function ensureRuntimeDir() {
  fs.mkdirSync(OAUTH_IO_DIR, { recursive: true });
}

function expandHome(input) {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function getOpenclawBin() {
  const localBin = path.join(os.homedir(), ".npm-global/bin/openclaw");
  if (fs.existsSync(localBin)) return localBin;
  return "openclaw";
}

function getAgentId(ctx) {
  const raw = ctx?.config?.defaultAgent;
  return typeof raw === "string" && raw.trim() ? raw.trim() : DEFAULT_AGENT_ID;
}

function getAuthProfilesPath(agentId) {
  return expandHome(`~/.openclaw/agents/${agentId}/agent/auth-profiles.json`);
}

function parseExpiresMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber < 1e12 ? asNumber * 1000 : asNumber;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatUtc(expiresMs) {
  if (!expiresMs) return "unknown";
  return new Date(expiresMs).toISOString().slice(0, 16).replace("T", " ");
}

function loadAuthProfilesFile(authProfilesPath) {
  return JSON.parse(fs.readFileSync(authProfilesPath, "utf8"));
}

function getProfileMap(parsed) {
  return parsed?.profiles && typeof parsed.profiles === "object" ? parsed.profiles : parsed;
}

function readOauthState() {
  try {
    return JSON.parse(fs.readFileSync(OAUTH_STATE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeOauthState(data) {
  ensureRuntimeDir();
  fs.writeFileSync(OAUTH_STATE_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function clearOauthState() {
  try { fs.unlinkSync(OAUTH_STATE_PATH); } catch {}
}

function getCurrentOrder() {
  try {
    const output = execFileSync(getOpenclawBin(), ["models", "auth", "order", "get", "--provider", PROVIDER_ID], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const match = output.match(/Order override:\s*(.+)$/m);
    const raw = match ? match[1] : output;
    return raw.split(",").map((item) => item.trim()).filter((item) => item.startsWith(PROVIDER_ID));
  } catch {
    return [];
  }
}

function loadProfiles(authProfilesPath) {
  const parsed = loadAuthProfilesFile(authProfilesPath);
  const profileMap = getProfileMap(parsed);
  const fallbackOrder = Array.isArray(parsed?.order?.[PROVIDER_ID]) ? parsed.order[PROVIDER_ID] : [];
  const cliOrder = getCurrentOrder();
  const effectiveOrder = cliOrder.length > 0 ? cliOrder : fallbackOrder;
  const orderIndex = new Map(effectiveOrder.map((id, index) => [id, index]));
  const now = Date.now();

  const profiles = Object.entries(profileMap)
    .filter(([profileId]) => profileId === PROVIDER_ID || profileId.startsWith(`${PROVIDER_ID}:`))
    .map(([profileId, profile]) => {
      const expiresMs = parseExpiresMs(profile?.expires);
      const suffix = profileId.split(":").slice(1).join(":");
      return {
        profileId,
        accountLabel: profile?.email || suffix || profile?.accountId || "unknown",
        expiresMs,
        isValid: expiresMs ? expiresMs > now : false,
        isPrimary: effectiveOrder.length > 0 ? effectiveOrder[0] === profileId : false,
      };
    })
    .sort((a, b) => {
      const aOrder = orderIndex.has(a.profileId) ? orderIndex.get(a.profileId) : Number.MAX_SAFE_INTEGER;
      const bOrder = orderIndex.has(b.profileId) ? orderIndex.get(b.profileId) : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.profileId.localeCompare(b.profileId);
    });

  if (profiles.length > 0 && !profiles.some((profile) => profile.isPrimary)) profiles[0].isPrimary = true;
  return profiles;
}

function buildListText(profiles) {
  const lines = ["🔑 OpenAI Codex OAuth Profiles:", ""];
  profiles.forEach((profile, index) => {
    const primaryMark = profile.isPrimary ? "★ " : "";
    const statusMark = profile.isValid ? "✓ valid" : "✗ expired";
    const expiryLabel = profile.isValid ? "Expires" : "Expired";
    lines.push(`${index + 1}. ${primaryMark}${profile.profileId} ${statusMark}`);
    lines.push(`   Account: ${profile.accountLabel} | ${expiryLabel}: ${formatUtc(profile.expiresMs)}`);
    lines.push("");
  });
  lines.push(`Reply /${COMMAND_LIST} <number> to switch primary.`);
  lines.push(`Reply /${COMMAND_LIST} ${ACTION_NAME} <number> <ten_moi> to rename.`);
  lines.push(`Reply /${COMMAND_ADD_CODEX} to start OAuth add flow.\nReply /${COMMAND_VERIFY_CODEX} <callback_url> to finish verify.`);
  const pending = readOauthState();
  if (pending?.url) lines.push(`⚠️ Có flow add đang chờ callback. Dán callback URL bằng /${COMMAND_LIST} <callback_url>.`);
  return lines.join("\n");
}

function buildTelegramButtons(profiles) {
  const rows = [];
  for (let i = 0; i < profiles.length; i += 2) {
    rows.push(profiles.slice(i, i + 2).map((profile, offset) => ({
      text: `${i + offset + 1}${profile.isPrimary ? " ★" : ""}`,
      callback_data: `/${COMMAND_LIST} ${i + offset + 1}`,
    })));
  }
  rows.push([
    { text: "➕ ADD", callback_data: `/${COMMAND_ADD_CODEX}` },
    { text: "✏️ NAME", callback_data: `/${COMMAND_LIST} ${ACTION_NAME}` },
  ]);
  return rows;
}

function buildRenameConfirmButtons(index, newName) {
  return [[
    { text: "✅ Xác nhận", callback_data: `/${COMMAND_LIST} ${ACTION_CONFIRM_NAME} ${index} ${newName}` },
    { text: "❌ Hủy", callback_data: `/${COMMAND_LIST}` },
  ]];
}

function switchPrimary(selected, profiles) {
  const ordered = [selected.profileId, ...profiles.map((p) => p.profileId).filter((id) => id !== selected.profileId)];
  execFileSync(getOpenclawBin(), ["models", "auth", "order", "set", "--provider", PROVIDER_ID, ...ordered], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function isValidProfileSuffix(name) {
  return /^[a-z0-9_-]+$/i.test(name);
}

function isCallbackUrl(value) {
  return typeof value === "string" && value.startsWith(CALLBACK_PREFIX);
}

function getOauthHelperPath() {
  return path.join(os.homedir(), ".openclaw", "extensions", "codex-list", "oauth-helper.py");
}

function cleanupOauthArtifacts(state) {
  if (!state) return;
  try { fs.unlinkSync(state.inPath); } catch {}
  try { fs.unlinkSync(state.outPath); } catch {}
  clearOauthState();
}

async function handleAdd() {
  try {
    const existing = readOauthState();
    if (existing?.url || existing?.outPath) {
      return {
        text: [
          "⚠️ Đang có 1 flow add chưa hoàn tất.",
          "Dùng lại link hiện có hoặc dán callback URL của flow đang mở.",
          existing?.url || "",
        ].filter(Boolean).join("\n"),
        isError: true,
      };
    }

    execFileSync(getOauthHelperPath(), ["start"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20000,
    });

    const state = readOauthState();
    if (!state?.url) {
      return {
        text: `⏳ Đang tạo OAuth link, bác chạy lại /${COMMAND_ADD_CODEX} sau 1-2 giây.`,
      };
    }

    return {
      text: [
        "➕ ADD profile mới",
        "",
        "Bước 1: mở link OAuth này trên máy local để login OpenAI Codex:",
        state.url,
        "",
        `Bước 2: sau khi browser chuyển về URL callback, dán NGUYÊN URL đó vào chat theo cú pháp: /${COMMAND_VERIFY_CODEX} <callback_url>`,
        `Ví dụ: /${COMMAND_VERIFY_CODEX} http://localhost:1455/auth/callback?...`,
        "",
        "Plugin đang giữ nguyên flow local đó để chờ callback.",
      ].join("\n"),
    };
  } catch (error) {
    const state = readOauthState();
    if (state?.url) {
      return {
        text: [
          "➕ ADD profile mới",
          "",
          "Bước 1: mở link OAuth này trên máy local để login OpenAI Codex:",
          state.url,
          "",
          `Bước 2: sau khi browser chuyển về URL callback, dán NGUYÊN URL đó vào chat theo cú pháp: /${COMMAND_VERIFY_CODEX} <callback_url>`,
        ].join("\n"),
      };
    }
    const detail = error?.stderr?.toString?.() || error?.message || String(error);
    return {
      text: [
        "⚠️ Không lấy được OAuth URL tự động.",
        `Lỗi: ${detail}`,
      ].join("\n"),
      isError: true,
    };
  }
}

async function handleCallback(rawArgs) {
  const callbackUrl = rawArgs.trim();
  const state = readOauthState();
  if (!state?.outPath) {
    return {
      text: `⚠️ Hiện không có flow add nào đang chờ callback. Hãy chạy /${COMMAND_LIST} ${ACTION_ADD} trước.`,
      isError: true,
    };
  }

  try {
    execFileSync(getOauthHelperPath(), ["callback", callbackUrl], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 25000,
    });
    cleanupOauthArtifacts(state);
    return {
      text: [
        "✅ Verify hoàn tất. Profile mới đã được add local.",
        `Giờ chạy /${COMMAND_LIST} để xem profile mới, rồi dùng /${COMMAND_LIST} ${ACTION_NAME} <so_thu_tu> <ten_moi> nếu muốn đổi tên.`,
      ].join("\n"),
    };
  } catch (error) {
    let snapshot = "";
    try { snapshot = fs.readFileSync(state.outPath, "utf8").split(/\r?\n/).slice(-12).join("\n"); } catch {}
    const detail = error?.stdout?.toString?.() || error?.stderr?.toString?.() || snapshot || error?.message || String(error);
    cleanupOauthArtifacts(state);
    return { text: `⚠️ Flow local báo lỗi khi verify callback.\n${detail}`, isError: true };
  }
}

function handleNameHelp() {
  return {
    text: [
      "✏️ Đổi tên profile",
      "",
      `Cú pháp: /${COMMAND_LIST} ${ACTION_NAME} <so_thu_tu> <ten_moi>`,
      `Ví dụ: /${COMMAND_LIST} ${ACTION_NAME} 2 ten_cua_ban`,
      "",
      "Ghi chú:",
      "- Chỉ rename được profile không phải profile đang active",
      "- Nếu đang dùng đúng profile đó, hãy switch sang profile khác rồi quay lại đổi tên",
    ].join("\n"),
  };
}

function runRenameDetached(authProfilesPath, oldId, newId) {
  const parsed = loadAuthProfilesFile(authProfilesPath);
  const profiles = parsed?.profiles && typeof parsed.profiles === "object" ? parsed.profiles : parsed;
  if (!profiles || !profiles[oldId]) throw new Error(`old profile not found: ${oldId}`);
  if (profiles[newId]) throw new Error(`new profile already exists: ${newId}`);

  profiles[newId] = profiles[oldId];
  delete profiles[oldId];

  if (Array.isArray(parsed?.order?.[PROVIDER_ID])) {
    parsed.order[PROVIDER_ID] = parsed.order[PROVIDER_ID].map((item) => item === oldId ? newId : item);
  }
  if (parsed?.lastGood?.[PROVIDER_ID] === oldId) {
    parsed.lastGood[PROVIDER_ID] = newId;
  }
  if (parsed?.usageStats && parsed.usageStats[oldId]) {
    parsed.usageStats[newId] = parsed.usageStats[oldId];
    delete parsed.usageStats[oldId];
  }

  fs.writeFileSync(authProfilesPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

function handleRename(authProfilesPath, profiles, indexText, newName, confirmed, channel) {
  const choice = Number.parseInt(indexText, 10);
  if (!Number.isFinite(choice) || choice < 1 || choice > profiles.length) {
    return { text: `❌ Số không hợp lệ. Dùng /${COMMAND_LIST} để xem danh sách rồi chọn 1-${profiles.length}.`, isError: true };
  }
  const suffix = (newName || "").trim();
  if (!suffix || !isValidProfileSuffix(suffix)) {
    return { text: "❌ Tên mới không hợp lệ. Chỉ dùng chữ, số, dấu gạch dưới (_) hoặc gạch ngang (-).", isError: true };
  }
  const selected = profiles[choice - 1];
  const oldId = selected.profileId;
  const newId = `${PROVIDER_ID}:${suffix}`;
  if (oldId === newId) return { text: `⚠️ Profile đã là ${newId} rồi.` };
  if (profiles.some((p) => p.profileId === newId)) return { text: `❌ Tên mới đã tồn tại: ${newId}`, isError: true };
  if (selected.isPrimary) {
    return { text: "⚠️ Chỉ rename được profile không phải profile đang active. Hãy switch sang profile khác rồi quay lại đổi tên." };
  }

  if (!confirmed) {
    const payload = { text: `⚠️ Xác nhận đổi tên ${oldId} → ${newId}?` };
    if (channel === "telegram") payload.channelData = { telegram: { buttons: buildRenameConfirmButtons(choice, suffix) } };
    return payload;
  }

  try {
    runRenameDetached(authProfilesPath, oldId, newId);
    return { text: `✅ Đã đổi tên thành "${suffix}".` };
  } catch (error) {
    return { text: `⚠️ Không khởi chạy được flow rename: ${error?.message || String(error)}`, isError: true };
  }
}

async function listOrSwitch(ctx) {
  const authProfilesPath = getAuthProfilesPath(getAgentId(ctx));
  if (!fs.existsSync(authProfilesPath)) {
    return { text: `❌ Không thấy auth-profiles.json tại:\n${authProfilesPath}`, isError: true };
  }

  const profiles = loadProfiles(authProfilesPath);
  if (profiles.length === 0) {
    return { text: "❌ Không có OpenAI Codex OAuth profile nào.", isError: true };
  }

  const rawArgs = (ctx?.args || "").trim();
  if (!rawArgs) {
    const payload = { text: buildListText(profiles) };
    if (ctx?.channel === "telegram") payload.channelData = { telegram: { buttons: buildTelegramButtons(profiles) } };
    return payload;
  }

  if (isCallbackUrl(rawArgs)) return handleCallback(rawArgs);

  const parts = rawArgs.split(/\s+/);
  const verb = parts[0]?.toLowerCase();

  if (verb === ACTION_ADD || verb === COMMAND_ADD_CODEX) return handleAdd();
  if (verb === COMMAND_VERIFY_CODEX) return handleCallback(parts.slice(1).join(" "));
  if (verb === ACTION_NAME && parts.length === 1) return handleNameHelp();
  if (verb === ACTION_NAME) return handleRename(authProfilesPath, profiles, parts[1], parts.slice(2).join(" "), false, ctx?.channel);
  if (verb === ACTION_CONFIRM_NAME) return handleRename(authProfilesPath, profiles, parts[1], parts.slice(2).join(" "), true, ctx?.channel);

  const choice = Number.parseInt(rawArgs, 10);
  if (!Number.isFinite(choice) || choice < 1 || choice > profiles.length) {
    return { text: `❌ Số không hợp lệ. Dùng /${COMMAND_LIST} để xem danh sách rồi chọn 1-${profiles.length}.`, isError: true };
  }

  const selected = profiles[choice - 1];
  switchPrimary(selected, profiles);
  return { text: `✅ Switched primary Codex profile to:\n${selected.profileId}` };
}

const plugin = {
  id: "codex-list",
  name: "Codex OAuth Profile Switcher",
  version: "0.2.0",
  description: "Offline local /codex_list command for OpenClaw with add/name actions.",
  register(api) {
    api.registerCommand({
      name: COMMAND_VERIFY_CODEX,
      nativeNames: { default: COMMAND_VERIFY_CODEX },
      description: "Finish local OpenAI Codex OAuth verify with callback URL",
      acceptsArgs: true,
      requireAuth: true,
      handler: async (ctx) => handleCallback((ctx?.args || "").trim()),
    });
    api.registerCommand({
      name: COMMAND_ADD_CODEX,
      nativeNames: { default: COMMAND_ADD_CODEX },
      description: "Start local OpenAI Codex OAuth add flow",
      acceptsArgs: false,
      requireAuth: true,
      handler: async () => handleAdd(),
    });
    api.registerCommand({
      name: COMMAND_LIST,
      nativeNames: { default: COMMAND_LIST },
      description: "List, switch, add and rename OpenAI Codex OAuth profiles locally",
      acceptsArgs: true,
      requireAuth: true,
      handler: async (ctx) => listOrSwitch(ctx),
    });
  },
};

export default plugin;
