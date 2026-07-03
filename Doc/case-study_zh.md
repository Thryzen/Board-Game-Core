# 案例：双人网格棋类游戏

## 原本的离线游戏

原游戏具有：

- 矩形棋盘。
- 对立双方。
- 回合制移动。
- 合法行动生成。
- 吃子和胜负规则。
- 本地双人模式。
- 可选的本地 AI 模式。

离线游戏已经有类似这样的规则模块：

```js
createInitialState();
getLegalActions(state, pieceId);
applyAction(state, action);
applySurrender(state, side);
```

这让它很适合接入 Core，因为行动和状态都已经可以序列化。

## 在线目标

在线模式需要：

- 私有朋友房。
- 恰好两个活跃玩家。
- 不提供观战位。
- 房间码。
- P2P 行动传输。
- 对手加入前的等待状态。
- P2P 就绪前的等待状态。
- 玩家关闭标签页后，新玩家可顶替。

游戏不需要匹配、天梯、账号或服务端规则裁判。

## 配置拆分

Core 服务端拥有：

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

游戏拥有：

```json
{
  "online": {
    "signalingUrl": "ws://127.0.0.1:8787/ws",
    "coreClientModuleUrl": "./Core/client/board-games-core.mjs"
  }
}
```

玩家不需要输入信令服务器地址。

## 懒加载 SDK

游戏主 UI 不静态导入 Core。只有玩家请求在线模式时才加载：

```js
const { BoardGamesCoreClient } = await import(config.online.coreClientModuleUrl);
```

这样在线 SDK 路径错误不会影响离线模式。

## 创建房间

创建者开一个两人房：

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

UI 显示 `result.room.code`。

## 加入房间

第二个玩家只输入：

```text
玩家名
房间码
```

游戏调用：

```js
await core.joinRoom({ roomCode, displayName });
```

## 座位策略

游戏只按当前在线玩家分配座位：

```js
function seatedPeers(room) {
  return room.peers
    .filter((peer) => peer.connected !== false)
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .slice(0, 2);
}
```

第一个在线玩家为 A 方，第二个在线玩家为 B 方。

掉线玩家仍然保留在 Core 房间快照里，但不占用这个游戏的座位。

## 就绪策略

游戏等待两个条件：

1. 有两个已入座在线玩家。
2. 必要对手的 DataChannel 已打开。

在此之前，UI 显示：

```text
等待对手加入
正在建立P2P连接
```

两个条件都满足后才允许行动。

## 发送行动

本地验证通过后：

```js
applyLocalAction(action);
core.sendGameAction(action);
```

服务端不会收到这个游戏行动。

## 接收行动

```js
core.addEventListener("game-message", (event) => {
  const envelope = event.detail.envelope;
  if (envelope.type !== "game-action") return;

  const action = envelope.payload.action;
  applyRemoteAction(action);
});
```

游戏使用自己的规则引擎应用行动。

## 快照策略

房主提供：

```js
core.setSnapshotProvider(() => ({
  state: currentState,
  moveLog: currentMoveLog
}));
```

非房主连接到房主 DataChannel 后请求快照。快照通过 P2P 发送，不经过信令服务器。

## 掉线顶替

玩家关闭标签页后：

- Core 把该 peer 标记为掉线。
- 必要时 Core 迁移房主。
- 游戏按当前在线玩家重新计算座位。
- 新玩家用同一个房间码加入后，可以拿到空出的活跃座位。

这是游戏策略。其他游戏可以选择严格恢复。

## 经验

- Core 服务端保持轻量。
- 在线配置错误不会破坏离线模式。
- 游戏规则没有泄漏进 Core。
- 游戏自己负责座位和行动验证。
- DataChannel 就绪需要独立 UI 状态。
- 房间成员和游戏座位是两个概念。

## 不要盲目复制的部分

如果你的游戏有这些设计，不要直接复制两座位策略：

- 观战者。
- 队伍。
- 隐藏身份。
- 庄家。
- 超过两个活跃玩家。
- 只能原玩家恢复的座位。

保留 Core 传输模式，但写自己的座位策略。

## 增加 Catalog 快捷语和表情

游戏配置增加了一组静态 social catalog 地址：

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

这些 catalog URL 指向由游戏站点、共享资源站点或 CDN 提供的静态文件。Core 信令服务器不提供 catalog JSON、图片、动画或其他社交素材。

创建 Core client 后，游戏加载并解析 catalog：

```js
await core.loadSocialCatalogs(config.online.socialCatalogUrls ?? []);

const phrases = core.getSocialResources({ kind: "phrase" });
const emojis = core.getSocialResources({ kind: "emoji" });
```

游戏使用 Core 返回的已解析资源，而不是直接读取原始 catalog JSON。这样校验、资源 key、catalog 身份和相对 asset URL 解析都留在 Core 中完成。

玩家发送 catalog 快捷语时：

```js
core.sendPhrase(phraseResource);
```

Core 会通过和游戏行动相同的 P2P DataChannel 路径发送 `social-message` 信封。快捷语会被表示为带 catalog 身份的 chat：payload 中有 `kind: "chat"`，并带有 `phraseId`、`resourceKey` 和 `text`。

玩家发送表情时：

```js
core.sendEmoji(emojiResource);
```

Core 只发送稳定的 catalog 身份，例如：

```text
table-talk-starter-pack:emoji:dice-drama
```

图片本身不通过 Core 发送。每个 peer 都从自己已加载的 catalog 中解析同一个资源。

接收社交消息使用 Core 的 social 事件：

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

游戏自己决定如何呈现快捷语或表情。Core 只提供协议、catalog 解析器、资源身份和 P2P 传递。

关键原则保持不变：社交消息不会把信令服务器变成聊天服务器。Catalog 文件和素材是静态资源，快捷语或表情消息会在房间 DataChannel 就绪后走 P2P。
