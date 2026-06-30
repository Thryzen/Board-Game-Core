import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CORE_CONFIG = {
  server: {
    host: "127.0.0.1",
    port: 8787,
    heartbeatTimeoutMs: 30_000,
    reapIntervalMs: 5_000,
    emptyRoomTtlMs: 180_000,
  },
};

const DEFAULT_CONFIG_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "core.config.json",
);

function positiveInteger(value, fallback, label) {
  const resolved = value ?? fallback;
  const number = typeof resolved === "number" ? resolved : Number.parseInt(String(resolved), 10);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
  return number;
}

export function normalizeCoreConfig(rawConfig = {}) {
  const server = rawConfig.server ?? {};
  return {
    server: {
      host: String(server.host ?? DEFAULT_CORE_CONFIG.server.host),
      port: positiveInteger(server.port, DEFAULT_CORE_CONFIG.server.port, "server.port"),
      heartbeatTimeoutMs: positiveInteger(
        server.heartbeatTimeoutMs,
        DEFAULT_CORE_CONFIG.server.heartbeatTimeoutMs,
        "server.heartbeatTimeoutMs",
      ),
      reapIntervalMs: positiveInteger(
        server.reapIntervalMs,
        DEFAULT_CORE_CONFIG.server.reapIntervalMs,
        "server.reapIntervalMs",
      ),
      emptyRoomTtlMs: positiveInteger(
        server.emptyRoomTtlMs,
        DEFAULT_CORE_CONFIG.server.emptyRoomTtlMs,
        "server.emptyRoomTtlMs",
      ),
    },
  };
}

export async function loadCoreConfig(configPath = process.env.CORE_CONFIG_PATH ?? DEFAULT_CONFIG_PATH) {
  try {
    const content = await readFile(configPath, "utf8");
    return normalizeCoreConfig(JSON.parse(content));
  } catch (error) {
    if (error.code === "ENOENT") return normalizeCoreConfig();
    throw error;
  }
}

export function resolveCoreServerOptions(config, env = process.env) {
  const normalized = normalizeCoreConfig(config);
  return {
    host: String(env.HOST ?? normalized.server.host),
    port: positiveInteger(env.PORT, normalized.server.port, "PORT"),
    heartbeatTimeoutMs: positiveInteger(
      env.HEARTBEAT_TIMEOUT_MS,
      normalized.server.heartbeatTimeoutMs,
      "HEARTBEAT_TIMEOUT_MS",
    ),
    reapIntervalMs: positiveInteger(env.REAP_INTERVAL_MS, normalized.server.reapIntervalMs, "REAP_INTERVAL_MS"),
    emptyRoomTtlMs: positiveInteger(env.EMPTY_ROOM_TTL_MS, normalized.server.emptyRoomTtlMs, "EMPTY_ROOM_TTL_MS"),
  };
}
