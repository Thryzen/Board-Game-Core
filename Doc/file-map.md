# File Map

This document explains what each Core file does and which files game developers should touch.

## Root

### `README.md`

Project overview and documentation navigation.

Do not put detailed integration steps here. Keep it short and durable.

### `core.config.json`

Runtime config for the Core signaling server.

This file belongs to Core only. A game should have its own config file for public browser settings.

### `future.md`

Roadmap notes for possible future capabilities.

Future work should stay separate from the current protocol contract.

## Client

### `client/board-games-core.mjs`

Browser SDK.

Responsibilities:

- Connect to the signaling WebSocket.
- Create, join, and resume rooms.
- Maintain room and peer state.
- Create WebRTC peer connections.
- Open ordered DataChannels.
- Send and receive Core envelopes.
- Emit browser events for games to handle.
- Request and receive snapshots.

Games import this file, but should not modify it per game.

### `client/protocol.mjs`

P2P message envelope helpers.

Responsibilities:

- Define `CORE_VERSION`.
- Create message envelopes.
- Identify Core envelopes.
- Track sequence numbers and duplicate inbound messages.

Games should not bypass this envelope.

## Server

### `server/index.mjs`

Node entrypoint.

Responsibilities:

- Load `core.config.json`.
- Apply environment overrides.
- Start the signaling server.
- Close cleanly on `SIGINT` and `SIGTERM`.

### `server/config.mjs`

Core server config loader.

Responsibilities:

- Normalize config defaults.
- Validate positive integer settings.
- Load config from disk.
- Resolve environment overrides.

### `server/signaling-server.mjs`

HTTP and WebSocket signaling service.

Responsibilities:

- Serve `/health`.
- Accept `/ws` WebSocket upgrades.
- Handle room create, join, resume, heartbeat, signal, and presence messages.
- Bind sockets to room peers.
- Broadcast peer join, peer leave, peer resume, and host migration events.
- Run stale peer and empty room cleanup.

The signaling server is intentionally not a game server.

### `server/room-manager.mjs`

In-memory room model.

Responsibilities:

- Create private rooms.
- Add connected peers.
- Preserve disconnected peers for optional resume.
- Track host migration.
- Mark stale peers disconnected.
- Destroy empty rooms after `emptyRoomTtlMs`.

This file owns room lifecycle rules. It does not know game rules.

### `server/websocket.mjs`

Minimal dependency-free WebSocket implementation for the signaling server.

Responsibilities:

- Accept WebSocket handshakes.
- Encode server text frames.
- Decode browser masked text frames.
- Handle close and ping frames.

This keeps the Core server runnable without installing packages.

## Documentation

### `Doc/interfaces.md`

Public API and protocol contract.

### `Doc/file-map.md`

This file.

### `Doc/integration-guide.md`

Step-by-step guide for turning an offline game into a P2P online game with Core.

### `Doc/case-study.md`

Two-player chess-like integration example.

### `Doc/deployment.md`

Local and server deployment, including HTTP, HTTPS, and Nginx WebSocket proxy examples.

## Game-Owned Files

These are not Core files, but a game using Core usually has equivalents:

```text
game.config.json
src/online-adapter.*
src/rules.*
src/ui.*
```

The game owns:

- Seats and roles.
- Legal action validation.
- Victory and scoring.
- Snapshot format.
- How remote actions are applied.
- How online state is shown in UI.
