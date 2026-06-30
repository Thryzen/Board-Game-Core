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
