# Board Games Core

Board Games Core is a small online layer for private tabletop sessions.

It is built around one principle: the server should help friends find each other, then get out of the way. Rooms, heartbeats, host migration, and WebRTC signaling live on the server. Game actions, snapshots, and recovery data travel peer-to-peer through WebRTC DataChannels whenever possible.

The Core does not know chess, cards, dice, victory rules, legal moves, scoring, decks, hands, turns, or seats. Those belong to the game. The Core only provides a stable room and transport contract so many different offline board games can become consistent low-load online games.

## What It Is Good At

- Private friend rooms for 2-N players.
- Thin signaling servers with low CPU and bandwidth pressure.
- P2P-first game traffic through ordered DataChannels.
- Reusable browser SDK for game clients.
- Disconnect detection, host migration, and empty-room cleanup.
- A fixed message envelope that keeps integrations consistent.

## What It Refuses To Become

- A matchmaking ladder.
- A rule engine.
- A game-state authority.
- A high-load relay server by default.
- A place to hide game-specific behavior.

## Documentation

- [Interfaces](./Doc/interfaces.md)
- [File Map](./Doc/file-map.md)
- [Integration Guide](./Doc/integration-guide.md)
- [Case Study](./Doc/case-study.md)
- [Deployment](./Doc/deployment.md)
- [Future Work](./future.md)

Chinese versions are available beside each document with the `_zh.md` suffix.
