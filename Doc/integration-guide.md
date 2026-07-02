# Integration Guide

This guide is for developers who already have an offline board game and want to add private online play with Board Games Core.

The goal is reusable integration: keep game-specific logic in the game, and avoid accidentally turning the signaling server into a high-load gameplay server.

## Core Principle

Core does not know your game. Your game does not ask Core whether a move is legal.

Core provides:

- Private rooms.
- Peer identity.
- Presence.
- Disconnect detection.
- Host migration.
- WebRTC signaling.
- Ordered P2P DataChannels.
- A fixed message envelope.

Your game provides:

- Seats and roles.
- Legal actions.
- Turn order.
- Randomness policy.
- State snapshots.
- Victory and scoring.
- UI.

## Target Architecture

```text
Browser Game UI
  |
  | calls
  v
Game Online Adapter
  |
  | uses
  v
Board Games Core Client
  |
  | WebSocket: rooms, heartbeat, WebRTC signaling only
  v
Thin Core Server

Peer-to-peer DataChannel:
Game action, snapshot, recovery data
```

Keep the adapter small. It should translate between your game and Core, not contain your whole game.

## Step 1: Make Your Offline Game Deterministic

Before adding Core, your offline game should have a rule layer that can apply serialized actions:

```js
const nextState = applyAction(currentState, action);
```

Good action:

```json
{
  "kind": "move",
  "pieceId": "p12",
  "to": { "x": 3, "y": 4 }
}
```

Bad action:

```json
{
  "kind": "clicked-dom-button-17"
}
```

Actions should describe game intent, not UI mechanics.

## Step 2: Define Your Online Config

The game owns its public browser config:

```json
{
  "online": {
    "signalingUrl": "wss://core.example.com/ws",
    "coreClientModuleUrl": "./vendor/board-games-core/board-games-core.mjs",
    "socialCatalogUrls": [
      "./social/common-party-pack/catalog.json"
    ]
  }
}
```

- `signalingUrl` points to the deployed Core server.
- `coreClientModuleUrl` points to the browser SDK file served by your static site.

Do not ask players to type the signaling URL.

## Step 3: Load the Core Client Lazily

Load Core only when the player enters online mode:

```js
const { BoardGamesCoreClient } = await import(gameConfig.online.coreClientModuleUrl);
```

This keeps offline modes working even if the online SDK path is misconfigured.

## Step 4: Create the Client

```js
const core = new BoardGamesCoreClient({
  signalingUrl: gameConfig.online.signalingUrl,
  gameId: "my-game",
  maxPeers: 2
});
```

Use a stable `gameId`. It should identify the game, not the current room.

For games with more players:

```js
maxPeers: 4
```

## Step 5: Create and Join Rooms

Creator:

```js
const { room, self } = await core.createRoom({
  displayName: playerName,
  maxPeers: 2
});
```

Joiner:

```js
const { room, self } = await core.joinRoom({
  roomCode,
  displayName: playerName
});
```

Store the current `room` and `self` in your online adapter.

## Step 6: Assign Seats in the Game Layer

Core does not assign game roles.

For a two-player game, a simple policy is:

```js
function seatedPeers(room) {
  return room.peers
    .filter((peer) => peer.connected !== false)
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .slice(0, 2);
}

function sideForPeer(room, peerId) {
  const index = seatedPeers(room).findIndex((peer) => peer.id === peerId);
  return index === 0 ? "first" : index === 1 ? "second" : null;
}
```

If your game has spectators, teams, seats, dealers, or hidden roles, implement that in your game adapter.

## Step 7: Wait for P2P Readiness

A room being full does not mean the P2P channel is open.

Use:

```text
peer-channel-open
peer-channel-close
```

Only allow gameplay actions after all required opponent channels are open.

## Step 8: Provide Snapshots

Register a snapshot provider:

```js
core.setSnapshotProvider(() => ({
  state: getSerializableGameState(),
  log: getActionLog(),
  version: currentStateVersion
}));
```

Snapshots are used for recovery and late synchronization. They should not be sent every frame.

## Step 9: Send Local Actions

When a local player makes a legal action:

```js
if (!isLegalAction(state, action)) return;

applyLocalAction(action);
core.sendGameAction(action);
```

Core wraps it in an envelope and sends it over DataChannel.

Do not send this through WebSocket.

## Step 10: Receive Remote Actions

```js
core.addEventListener("game-message", (event) => {
  const envelope = event.detail.envelope;

  if (envelope.type !== "game-action") return;

  const action = envelope.payload.action;
  if (!isLegalRemoteAction(state, action, envelope.senderId)) {
    showSyncWarning();
    return;
  }

  applyRemoteAction(action);
});
```

