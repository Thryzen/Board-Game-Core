import { MessageTracker } from "./protocol.mjs";

const DEFAULT_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

function dispatch(target, type, detail) {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

function waitForSignalingResult(client, successTypes) {
  return new Promise((resolve, reject) => {
    const success = (event) => {
      cleanup();
      resolve(event.detail);
    };
    const error = (event) => {
      cleanup();
      reject(new Error(event.detail?.message ?? "signaling error"));
    };
    const cleanup = () => {
      for (const type of successTypes) client.removeEventListener(type, success);
      client.removeEventListener("core-error", error);
    };
    for (const type of successTypes) client.addEventListener(type, success, { once: true });
    client.addEventListener("core-error", error, { once: true });
  });
}

export class BoardGamesCoreClient extends EventTarget {
  constructor({
    signalingUrl,
    gameId,
    maxPeers = 8,
    iceServers = DEFAULT_ICE_SERVERS,
    webSocketFactory = (url) => new WebSocket(url),
    peerConnectionFactory = (config) => new RTCPeerConnection(config),
  }) {
    super();
    if (!signalingUrl) throw new Error("signalingUrl is required");
    if (!gameId) throw new Error("gameId is required");
    this.signalingUrl = signalingUrl;
    this.gameId = gameId;
    this.maxPeers = maxPeers;
    this.iceServers = iceServers;
    this.webSocketFactory = webSocketFactory;
    this.peerConnectionFactory = peerConnectionFactory;
    this.socket = null;
    this.room = null;
    this.peerId = null;
    this.sessionToken = null;
    this.tracker = null;
    this.peers = new Map();
    this.snapshotProvider = null;
    this.heartbeatTimer = null;
  }

  get isHost() {
    return Boolean(this.room?.hostId && this.room.hostId === this.peerId);
  }

  async createRoom({ displayName, maxPeers = this.maxPeers } = {}) {
    this.ensureSocket();
    const pending = waitForSignalingResult(this, ["room-created"]);
    if (!this.isSocketOpen()) await this.waitForSocketOpen();
    this.sendSignal({ type: "create", gameId: this.gameId, displayName, maxPeers });
    return pending;
  }

  async joinRoom({ roomCode, displayName } = {}) {
    this.ensureSocket();
    const pending = waitForSignalingResult(this, ["room-joined"]);
    if (!this.isSocketOpen()) await this.waitForSocketOpen();
    this.sendSignal({ type: "join", roomCode, displayName });
    return pending;
  }

  async resumeRoom({ roomCode, peerId = this.peerId, sessionToken = this.sessionToken } = {}) {
    this.ensureSocket();
    const pending = waitForSignalingResult(this, ["room-resumed"]);
    if (!this.isSocketOpen()) await this.waitForSocketOpen();
    this.sendSignal({ type: "resume", roomCode, peerId, sessionToken });
    return pending;
  }

  setSnapshotProvider(provider) {
    this.snapshotProvider = provider;
  }

  sendGameMessage(type, payload = null, to = "all") {
    if (!this.tracker) throw new Error("client is not in a room");
    const envelope = this.tracker.next(type, payload, to);
    if (to === "all") {
      for (const peer of this.peers.values()) this.sendEnvelopeToPeer(peer, envelope);
    } else {
      const peer = this.peers.get(to);
      if (peer) this.sendEnvelopeToPeer(peer, envelope);
    }
    return envelope;
  }

  sendGameAction(action) {
    return this.sendGameMessage("game-action", { action });
  }

  requestSnapshot(peerId = this.room?.hostId) {
    if (!peerId || peerId === this.peerId) return null;
    return this.sendGameMessage("snapshot-request", {}, peerId);
  }

  close() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    for (const peer of this.peers.values()) {
      peer.connection?.close?.();
    }
    this.peers.clear();
    this.socket?.close?.();
    this.socket = null;
  }

  ensureSocket() {
    if (this.socket) return;
    this.socket = this.webSocketFactory(this.signalingUrl);
    this.socket.addEventListener("message", (event) => this.handleSignalMessage(event.data));
    this.socket.addEventListener("close", () => dispatch(this, "signaling-closed", {}));
  }

  isSocketOpen() {
    return this.socket?.readyState === 1 || this.socket?.readyState === globalThis.WebSocket?.OPEN;
  }

  waitForSocketOpen() {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.socket.removeEventListener("open", open);
        this.socket.removeEventListener("error", error);
      };
      const open = () => {
        cleanup();
        resolve();
      };
      const error = () => {
        cleanup();
        reject(new Error("could not connect signaling server"));
      };
      this.socket.addEventListener("open", open, { once: true });
      this.socket.addEventListener("error", error, { once: true });
    });
  }

  sendSignal(message) {
    this.socket.send(JSON.stringify(message));
  }

  handleSignalMessage(raw) {
    let message;
    try {
      message = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(String(raw));
    } catch {
      dispatch(this, "core-error", { message: "invalid signaling message" });
      return;
    }

    if (message.type === "error") {
      dispatch(this, "core-error", message);
      return;
    }

    if (["room-created", "room-joined", "room-resumed"].includes(message.type)) {
      this.adoptRoom(message.room, message.self);
      dispatch(this, message.type, { room: this.room, self: message.self });
      return;
    }

    if (message.type === "peer-joined" || message.type === "peer-resumed") {
      this.room = message.room;
      const peer = message.peer;
      if (peer?.id && peer.id !== this.peerId) this.ensurePeer(peer);
      dispatch(this, message.type, message);
      return;
    }

    if (message.type === "peer-left") {
      if (message.room) this.room = message.room;
      const peer = this.peers.get(message.peerId);
      peer?.connection?.close?.();
      this.peers.delete(message.peerId);
      dispatch(this, "peer-left", message);
      return;
    }

    if (message.type === "host-changed") {
      if (message.room) this.room = message.room;
      else if (this.room) this.room.hostId = message.hostId;
      dispatch(this, "host-changed", message);
      return;
    }

    if (message.type === "signal") {
      void this.handlePeerSignal(message);
      return;
    }

    if (message.type === "presence") {
      dispatch(this, "presence", message);
    }
  }

  adoptRoom(room, self) {
    this.room = room;
    this.peerId = self.id;
    this.sessionToken = self.sessionToken;
    this.tracker = new MessageTracker({ gameId: this.gameId, peerId: this.peerId });
    for (const peer of room.peers ?? []) {
      if (peer.id !== this.peerId && peer.connected !== false) this.ensurePeer(peer);
    }
    this.startHeartbeat();
  }

  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === 1) {
        this.sendSignal({ type: "heartbeat" });
      }
    }, 10_000);
    this.heartbeatTimer.unref?.();
  }

  shouldInitiate(peerId) {
    return String(this.peerId) < String(peerId);
  }

  ensurePeer(peerInfo) {
    if (!peerInfo?.id || peerInfo.id === this.peerId) return null;
    if (this.peers.has(peerInfo.id)) return this.peers.get(peerInfo.id);

    const connection = this.peerConnectionFactory({ iceServers: this.iceServers });
    const peer = {
      id: peerInfo.id,
      info: peerInfo,
      connection,
      channel: null,
      queue: [],
    };
    this.peers.set(peer.id, peer);

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          type: "signal",
          to: peer.id,
          signalType: "ice",
          payload: event.candidate,
        });
      }
    };

    connection.ondatachannel = (event) => this.attachDataChannel(peer, event.channel);

    if (this.shouldInitiate(peer.id)) {
      const channel = connection.createDataChannel("board-games-core", { ordered: true });
      this.attachDataChannel(peer, channel);
      void this.createOffer(peer);
    }

    return peer;
  }

  async createOffer(peer) {
    const offer = await peer.connection.createOffer();
    await peer.connection.setLocalDescription(offer);
    this.sendSignal({ type: "signal", to: peer.id, signalType: "offer", payload: offer });
  }

  async handlePeerSignal(message) {
    const peer = this.ensurePeer({ id: message.from });
    if (!peer) return;

    if (message.signalType === "offer") {
      await peer.connection.setRemoteDescription(message.payload);
      const answer = await peer.connection.createAnswer();
      await peer.connection.setLocalDescription(answer);
      this.sendSignal({ type: "signal", to: peer.id, signalType: "answer", payload: answer });
      return;
    }

    if (message.signalType === "answer") {
      await peer.connection.setRemoteDescription(message.payload);
      return;
    }

    if (message.signalType === "ice") {
      await peer.connection.addIceCandidate(message.payload);
    }
  }

  attachDataChannel(peer, channel) {
    peer.channel = channel;
    channel.addEventListener("open", () => {
      this.flushPeerQueue(peer);
      dispatch(this, "peer-channel-open", { peerId: peer.id });
      if (!this.isHost && peer.id === this.room?.hostId) this.requestSnapshot(peer.id);
    });
    channel.addEventListener("close", () => dispatch(this, "peer-channel-close", { peerId: peer.id }));
    channel.addEventListener("message", (event) => this.handlePeerMessage(peer, event.data));
  }

  sendEnvelopeToPeer(peer, envelope) {
    if (peer.channel?.readyState === "open") {
      peer.channel.send(JSON.stringify(envelope));
      return;
    }
    peer.queue.push(envelope);
  }

  flushPeerQueue(peer) {
    while (peer.queue.length > 0 && peer.channel?.readyState === "open") {
      peer.channel.send(JSON.stringify(peer.queue.shift()));
    }
  }

  handlePeerMessage(peer, raw) {
    let envelope;
    try {
      envelope = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!this.tracker?.accept(envelope)) return;

    if (envelope.type === "snapshot-request") {
      if (this.snapshotProvider) {
        this.sendGameMessage("game-snapshot", this.snapshotProvider(), envelope.senderId);
      }
      return;
    }

    if (envelope.type === "game-snapshot") {
      dispatch(this, "snapshot", { peerId: peer.id, envelope, snapshot: envelope.payload });
      return;
    }

    dispatch(this, "game-message", { peerId: peer.id, envelope });
  }
}
