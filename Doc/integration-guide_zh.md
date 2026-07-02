# 接入指南

本文面向已经有离线桌游项目、想用 Board Games Core 增加私有朋友局联机功能的开发者。

目标是保证接入方式可重用：游戏相关逻辑留在游戏内，同时避免不小心把信令服务器变成高负载游戏服务器。

## 核心原则

Core 不理解你的游戏。你的游戏也不向 Core 询问某个行动是否合法。

Core 提供：

- 私有房间。
- 玩家身份。
- Presence。
- 掉线检测。
- 房主迁移。
- WebRTC 信令。
- 有序 P2P DataChannel。
- 固定消息信封。

游戏提供：

- 座位和角色。
- 合法行动。
- 回合顺序。
- 随机性策略。
- 状态快照。
- 胜负和计分。
- UI。

## 目标架构

```text
浏览器游戏 UI
  |
  | 调用
  v
游戏在线适配层
  |
  | 使用
  v
Board Games Core Client
  |
  | WebSocket：房间、心跳、WebRTC 信令
  v
轻量 Core 服务端

Peer-to-peer DataChannel：
游戏行动、快照、恢复数据
```

在线适配层应该保持小而清晰。它只负责把游戏和 Core 接起来，不应该塞进整个游戏规则。

## 第 1 步：让离线游戏逻辑可确定复现

接入 Core 之前，离线游戏最好已经有规则层：

```js
const nextState = applyAction(currentState, action);
```

好的行动格式：

```json
{
  "kind": "move",
  "pieceId": "p12",
  "to": { "x": 3, "y": 4 }
}
```

不好的行动格式：

```json
{
  "kind": "clicked-dom-button-17"
}
```

行动应该描述游戏意图，而不是 UI 操作细节。

## 第 2 步：定义游戏在线配置

游戏拥有自己的公开前端配置：

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

- `signalingUrl` 指向部署好的 Core 服务端。
- `coreClientModuleUrl` 指向静态站点提供的 Core 浏览器 SDK 文件。

不要让玩家手动填写信令服务器地址。

## 第 3 步：懒加载 Core SDK

只在玩家进入在线模式时加载 Core：

```js
const { BoardGamesCoreClient } = await import(gameConfig.online.coreClientModuleUrl);
```

这样即使在线 SDK 路径配置错了，本地模式也不会坏。

## 第 4 步：创建 Core Client

```js
const core = new BoardGamesCoreClient({
  signalingUrl: gameConfig.online.signalingUrl,
  gameId: "my-game",
  maxPeers: 2
});
```

`gameId` 应该稳定标识游戏类型，不是房间 ID。

多人游戏可以设置：

```js
maxPeers: 4
```

## 第 5 步：创建和加入房间

创建者：

```js
const { room, self } = await core.createRoom({
  displayName: playerName,
  maxPeers: 2
});
```

加入者：

```js
const { room, self } = await core.joinRoom({
  roomCode,
  displayName: playerName
});
```

把当前 `room` 和 `self` 保存在游戏在线适配层。

## 第 6 步：在游戏层分配座位

Core 不分配游戏角色。

双人游戏可以这样：

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

如果游戏有观战、队伍、座位号、庄家或隐藏身份，都应该在游戏适配层实现。

## 第 7 步：等待 P2P 就绪

房间满员不代表 P2P DataChannel 已经打开。

监听：

```text
peer-channel-open
peer-channel-close
```

只有所有必要对手的通道都打开后，才允许玩家行动。

## 第 8 步：提供快照

注册快照提供函数：

```js
core.setSnapshotProvider(() => ({
  state: getSerializableGameState(),
  log: getActionLog(),
  version: currentStateVersion
}));
```

快照用于恢复和同步，不应该每一帧发送。

## 第 9 步：发送本地行动

本地玩家执行合法行动后：

```js
if (!isLegalAction(state, action)) return;

applyLocalAction(action);
core.sendGameAction(action);
```

