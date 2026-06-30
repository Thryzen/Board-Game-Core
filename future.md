# Future Work

Board Games Core should stay small. Future features should be added only when they preserve the central rule: keep gameplay traffic peer-to-peer whenever possible and keep the server thin.

## Connectivity

- TURN support in `iceServers` for restrictive NATs.
- Optional TURN credential rotation.
- Connection diagnostics exposed by the client SDK.
- Optional server relay fallback for rare failed P2P sessions, disabled by default.

## Room Controls

- Room passwords or invite secrets.
- Room metadata for public display inside a private lobby.
- Configurable room capacity policies for games with players and observers.
- Optional room ownership transfer controls beyond automatic host migration.

## Reliability

- Persistent room storage for server restarts.
- Snapshot versioning and checksum helpers.
- Optional action log replay helpers.
- Better reconnect UX helpers for games that want strict session recovery.

## Scale

- Multi-process or multi-instance room state coordination.
- Redis or lightweight external presence storage.
- Graceful draining for rolling deploys.
- Rate limits for room creation, joins, and signaling bursts.

## Security

- Origin allowlists.
- Per-room capability tokens.
- Input size limits per message type.
- Abuse logging and IP-level throttling.

## Developer Experience

- TypeScript definitions.
- Packaged browser SDK build.
- Example adapters for multiple game genres.
- Protocol conformance tests that downstream games can run.
- Optional debug panel for room, peer, and DataChannel state.
