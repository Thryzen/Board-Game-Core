import http from "node:http";

import { RoomManager } from "./room-manager.mjs";
import { acceptWebSocket } from "./websocket.mjs";

function send(connection, message) {
  connection?.send(message);
}

function peerEvent(event, room) {
  if (event.type === "peer-left") {
    return { type: "peer-left", room, peerId: event.peerId, reason: event.reason };
  }
  if (event.type === "host-changed") {
    return { type: "host-changed", room, hostId: event.hostId };
  }
  return event;
}

export class SignalingServer {
  constructor({
    roomManager = new RoomManager(),
    heartbeatTimeoutMs = 30_000,
    reapIntervalMs = 5_000,
    emptyRoomTtlMs = 180_000,
  } = {}) {
    this.roomManager = roomManager;
    this.heartbeatTimeoutMs = heartbeatTimeoutMs;
    this.reapIntervalMs = reapIntervalMs;
    this.emptyRoomTtlMs = emptyRoomTtlMs;
    this.connections = new Map();
    this.server = http.createServer((request, response) => this.handleHttp(request, response));
    this.server.on("upgrade", (request, socket) => this.handleUpgrade(request, socket));
    this.reapTimer = null;
  }

  listen(port = 8787, host = "127.0.0.1") {
    this.reapTimer = setInterval(() => this.reapStalePeers(), this.reapIntervalMs);
    this.reapTimer.unref?.();
    return new Promise((resolve) => {
      this.server.listen(port, host, () => resolve(this.server.address()));
    });
  }

  close() {
    if (this.reapTimer) clearInterval(this.reapTimer);
    for (const record of this.connections.values()) {
      record.connection.close();
    }
    return new Promise((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  handleHttp(request, response) {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(404);
    response.end("not found");
  }

  handleUpgrade(request, socket) {
    if (!request.url?.startsWith("/ws")) {
      socket.destroy();
      return;
    }

    let record = null;
    const connection = acceptWebSocket(request, socket, {
      onMessage: (text) => this.handleMessage(connection, text, (nextRecord) => {
        record = nextRecord;
      }),
      onClose: () => {
        if (record) this.disconnect(record);
      },
    });
  }

  handleMessage(connection, text, setRecord) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      send(connection, { type: "error", message: "invalid json" });
      return;
    }

    try {
      if (message.type === "create") {
        const result = this.roomManager.createRoom({
          gameId: message.gameId,
          displayName: message.displayName,
          maxPeers: message.maxPeers,
        });
        const record = this.bindConnection(connection, result.room.code, result.self.id);
        setRecord(record);
        send(connection, { type: "room-created", ...result });
        return;
      }

      if (message.type === "join") {
        const result = this.roomManager.joinRoom({
          roomCode: message.roomCode,
          displayName: message.displayName,
        });
        const record = this.bindConnection(connection, result.room.code, result.self.id);
        setRecord(record);
        send(connection, { type: "room-joined", ...result });
        this.broadcast(result.room.code, {
          type: "peer-joined",
          room: result.room,
          peer: result.room.peers.find((peer) => peer.id === result.self.id),
        }, result.self.id);
        return;
      }

      if (message.type === "resume") {
        const result = this.roomManager.resumePeer({
          roomCode: message.roomCode,
          peerId: message.peerId,
          sessionToken: message.sessionToken,
        });
        const record = this.bindConnection(connection, result.room.code, result.self.id);
        setRecord(record);
        send(connection, { type: "room-resumed", ...result });
        this.broadcast(result.room.code, {
          type: "peer-resumed",
          room: result.room,
          peer: result.room.peers.find((peer) => peer.id === result.self.id),
        }, result.self.id);
        return;
      }

      const record = this.requireRecord(connection);
      if (message.type === "heartbeat") {
        const result = this.roomManager.heartbeat(record.roomCode, record.peerId);
        send(connection, { type: "heartbeat", room: result.room, self: result.self });
        return;
      }

      if (message.type === "signal") {
        const target = this.connections.get(message.to);
        if (!target || target.roomCode !== record.roomCode) {
          send(connection, { type: "error", message: "target peer not connected" });
          return;
        }
        send(target.connection, {
          type: "signal",
          from: record.peerId,
          signalType: message.signalType,
          payload: message.payload,
        });
        return;
      }

      if (message.type === "presence") {
        this.broadcast(record.roomCode, {
          type: "presence",
          from: record.peerId,
          payload: message.payload,
        }, record.peerId);
        return;
      }

      send(connection, { type: "error", message: `unknown message type: ${message.type}` });
    } catch (error) {
      send(connection, { type: "error", message: error.message });
    }
  }

  bindConnection(connection, roomCode, peerId) {
    const old = this.connections.get(peerId);
    if (old && old.connection !== connection) old.connection.close();
    const record = { roomCode, peerId, connection };
    this.connections.set(peerId, record);
    return record;
  }

  requireRecord(connection) {
    for (const record of this.connections.values()) {
      if (record.connection === connection) return record;
    }
    throw new Error("connection is not in a room");
  }

  disconnect(record) {
    if (this.connections.get(record.peerId)?.connection !== record.connection) return;
    this.connections.delete(record.peerId);
    const room = this.roomManager.getInternalRoom(record.roomCode);
    if (!room) return;
    const events = this.roomManager.markDisconnected(record.roomCode, record.peerId);
    for (const event of events) {
      const updatedRoom = this.roomManager.getRoom(record.roomCode);
      this.broadcast(record.roomCode, peerEvent(event, updatedRoom));
    }
  }

  reapStalePeers() {
    const events = this.roomManager.reapStalePeers({
      timeoutMs: this.heartbeatTimeoutMs,
      emptyRoomTtlMs: this.emptyRoomTtlMs,
    });
    for (const event of events) {
      if (event.type === "peer-left") this.connections.delete(event.peerId);
      if (event.type === "room-closed") {
        for (const record of [...this.connections.values()]) {
          if (record.roomCode === event.roomCode) this.connections.delete(record.peerId);
        }
        continue;
      }
      const room = this.roomManager.getRoom(event.roomCode);
      if (!room) continue;
      this.broadcast(event.roomCode, peerEvent(event, room));
    }
  }

  broadcast(roomCode, message, exceptPeerId = null) {
    for (const record of this.connections.values()) {
      if (record.roomCode !== roomCode || record.peerId === exceptPeerId) continue;
      send(record.connection, message);
    }
  }
}
