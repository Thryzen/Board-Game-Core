# Case Study: Two-Player Grid Board Game

## Original Offline Game

The original game had:

- A rectangular board.
- Two opposing sides.
- Turn-based movement.
- Legal action generation.
- Capture and victory rules.
- Local two-player mode.
- Optional single-player mode against a local AI.

The offline game already had a rule module with functions shaped like:

```js
createInitialState();
getLegalActions(state, pieceId);
applyAction(state, action);
applySurrender(state, side);
```

That made it a good Core integration candidate because actions and state were already serializable.

## Online Goal

The online mode needed:

- Private friend rooms.
- Exactly two active players.
- No spectator role.
- A room code.
- P2P action transport.
- A visible waiting state before the opponent connects.
- A visible waiting state before P2P is ready.
- Replacement joins when one player closes the tab.

The game did not need matchmaking, rankings, accounts, or server-side rule enforcement.

## Config Split

The Core server owns:

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

The game owns:

```json
{
  "online": {
    "signalingUrl": "ws://127.0.0.1:8787/ws",
    "coreClientModuleUrl": "./Core/client/board-games-core.mjs"
  }
}
```

The player never types the signaling URL.

## Lazy SDK Loading

The game does not statically import Core from its main UI module. It loads the SDK only when online play is requested:

```js
const { BoardGamesCoreClient } = await import(config.online.coreClientModuleUrl);
```

This prevents a broken online SDK path from breaking offline modes.

## Room Creation

The creator starts a two-player room:

```js
const core = new BoardGamesCoreClient({
  signalingUrl: config.online.signalingUrl,
  gameId: "grid-board-game",
  maxPeers: 2
});

const result = await core.createRoom({
  displayName: playerName,
  maxPeers: 2
});
```

The UI shows the room code from `result.room.code`.

## Joining

The second player enters only:

```text
player name
room code
```

The game calls:

```js
await core.joinRoom({ roomCode, displayName });
```

## Seat Policy

The game uses connected peers only:

```js
function seatedPeers(room) {
  return room.peers
    .filter((peer) => peer.connected !== false)
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .slice(0, 2);
}
```

The first connected peer becomes side A. The second connected peer becomes side B.

Disconnected peers remain in the Core room snapshot for possible recovery, but they do not occupy seats in this game.

## Readiness Policy

The game waits for two conditions:

1. Two seated connected players exist.
2. DataChannels to required opponents are open.

Before that, the UI shows:

```text
waiting for opponent
building P2P connection
```

The player cannot move until both conditions are true.

## Sending Actions

After local validation:

```js
applyLocalAction(action);
core.sendGameAction(action);
```

The server never receives this game action.

## Receiving Actions

```js
core.addEventListener("game-message", (event) => {
  const envelope = event.detail.envelope;
  if (envelope.type !== "game-action") return;

  const action = envelope.payload.action;
  applyRemoteAction(action);
});
```

The game uses its own rule engine to apply the action.

## Snapshot Policy

The host provides:

```js
core.setSnapshotProvider(() => ({
  state: currentState,
  moveLog: currentMoveLog
}));
```

When a non-host connects to the host DataChannel, it requests a snapshot. The snapshot travels through P2P, not through signaling.

## Disconnect Replacement

When a player closes the tab:

- Core marks that peer disconnected.
- Core migrates host if needed.
- The game recomputes seats from connected peers only.
- A new player joining the same room can take the open active seat.

This is a game policy. Another game could choose strict resume instead.

## Lessons

- The Core server stayed thin.
- Offline modes kept working even if online config was wrong.
- The game did not leak rules into Core.
- The game owned seats and action validation.
- DataChannel readiness needed its own UI state.
- Room membership and game seats were different concepts.

## What Not To Copy Blindly

Do not copy the two-seat policy if your game has:

- Spectators.
- Teams.
- Hidden roles.
- A dealer.
- More than two active players.
- Rejoin-only seats.

Keep the Core transport pattern, but write your own seat policy.

## Adding Catalog Phrases and Emojis

The game config gained a static social catalog list:

```json
{
  "online": {
    "signalingUrl": "wss://core.example.com/ws",
    "coreClientModuleUrl": "./vendor/board-games-core/board-games-core.mjs",
    "socialCatalogUrls": [
      "./social/table-talk-starter-pack/catalog.json"
    ]
  }
}
```

These catalog URLs point to static files served by the game site, a shared asset host, or a CDN. The Core signaling server does not serve catalog JSON, images, animations, or other social assets.

After creating the Core client, the game loads and resolves the catalogs:

```js
await core.loadSocialCatalogs(config.online.socialCatalogUrls ?? []);

const phrases = core.getSocialResources({ kind: "phrase" });
const emojis = core.getSocialResources({ kind: "emoji" });
```

The game uses the resolved resources returned by Core instead of reading raw catalog JSON directly. This keeps validation, resource keys, catalog identity, and relative asset URL resolution inside Core.

When a player sends a catalog phrase:

```js
core.sendPhrase(phraseResource);
```

Core sends a `social-message` envelope over the same P2P DataChannel path used by game actions. A phrase is represented as catalog-backed chat: the payload has `kind: "chat"` plus `phraseId`, `resourceKey`, and `text`.

When a player sends an emoji:

```js
core.sendEmoji(emojiResource);
```

Core sends only the stable catalog identity, such as:

```text
table-talk-starter-pack:emoji:dice-drama
```

The image itself is not sent through Core. Each peer resolves the same resource locally from its loaded catalogs.

Receiving social messages uses Core's social event:

```js
core.addEventListener("social-message", (event) => {
  const { envelope, message, resource } = event.detail;

  if (message.kind === "chat" && message.phraseId) {
    applyIncomingPhrase(envelope.senderId, message.text, resource);
  }

  if (message.kind === "emoji" && resource) {
    applyIncomingEmoji(envelope.senderId, resource);
  }
});
```

The game chooses how to present the phrase or emoji. Core only provides the protocol, catalog resolver, resource identity, and P2P delivery.

The important rule stayed the same: social messages do not turn the signaling server into a chat server. Catalog files and assets are static resources, and phrase or emoji messages travel peer-to-peer whenever the room's DataChannels are ready.
