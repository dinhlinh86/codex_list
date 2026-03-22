import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";

const DEFAULT_AGENT_ID = "main";
const PROVIDER_ID = "openai-codex";
const COMMAND_LIST = "codex_list";
const COMMAND_NAME = "codex_name";
const CONFIRM_PREFIX = "confirm:";

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

function getLegacyProfileDir() {
  return expandHome("~/.openclaw/auth-profiles");
}

function parseExpiresMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
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

function getCurrentOrder() {
  try {
    const output = execFileSync(getOpenclawBin(), ["models", "auth", "order", "get", "--provider", PROVIDER_ID], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    const match = output.match(/Order override:\s*(.+)$/m);
    const raw = match ? match[1] : output;
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.startsWith(PROVIDER_ID));
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
  lines.push(`Reply /${COMMAND_NAME} <number> <new_name> to rename a profile.`);
  return lines.join("\n");
}

function buildTelegramButtons(profiles) {
  const rows = [];
  for (let i = 0; i < profiles.length; i += 2) {
    rows.push(
      profiles.slice(i, i + 2).map((profile, offset) => ({
        text: `${i + offset + 1}${profile.isPrimary ? " ★" : ""}`,
        callback_data: `/${COMMAND_LIST} ${i + offset + 1}`,
      })),
    );
  }
  return rows;
}

function buildRenameButtons(index, newName) {
  return [
    [
      { text: "✅ Xác nhận", callback_data: `/${COMMAND_NAME} ${CONFIRM_PREFIX}${index} ${newName}` },
      { text: "❌ Hủy", callback_data: `/${COMMAND_NAME}` },
    ],
  ];
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

function parseRenameArgs(rawArgs) {
  const trimmed = rawArgs.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(CONFIRM_PREFIX)) {
    const afterPrefix = trimmed.slice(CONFIRM_PREFIX.length).trim();
    const [indexText, newName = ""] = afterPrefix.split(/\s+/, 2);
    return { confirmed: true, indexText, newName };
  }

  const [indexText, newName = ""] = trimmed.split(/\s+/, 2);
  return { confirmed: false, indexText, newName };
}

function runShell(command) {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: "/bin/zsh" }).trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getJsonFilesUnderOpenclaw() {
  const output = runShell('find ~/.openclaw -name "*.json" -type f');
  return output ? output.split("\n").map((item) => item.trim()).filter(Boolean) : [];
}

function replaceInJsonFiles(jsonFiles, oldId, newId) {
  const matcher = new RegExp(escapeRegExp(oldId), "g");
  for (const file of jsonFiles) {
    const source = fs.readFileSync(file, "utf8");
    const next = source.replace(matcher, newId);
    if (next !== source) fs.writeFileSync(file, next);
  }
}

function verifyRename(oldId) {
  try {
    const escaped = oldId.replace(/'/g, `'"'"'`);
    return runShell(`grep -R -n --include='*.json' '${escaped}' ~/.openclaw || true`);
  } catch {
    return "";
  }
}

function renameLegacyProfileFile(oldId, newId) {
  const legacyDir = getLegacyProfileDir();
  const oldFile = path.join(legacyDir, `${oldId}.json`);
  const newFile = path.join(legacyDir, `${newId}.json`);
  if (!fs.existsSync(oldFile)) return;
  if (fs.existsSync(newFile)) throw new Error(`Profile file already exists: ${newFile}`);
  fs.renameSync(oldFile, newFile);
}

function restartGatewayAroundRename(oldId, newId) {
  const jsonFiles = getJsonFilesUnderOpenclaw();
  const startArgs = ["gateway", "start"];

  execFileSync(getOpenclawBin(), ["gateway", "stop"], { stdio: ["ignore", "pipe", "pipe"] });
  let started = false;

  try {
    replaceInJsonFiles(jsonFiles, oldId, newId);
    renameLegacyProfileFile(oldId, newId);
    execFileSync(getOpenclawBin(), startArgs, { stdio: ["ignore", "pipe", "pipe"] });
    started = true;
    const verifyOutput = verifyRename(oldId);
    return { verifyOutput };
  } catch (error) {
    if (!started) {
      try {
        execFileSync(getOpenclawBin(), startArgs, { stdio: ["ignore", "pipe", "pipe"] });
        started = true;
      } catch {
        // ignore restart failure here; original error is more important for caller
      }
    }
    throw error;
  }
}

function listOrSwitch(ctx) {
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
    if (ctx?.channel === "telegram") {
      payload.channelData = { telegram: { buttons: buildTelegramButtons(profiles) } };
    }
    return payload;
  }

  const choice = Number.parseInt(rawArgs, 10);
  if (!Number.isFinite(choice) || choice < 1 || choice > profiles.length) {
    return { text: `❌ Số không hợp lệ. Dùng /${COMMAND_LIST} để xem danh sách rồi chọn 1-${profiles.length}.`, isError: true };
  }

  const selected = profiles[choice - 1];
  switchPrimary(selected, profiles);
  return { text: `✅ Switched primary Codex profile to:\n${selected.profileId}` };
}

