export const CORE_VERSION = 1;

function randomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createEnvelope({ gameId, senderId, seq, ack = 0, type, payload = null, to = "all", id = randomId() }) {
  if (!gameId) throw new Error("gameId is required");
  if (!senderId) throw new Error("senderId is required");
  if (!type) throw new Error("type is required");
  return {
    coreVersion: CORE_VERSION,
    id,
    gameId,
    senderId,
    to,
    seq,
    ack,
    type,
    payload,
    createdAt: Date.now(),
  };
}

export function isCoreEnvelope(value) {
  return (
    Boolean(value) &&
    value.coreVersion === CORE_VERSION &&
    typeof value.id === "string" &&
    typeof value.gameId === "string" &&
    typeof value.senderId === "string" &&
    Number.isInteger(value.seq) &&
    typeof value.type === "string"
  );
}

export class MessageTracker {
  constructor({ gameId, peerId }) {
    if (!gameId) throw new Error("gameId is required");
    if (!peerId) throw new Error("peerId is required");
    this.gameId = gameId;
    this.peerId = peerId;
    this.seq = 0;
    this.lastAckByPeer = new Map();
    this.seen = new Set();
  }

  next(type, payload = null, to = "all") {
    this.seq += 1;
    return createEnvelope({
      gameId: this.gameId,
      senderId: this.peerId,
      seq: this.seq,
      ack: this.lastAckFor(to),
      type,
      payload,
      to,
    });
  }

  accept(envelope) {
    if (!isCoreEnvelope(envelope)) return false;
    if (envelope.gameId !== this.gameId) return false;
    if (envelope.senderId === this.peerId) return false;
    const key = `${envelope.senderId}:${envelope.id}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.lastAckByPeer.set(envelope.senderId, Math.max(this.lastAckFor(envelope.senderId), envelope.seq));
    return true;
  }

  lastAckFor(peerId) {
    return this.lastAckByPeer.get(peerId) ?? 0;
  }
}
