#!/usr/bin/env node
import { loadCoreConfig, resolveCoreServerOptions } from "./config.mjs";
import { SignalingServer } from "./signaling-server.mjs";

const config = await loadCoreConfig();
const { host, port, heartbeatTimeoutMs, reapIntervalMs, emptyRoomTtlMs } = resolveCoreServerOptions(config);

const server = new SignalingServer({ heartbeatTimeoutMs, reapIntervalMs, emptyRoomTtlMs });
const address = await server.listen(port, host);
console.log(`Board Games Core signaling server listening on ws://${address.address}:${address.port}/ws`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