function renameProfile(ctx) {
  const authProfilesPath = getAuthProfilesPath(getAgentId(ctx));
  if (!fs.existsSync(authProfilesPath)) {
    return { text: `❌ Không thấy auth-profiles.json tại:\n${authProfilesPath}`, isError: true };
  }

  const profiles = loadProfiles(authProfilesPath);
  if (profiles.length === 0) {
    return { text: "❌ Không có OpenAI Codex OAuth profile nào.", isError: true };
  }

  const parsedArgs = parseRenameArgs((ctx?.args || "").trim());
  if (!parsedArgs) {
    return {
      text: [
        `ℹ️ Cú pháp /${COMMAND_NAME}:`,
        `/${COMMAND_NAME}`,
        `/${COMMAND_NAME} <so_thu_tu> <ten_moi>`,
        "",
        `Ví dụ: /${COMMAND_NAME} 2 thulinh1009`,
      ].join("\n"),
    };
  }

  const choice = Number.parseInt(parsedArgs.indexText, 10);
  if (!Number.isFinite(choice) || choice < 1 || choice > profiles.length) {
    return { text: `❌ Số không hợp lệ. Dùng /${COMMAND_LIST} để xem danh sách rồi chọn 1-${profiles.length}.`, isError: true };
  }

  const newSuffix = parsedArgs.newName.trim();
  if (!newSuffix || !isValidProfileSuffix(newSuffix)) {
    return {
      text: "❌ Tên mới không hợp lệ. Chỉ dùng chữ, số, dấu gạch dưới (_) hoặc gạch ngang (-).",
      isError: true,
    };
  }

  const selected = profiles[choice - 1];
  const oldId = selected.profileId;
  const newId = `${PROVIDER_ID}:${newSuffix}`;

  if (oldId === newId) {
    return { text: `⚠️ Profile đã mang tên ${newId} rồi.` };
  }

  if (profiles.some((profile) => profile.profileId === newId)) {
    return { text: `❌ Tên mới đã tồn tại: ${newId}`, isError: true };
  }

  if (!parsedArgs.confirmed) {
    const payload = {
      text: `⚠️ Xác nhận đổi tên ${oldId} → ${newId}?\nPlugin sẽ stop gateway, đổi tên local rồi start lại.`,
    };
    if (ctx?.channel === "telegram") {
      payload.channelData = { telegram: { buttons: buildRenameButtons(choice, newSuffix) } };
    }
    return payload;
  }

  try {
    const progressLines = [`🔄 Đang đổi tên ${oldId} → ${newId}...`];
    const result = restartGatewayAroundRename(oldId, newId);
    if (result.verifyOutput) {
      return {
        text: `${progressLines.join("\n")}\n⚠️ Đổi tên xong nhưng vẫn còn tham chiếu cũ cần kiểm tra thêm:\n${result.verifyOutput}`,
      };
    }
    return { text: `${progressLines.join("\n")}\n✅ Đổi tên thành công!` };
  } catch (error) {
    return { text: `⚠️ Đổi tên thất bại: ${error?.message || String(error)}`, isError: true };
  }
}

const plugin = {
  id: "codex-list",
  name: "Codex OAuth Profile Switcher",
  version: "0.2.0",
  description: "Offline local /codex_list and /codex_name commands for OpenClaw.",
  register(api) {
    api.registerCommand({
      name: COMMAND_LIST,
      nativeNames: { default: COMMAND_LIST },
      description: "List and switch OpenAI Codex OAuth profiles locally",
      acceptsArgs: true,
      requireAuth: true,
      handler: async (ctx) => listOrSwitch(ctx),
    });

    api.registerCommand({
      name: COMMAND_NAME,
      nativeNames: { default: COMMAND_NAME },
      description: "Rename OpenAI Codex OAuth profiles locally",
      acceptsArgs: true,
      requireAuth: true,
      handler: async (ctx) => renameProfile(ctx),
    });
  },
};

export default plugin;
