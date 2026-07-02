# Interfaces

This document defines the public surface of Board Games Core. Games should use these interfaces instead of reaching into Core internals.

## Server Entry

Run the signaling server:

```bash
node Core/server/index.mjs
```

The server reads:

```text
Core/core.config.json
```

Environment variables may override the config:

```text
HOST
PORT
HEARTBEAT_TIMEOUT_MS
REAP_INTERVAL_MS
EMPTY_ROOM_TTL_MS
CORE_CONFIG_PATH
```

## Core Config

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 8787,
    "heartbeatTimeoutMs": 30000,
    "reapIntervalMs": 5000,
    "emptyRoomTtlMs": 180000
  }
}
```

- `host`: bind address for the Node server.
- `port`: bind port.
- `heartbeatTimeoutMs`: how long a connected peer may miss heartbeats before being marked disconnected.
- `reapIntervalMs`: how often the server checks stale peers and empty rooms.
- `emptyRoomTtlMs`: how long a room with zero connected peers remains alive.

## HTTP Interface

### `GET /health`

Returns:

```json
{ "ok": true }
```

Use this for deployment health checks.

## WebSocket Interface

The WebSocket endpoint is:

```text
/ws
```

The browser SDK normally sends these messages for you. Use this section to understand the protocol or to build another SDK.

### Create Room

Client to server:

```json
{
  "type": "create",
  "gameId": "your-game-id",
  "displayName": "Player",
  "maxPeers": 2
}
```

Server to creator:

```json
{
  "type": "room-created",
  "room": {},
  "self": {}
}
```

### Join Room

Client to server:

```json
{
  "type": "join",
  "roomCode": "ABC123",
  "displayName": "Player"
}
```

Server to joiner:

```json
{
  "type": "room-joined",
  "room": {},
  "self": {}
}
```

Server to existing peers:

```json
{
  "type": "peer-joined",
  "room": {},
  "peer": {}
}
```

### Resume Peer

Client to server:

```json
{
  "type": "resume",
  "roomCode": "ABC123",
  "peerId": "peer-id",
  "sessionToken": "session-token"
}
```

Server to peer:

```json
{
  "type": "room-resumed",
  "room": {},
  "self": {}
}
```

Games may ignore resume if they prefer simple replacement joins.

### Heartbeat

Client to server:

```json
{ "type": "heartbeat" }
```

Server to client:

```json
{
  "type": "heartbeat",
  "room": {},
  "self": {}
}
```

### WebRTC Signal

Client to server:

```json
{
  "type": "signal",
  "to": "target-peer-id",
  "signalType": "offer",
  "payload": {}
}
```

`signalType` may be:

```text
offer
answer
ice
```

Server to target peer:

```json
{
  "type": "signal",
  "from": "sender-peer-id",
  "signalType": "offer",
  "payload": {}
}
```

The server only forwards signaling payloads. It does not inspect SDP or ICE data.

### Presence

Client to server:

```json
{
  "type": "presence",
  "payload": {}
}
```

Server to other peers:

```json
{
  "type": "presence",
  "from": "sender-peer-id",
  "payload": {}
}
```

Use presence only for small non-game state, such as cursor state or "choosing option" indicators.

## Room Object

Public room snapshots use this shape:

```json
{
  "code": "ABC123",
  "gameId": "your-game-id",
  "maxPeers": 2,
  "hostId": "peer-1",
  "createdAt": 1780000000000,
  "peers": [
    {
      "id": "peer-1",
      "displayName": "Player",
      "connected": true,
      "host": true,
      "joinedAt": 1780000000000,
      "lastSeenAt": 1780000000000
    }
  ]
}
```

`self` has the same public peer fields plus:

```json
{
  "sessionToken": "private-token"
}
```

Do not show `sessionToken` to other players.

## Browser SDK

Import the SDK from the path chosen by your game config:

```js
const { BoardGamesCoreClient } = await import(coreClientModuleUrl);
```

Create a client:

```js
const core = new BoardGamesCoreClient({
  signalingUrl: "wss://core.example.com/ws",
  gameId: "your-game-id",
  maxPeers: 2,
});
```

Optional constructor fields:

```js
{
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  webSocketFactory: (url) => new WebSocket(url),
  peerConnectionFactory: (config) => new RTCPeerConnection(config)
}
```

### Methods

```js
await core.createRoom({ displayName, maxPeers });
await core.joinRoom({ roomCode, displayName });
await core.resumeRoom({ roomCode, peerId, sessionToken });
core.setSnapshotProvider(() => snapshot);
await core.loadSocialCatalogs(socialCatalogUrls);
core.registerSocialCatalog(catalogJson, { baseUrl });
core.getSocialResources(filter);
core.getSocialCatalogDiagnostics();
core.sendChat(text, options);
core.sendPhrase(resourceOrKey, options);
core.sendEmoji(resourceOrKey, options);
core.sendReaction(resourceOrKey, options);
core.sendSocialMessage(kind, payload, options);
core.sendGameAction(action);
core.sendGameMessage(type, payload, to);
core.requestSnapshot(peerId);
core.close();
```

### Events

```text
room-created
room-joined
room-resumed
peer-joined
peer-resumed
peer-left
host-changed
peer-channel-open
peer-channel-close
snapshot
game-message
presence
core-error
signaling-closed
```

Each event uses `event.detail`.

## P2P Envelope

All game-facing DataChannel messages use one envelope:

```json
{
  "coreVersion": 1,
  "id": "message-id",
  "gameId": "your-game-id",
  "senderId": "peer-1",
  "to": "all",
  "seq": 1,
  "ack": 0,
  "type": "game-action",
  "payload": {},
  "createdAt": 1780000000000
}
```

Core reserves:

```text
game-action
snapshot-request
game-snapshot
```

Games may define additional `type` values but must keep the envelope.

## Social Protocol

Social features are optional and use the same P2P DataChannel path as game messages. The Core server does not relay chat, emoji, phrases, reactions, or social assets.

Games usually declare social catalog URLs in their own public browser config:

```json
{
  "online": {
    "signalingUrl": "wss://core.example.com/ws",
    "coreClientModuleUrl": "./vendor/board-games-core/board-games-core.mjs",
    "socialCatalogUrls": [
      "./social/common-party-pack/catalog.json",
      "./social/chess-theme/catalog.json"
    ]
  }
}
```

Load catalogs before rendering social UI:

```js
await core.loadSocialCatalogs(gameConfig.online.socialCatalogUrls);
const emojis = core.getSocialResources({ kind: "emoji" });
const reactions = core.getSocialResources({ kind: "reaction" });
const phrases = core.getSocialResources({ kind: "phrase" });
```

Games should render buttons and menus from `getSocialResources()`, not from raw catalog JSON. Invalid catalog entries are filtered before they reach the UI.

### Social Catalog Format

A catalog is one JSON file plus the assets it references:

```json
{
  "catalogVersion": 1,
  "catalogId": "common-party-pack",
  "label": "Common Party Pack",
  "emojis": [
    { "id": "smile", "label": "Smile", "asset": "./emoji/smile.webp", "alt": "smile" }
  ],
  "reactions": [
    { "id": "tomato", "label": "Tomato", "asset": "./reaction/tomato.webp", "targeting": "peer" }
  ],
  "phrases": [
    { "id": "good-game", "label": "Good game", "text": "Good game!" }
  ]
}
```

Required catalog fields are `catalogVersion`, `catalogId`, and `label`. Resource IDs are stable inside a catalog. Visual resources use `asset`; phrase resources use `text`. Relative `asset` paths are resolved against the catalog JSON URL.

Resolved resources have stable keys:

```text
common-party-pack:emoji:smile
common-party-pack:reaction:tomato
common-party-pack:phrase:good-game
```

Different catalogs may reuse the same resource ID because `catalogId` namespaces the key. If the same `catalogId` defines conflicting resources, the conflicting entries are rejected and appear only in `getSocialCatalogDiagnostics()`.

### Sending Social Messages

```js
core.sendChat("hello");
core.sendPhrase("common-party-pack:phrase:good-game");
core.sendEmoji("common-party-pack:emoji:smile");
core.sendReaction("common-party-pack:reaction:tomato", { targetPeerId: "peer-2" });
core.sendReaction("common-party-pack:reaction:rose", { targetPeerIds: ["peer-2", "peer-3"] });
```

These methods send a Core envelope with `type: "social-message"` over DataChannel. Chat broadcasts by default. Targeted reactions are sent only to the selected peer or peers.

Example reaction payload:

```json
{
  "kind": "reaction",
  "catalogId": "common-party-pack",
  "reactionId": "tomato",
  "resourceKey": "common-party-pack:reaction:tomato",
  "targetPeerIds": ["peer-2"],
  "clientMessageId": "msg_local_125",
  "createdAt": 1780000000000
}
```

Core only preserves the social meaning and catalog identity. The game decides how tomato, egg, rose, or any other reaction looks and animates.

### Receiving Social Messages

```js
core.addEventListener("social-message", (event) => {
  const { envelope, message, resource } = event.detail;
});
```

`resource` is the local resolved catalog resource when available, otherwise `null`. Games may show a fallback, ignore the message, or render their own missing-resource UI.
## Load Rules

To keep the server thin:

- Send game actions through `sendGameAction` or `sendGameMessage`.
- Do not send game actions through WebSocket signaling.
- Keep `presence` small and non-critical.
- Use snapshots for recovery, not for every frame.
- Prefer deterministic game logic on clients.
