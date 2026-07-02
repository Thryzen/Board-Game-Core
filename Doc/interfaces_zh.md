# 接口说明

本文定义 Board Games Core 的公共接口。游戏项目应该使用这些接口，不要直接依赖 Core 的内部实现。

## 服务端入口

启动信令服务：

```bash
node Core/server/index.mjs
```

默认读取：

```text
Core/core.config.json
```

可以用环境变量覆盖配置：

```text
HOST
PORT
HEARTBEAT_TIMEOUT_MS
REAP_INTERVAL_MS
EMPTY_ROOM_TTL_MS
CORE_CONFIG_PATH
```

## Core 配置

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

- `host`：Node 服务监听地址。
- `port`：Node 服务监听端口。
- `heartbeatTimeoutMs`：一个已连接玩家多久没有心跳后会被标记为掉线。
- `reapIntervalMs`：服务端多久检查一次掉线玩家和空房间。
- `emptyRoomTtlMs`：房间没有任何在线玩家后保留多久。

## HTTP 接口

### `GET /health`

返回：

```json
{ "ok": true }
```

可用于部署健康检查。

## WebSocket 接口

WebSocket 地址：

```text
/ws
```

通常浏览器 SDK 会替你发送这些消息。这里主要用于理解协议，或以后实现其他语言/平台 SDK。

### 创建房间

客户端到服务端：

```json
{
  "type": "create",
  "gameId": "your-game-id",
  "displayName": "Player",
  "maxPeers": 2
}
```

服务端返回给创建者：

```json
{
  "type": "room-created",
  "room": {},
  "self": {}
}
```

### 加入房间

客户端到服务端：

```json
{
  "type": "join",
  "roomCode": "ABC123",
  "displayName": "Player"
}
```

服务端返回给加入者：

```json
{
  "type": "room-joined",
  "room": {},
  "self": {}
}
```

服务端广播给房间内其他玩家：

```json
{
  "type": "peer-joined",
  "room": {},
  "peer": {}
}
```

### 恢复连接

客户端到服务端：

```json
{
  "type": "resume",
  "roomCode": "ABC123",
  "peerId": "peer-id",
  "sessionToken": "session-token"
}
```

服务端返回：

```json
{
  "type": "room-resumed",
  "room": {},
  "self": {}
}
```

如果游戏采用“新人顶替掉线座位”的策略，可以不使用 resume。

### 心跳

客户端到服务端：

```json
{ "type": "heartbeat" }
```

服务端返回：

```json
{
  "type": "heartbeat",
  "room": {},
  "self": {}
}
```

### WebRTC 信令转发

客户端到服务端：

```json
{
  "type": "signal",
  "to": "target-peer-id",
  "signalType": "offer",
  "payload": {}
}
```

`signalType` 可以是：

```text
offer
answer
ice
```

服务端转发给目标玩家：

```json
{
  "type": "signal",
  "from": "sender-peer-id",
  "signalType": "offer",
  "payload": {}
}
```

服务端只转发信令，不理解 SDP 或 ICE 内容。

### Presence

客户端到服务端：

```json
{
  "type": "presence",
  "payload": {}
}
```

服务端广播给其他玩家：

```json
{
  "type": "presence",
  "from": "sender-peer-id",
  "payload": {}
}
```

Presence 只适合很小的非关键状态，例如光标、正在选择选项等。

## 房间对象

公开房间快照格式：

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

`self` 额外包含：

```json
{
  "sessionToken": "private-token"
}
```

不要把 `sessionToken` 展示给其他玩家。

## 浏览器 SDK

从游戏配置指定的路径动态导入：

```js
const { BoardGamesCoreClient } = await import(coreClientModuleUrl);
```

创建客户端：

```js
const core = new BoardGamesCoreClient({
  signalingUrl: "wss://core.example.com/ws",
  gameId: "your-game-id",
  maxPeers: 2
});
```

可选构造参数：

```js
{
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  webSocketFactory: (url) => new WebSocket(url),
  peerConnectionFactory: (config) => new RTCPeerConnection(config)
}
```

### 方法

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

### 事件

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

事件数据都在 `event.detail`。

## P2P 消息信封

所有游戏侧 DataChannel 消息都使用同一种信封：

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

Core 保留这些类型：

```text
game-action
snapshot-request
game-snapshot
```

游戏可以扩展自己的 `type`，但必须保留这个信封结构。

## 社交协议

社交功能是可选能力，和游戏消息一样走 P2P DataChannel。Core 服务端不转发聊天、表情、文字片段、互动，也不托管社交素材。

游戏通常在自己的公开前端配置里声明社交 catalog 路径：

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

渲染社交 UI 前加载 catalog：

```js
await core.loadSocialCatalogs(gameConfig.online.socialCatalogUrls);
const emojis = core.getSocialResources({ kind: "emoji" });
const reactions = core.getSocialResources({ kind: "reaction" });
const phrases = core.getSocialResources({ kind: "phrase" });
```

游戏应该用 `getSocialResources()` 返回的资源来渲染按钮和菜单，不要直接展示原始 catalog JSON。非法 catalog 项会在进入 UI 前被过滤。

### 社交 Catalog 格式

一份 catalog 是一个 JSON 文件加上它引用的 assets：

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

catalog 必填字段是 `catalogVersion`、`catalogId` 和 `label`。资源 ID 在 catalog 内稳定。视觉资源使用 `asset`，文字片段使用 `text`。相对 `asset` 路径会按 catalog JSON 的 URL 解析。

解析后的资源有稳定 key：

```text
common-party-pack:emoji:smile
common-party-pack:reaction:tomato
common-party-pack:phrase:good-game
```

不同 catalog 可以复用同一个资源 ID，因为 `catalogId` 会作为命名空间。如果同一个 `catalogId` 定义了互相冲突的资源，冲突项会被拒绝，只出现在 `getSocialCatalogDiagnostics()` 里。

### 发送社交消息

```js
core.sendChat("hello");
core.sendPhrase("common-party-pack:phrase:good-game");
core.sendEmoji("common-party-pack:emoji:smile");
core.sendReaction("common-party-pack:reaction:tomato", { targetPeerId: "peer-2" });
core.sendReaction("common-party-pack:reaction:rose", { targetPeerIds: ["peer-2", "peer-3"] });
```

这些方法会通过 DataChannel 发送 `type: "social-message"` 的 Core 信封。聊天默认广播。定向互动只发送给选中的一个或多个 peer。

互动 payload 示例：

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

Core 只保留社交语义和 catalog 身份。番茄、鸡蛋、玫瑰或其他互动如何显示和播放动画，由游戏自己决定。

### 接收社交消息

```js
core.addEventListener("social-message", (event) => {
  const { envelope, message, resource } = event.detail;
});
```

如果本地有对应 catalog 资源，`resource` 就是解析后的资源；否则是 `null`。游戏可以显示降级文本、忽略消息，或渲染自己的缺失资源提示。
## 低负载规则

为了保持服务端轻量：

- 游戏行动通过 `sendGameAction` 或 `sendGameMessage` 发送。
- 不要通过 WebSocket 信令发送游戏行动。
- `presence` 只放小型非关键状态。
- 快照用于恢复，不要每帧发送。
- 尽量让客户端规则逻辑可确定复现。