Always validate remote actions in the game layer. Core transports messages; it does not make them trustworthy.

## Step 11: Handle Snapshots

```js
core.addEventListener("snapshot", (event) => {
  restoreSnapshot(event.detail.snapshot);
});
```

A non-host peer may request a snapshot from the host after the DataChannel opens:

```js
core.requestSnapshot(room.hostId);
```

## Step 12: Handle Disconnects

```js
core.addEventListener("peer-left", (event) => {
  updateRoom(event.detail.room);
  pauseIfRequiredPeerMissing();
});

core.addEventListener("host-changed", (event) => {
  updateRoom(event.detail.room);
});
```

Choose a game policy:

- Replacement join: a new player may take a disconnected seat.
- Strict resume: the same browser resumes with `peerId` and `sessionToken`.
- Spectator mode: disconnected seats remain reserved.

Core supports the transport for all three. Your game chooses one.

## Step 13: Keep Server Load Low

These are integration rules, not suggestions:

- WebSocket is only for room, heartbeat, presence, and WebRTC signaling.
- Gameplay actions go through DataChannel.
- Snapshots go through DataChannel.
- Do not stream animation state through Core.
- Do not send large assets through Core.
- Do not send repeated full-state snapshots instead of actions.
- Keep presence payloads small.
- Prefer deterministic action replay.

If P2P fails, show a connection error. Add TURN or a controlled relay later; do not quietly push all game traffic through signaling.

## Optional: Add Chat, Emoji, Phrases, and Reactions

Social features are still game-owned UI. Core gives you a shared protocol and a catalog resolver so multiple games can use the same resource packs.

A social catalog is one JSON file plus referenced assets:

```json
{
  "catalogVersion": 1,
  "catalogId": "common-party-pack",
  "label": "Common Party Pack",
  "emojis": [
    { "id": "smile", "label": "Smile", "asset": "./emoji/smile.webp" }
  ],
  "reactions": [
    { "id": "tomato", "label": "Tomato", "asset": "./reaction/tomato.webp", "targeting": "peer" }
  ],
  "phrases": [
    { "id": "good-game", "label": "Good game", "text": "Good game!" }
  ]
}
```

Load the catalogs after creating the Core client:

```js
await core.loadSocialCatalogs(gameConfig.online.socialCatalogUrls ?? []);

const socialResources = core.getSocialResources();
const emojiButtons = core.getSocialResources({ kind: "emoji" });
const reactionButtons = core.getSocialResources({ kind: "reaction" });
const phraseButtons = core.getSocialResources({ kind: "phrase" });
```

Render social UI from these resolved resources. Each item has a stable `key`, `label`, optional `assetUrl`, and catalog identity. Invalid resources and conflicting definitions are omitted before players can click them.

Send messages from UI actions:

```js
core.sendChat(chatInput.value);
core.sendPhrase(phraseResource);
core.sendEmoji(emojiResource);
core.sendReaction(reactionResource, { targetPeerId: opponentPeerId });
```

Receive and render social messages:

```js
core.addEventListener("social-message", (event) => {
  const { message, resource, envelope } = event.detail;

  if (message.kind === "chat") showChatBubble(envelope.senderId, message.text);
  if (message.kind === "emoji" && resource) showEmoji(envelope.senderId, resource.assetUrl);
  if (message.kind === "reaction" && resource) playReaction(resource, message.targetPeerIds);
});
```

Do not put images, animations, or repeated animation state into Core messages. Send the stable resource identity and let each game render the effect locally.
## Minimal Adapter Shape

```js
export class OnlineAdapter {
  constructor({ game, config }) {
    this.game = game;
    this.config = config;
    this.core = null;
    this.room = null;
    this.self = null;
  }

  async createRoom(displayName) {}
  async joinRoom(roomCode, displayName) {}
  sendAction(action) {}
  applyEnvelope(envelope) {}
  snapshot() {}
  restoreSnapshot(snapshot) {}
  close() {}
}
```

Keep this adapter independent from your rendering code when possible.

## Integration Checklist

- Game actions are serializable.
- Game state snapshots are serializable.
- Online config is separate from Core config.
- Core client SDK is served by the static game site.
- Gameplay waits for `peer-channel-open`.
- Remote actions are validated by game rules.
- Snapshots are used for recovery, not normal action transport.
- WebSocket is not used for game actions.
- Disconnect policy is explicit.
- Empty rooms are cleaned by Core.
