const DEFAULT_MAX_PEERS = 8;
const MIN_PEERS = 2;
const DEFAULT_EMPTY_ROOM_TTL_MS = 180_000;

function defaultCodeGenerator() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function defaultIdGenerator() {
  return `peer-${Math.random().toString(36).slice(2, 12)}`;
}

function defaultTokenGenerator() {
  return `session-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function publicPeer(peer, hostId) {
  return {
    id: peer.id,
    displayName: peer.displayName,
    connected: peer.connected,
    host: peer.id === hostId,
    joinedAt: peer.joinedAt,
    lastSeenAt: peer.lastSeenAt,
  };
}

function publicSelf(peer, hostId) {
  return {
    ...publicPeer(peer, hostId),
    sessionToken: peer.sessionToken,
  };
}

function publicRoom(room) {
  return {
    code: room.code,
    gameId: room.gameId,
    maxPeers: room.maxPeers,
    hostId: room.hostId,
    createdAt: room.createdAt,
    peers: [...room.peers.values()].map((peer) => publicPeer(peer, room.hostId)),
  };
}

export class RoomManager {
  constructor({
    now = () => Date.now(),
    codeGenerator = defaultCodeGenerator,
    idGenerator = defaultIdGenerator,
    tokenGenerator = defaultTokenGenerator,
  } = {}) {
    this.now = now;
    this.codeGenerator = codeGenerator;
    this.idGenerator = idGenerator;
    this.tokenGenerator = tokenGenerator;
    this.rooms = new Map();
  }

  createRoom({ gameId, displayName, maxPeers = DEFAULT_MAX_PEERS }) {
    if (!gameId) throw new Error("gameId is required");
    if (!displayName) throw new Error("displayName is required");
    if (maxPeers < MIN_PEERS) throw new Error("maxPeers must be at least 2");
    const code = this.createUniqueCode();
    const room = {
      code,
      gameId,
      maxPeers,
      hostId: null,
      createdAt: this.now(),
      emptySince: null,
      peers: new Map(),
    };
    this.rooms.set(code, room);
    const peer = this.addPeer(room, displayName);
    room.hostId = peer.id;
    return this.result(room, peer);
  }

  joinRoom({ roomCode, displayName }) {
    const room = this.requireRoom(roomCode);
    if (!displayName) throw new Error("displayName is required");
    if (this.connectedPeers(room).length >= room.maxPeers) throw new Error("room is full");
    const peer = this.addPeer(room, displayName);
    if (!room.hostId) room.hostId = peer.id;
    this.updateEmptySince(room);
    return this.result(room, peer);
  }

  resumePeer({ roomCode, peerId, sessionToken }) {
    const room = this.requireRoom(roomCode);
    const peer = room.peers.get(peerId);
    if (!peer || peer.sessionToken !== sessionToken) throw new Error("invalid session");
    peer.connected = true;
    peer.lastSeenAt = this.now();
    if (!room.hostId) room.hostId = peer.id;
    this.updateEmptySince(room);
    return this.result(room, peer);
  }

  heartbeat(roomCode, peerId) {
    const room = this.requireRoom(roomCode);
    const peer = room.peers.get(peerId);
    if (!peer) throw new Error("peer not found");
    peer.connected = true;
    peer.lastSeenAt = this.now();
    this.updateEmptySince(room);
    return this.result(room, peer);
  }

  markDisconnected(roomCode, peerId, reason = "disconnect") {
    const room = this.requireRoom(roomCode);
    const peer = room.peers.get(peerId);
    if (!peer || !peer.connected) return [];
    peer.connected = false;
    peer.lastSeenAt = this.now();
    const events = [{ type: "peer-left", roomCode: room.code, peerId, reason }];
    const hostEvent = this.ensureHost(room);
    if (hostEvent) events.push(hostEvent);
    this.updateEmptySince(room);
    return events;
  }

  reapStalePeers({ timeoutMs, emptyRoomTtlMs = DEFAULT_EMPTY_ROOM_TTL_MS }) {
    const events = [];
    const now = this.now();
    for (const room of [...this.rooms.values()]) {
      for (const peer of room.peers.values()) {
        if (!peer.connected) continue;
        if (now - peer.lastSeenAt <= timeoutMs) continue;
        peer.connected = false;
        events.push({ type: "peer-left", roomCode: room.code, peerId: peer.id, reason: "timeout" });
      }
      const hostEvent = this.ensureHost(room);
      if (hostEvent) events.push(hostEvent);
      this.updateEmptySince(room);
      if (room.emptySince !== null && now - room.emptySince >= emptyRoomTtlMs) {
        this.rooms.delete(room.code);
        events.push({ type: "room-closed", roomCode: room.code, reason: "empty-timeout" });
      }
    }
    return events;
  }

  getRoom(roomCode) {
    const room = this.rooms.get(this.normalizeCode(roomCode));
    return room ? publicRoom(room) : null;
  }

  getInternalRoom(roomCode) {
    return this.rooms.get(this.normalizeCode(roomCode)) ?? null;
  }

  createUniqueCode() {
    for (let attempts = 0; attempts < 20; attempts += 1) {
      const code = this.normalizeCode(this.codeGenerator());
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("could not allocate room code");
  }

  addPeer(room, displayName) {
    const peer = {
      id: this.idGenerator(),
      sessionToken: this.tokenGenerator(),
      displayName,
      connected: true,
      joinedAt: this.now(),
      lastSeenAt: this.now(),
    };
    room.peers.set(peer.id, peer);
    return peer;
  }

  updateEmptySince(room) {
    if (this.connectedPeers(room).length === 0) {
      room.emptySince ??= this.now();
      return;
    }
    room.emptySince = null;
  }

  result(room, peer) {
    return {
      room: publicRoom(room),
      self: publicSelf(peer, room.hostId),
    };
  }

  requireRoom(roomCode) {
    const room = this.rooms.get(this.normalizeCode(roomCode));
    if (!room) throw new Error("room not found");
    return room;
  }

  normalizeCode(roomCode) {
    return String(roomCode ?? "").trim().toUpperCase();
  }

  connectedPeers(room) {
    return [...room.peers.values()].filter((peer) => peer.connected);
  }

  ensureHost(room) {
    const host = room.hostId ? room.peers.get(room.hostId) : null;
    if (host?.connected) return null;
    const nextHost = this.connectedPeers(room).sort((a, b) => a.joinedAt - b.joinedAt)[0] ?? null;
    const previousHostId = room.hostId;
    room.hostId = nextHost?.id ?? null;
    if (!room.hostId || room.hostId === previousHostId) return null;
    return { type: "host-changed", roomCode: room.code, hostId: room.hostId };
  }
}