Core 会把它包装成信封，通过 DataChannel 发送。

不要通过 WebSocket 发送游戏行动。

## 第 10 步：接收远程行动

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

远程行动仍然要由游戏规则层验证。Core 只是运输消息，不负责证明消息可信。

## 第 11 步：处理快照

```js
core.addEventListener("snapshot", (event) => {
  restoreSnapshot(event.detail.snapshot);
});
```

非房主在连接到房主 DataChannel 后，可以请求快照：

```js
core.requestSnapshot(room.hostId);
```

快照通过 P2P 发送，不通过信令服务器。

## 第 12 步：处理掉线

```js
core.addEventListener("peer-left", (event) => {
  updateRoom(event.detail.room);
  pauseIfRequiredPeerMissing();
});

core.addEventListener("host-changed", (event) => {
  updateRoom(event.detail.room);
});
```

游戏需要选择自己的策略：

- 新人顶替：新玩家可以顶替掉线座位。
- 严格恢复：必须同一个浏览器带 `peerId` 和 `sessionToken` 恢复。
- 观战模式：掉线座位保留，其他人只能观战。

Core 支持这些策略的传输基础，具体选择由游戏决定。

## 第 13 步：保持服务器低负载

这些是接入规则，不是建议：

- WebSocket 只用于房间、心跳、presence 和 WebRTC 信令。
- 游戏行动走 DataChannel。
- 快照走 DataChannel。
- 不要通过 Core 流式发送动画状态。
- 不要通过 Core 发送大资源。
- 不要用高频全量快照代替行动。
- Presence 负载要小。
- 优先使用可确定复现的行动日志。

如果 P2P 失败，应该显示连接错误。后续可以加 TURN 或受控 relay，但不要悄悄把所有游戏流量塞进信令服务器。

## 可选：添加聊天、表情、文字片段和互动

社交功能仍然属于游戏自己的 UI。Core 提供共享协议和 catalog 解析器，让多个游戏可以使用同一套资源包。

一份 social catalog 是一个 JSON 文件加引用的 assets：

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

创建 Core client 后加载 catalog：

```js
await core.loadSocialCatalogs(gameConfig.online.socialCatalogUrls ?? []);

const socialResources = core.getSocialResources();
const emojiButtons = core.getSocialResources({ kind: "emoji" });
const reactionButtons = core.getSocialResources({ kind: "reaction" });
const phraseButtons = core.getSocialResources({ kind: "phrase" });
```

用这些解析后的资源渲染社交 UI。每个资源都有稳定 `key`、`label`、可选 `assetUrl` 和 catalog 身份。非法资源和冲突定义会在玩家点击之前被过滤掉。

根据 UI 操作发送消息：

```js
core.sendChat(chatInput.value);
core.sendPhrase(phraseResource);
core.sendEmoji(emojiResource);
core.sendReaction(reactionResource, { targetPeerId: opponentPeerId });
```

接收并渲染社交消息：

```js
core.addEventListener("social-message", (event) => {
  const { message, resource, envelope } = event.detail;

  if (message.kind === "chat") showChatBubble(envelope.senderId, message.text);
  if (message.kind === "emoji" && resource) showEmoji(envelope.senderId, resource.assetUrl);
  if (message.kind === "reaction" && resource) playReaction(resource, message.targetPeerIds);
});
```

不要把图片、动画或高频动画状态放进 Core 消息。消息只发送稳定资源身份，由每个游戏在本地渲染效果。
## 最小适配层形状

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

尽量让适配层独立于渲染代码。

## 接入检查清单

- 游戏行动可序列化。
- 游戏状态快照可序列化。
- 游戏配置和 Core 配置分离。
- Core client SDK 由游戏静态站点提供。
- 游戏行动等待 `peer-channel-open` 后才允许。
- 远程行动由游戏规则验证。
- 快照用于恢复，不用于日常行动传输。
- WebSocket 不传游戏行动。
- 掉线策略明确。
- 空房间由 Core 清理。
