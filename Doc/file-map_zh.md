# 文件地图

本文说明 Core 中每个文件的职责，以及游戏开发者通常应该接触哪些文件。

## 根目录

### `README.md`

项目简介和文档导航。

这里不放具体接入步骤，保持简洁稳定。

### `core.config.json`

Core 信令服务运行配置。

这份配置只属于 Core。游戏项目应该有自己的公开前端配置文件。

### `future.md`

未来能力规划。

未来计划和当前协议合同分开，避免还没实现的能力被误当成可用接口。

## Client

### `client/board-games-core.mjs`

浏览器 SDK。

职责：

- 连接信令 WebSocket。
- 创建、加入、恢复房间。
- 维护房间和玩家状态。
- 创建 WebRTC peer connection。
- 打开有序 DataChannel。
- 发送和接收 Core 信封消息。
- 加载和归一化可选社交 catalog。
- 发送和接收 P2P 社交消息。
- 向游戏抛出浏览器事件。
- 请求和接收快照。

游戏会导入这个文件，但不应该为了某个游戏改它。

### `client/protocol.mjs`

P2P 消息信封工具。

职责：

- 定义 `CORE_VERSION`。
- 创建消息信封。
- 判断一个对象是否是 Core 信封。
- 维护序号，并过滤重复入站消息。

游戏不应该绕过这个信封。

### `client/social-catalog.mjs`

社交 catalog 归一化工具。

职责：

- 注册一份或多份游戏提供的社交 catalog JSON。
- 按 catalog URL 解析相对 asset 路径。
- 创建稳定资源 key，例如 `catalogId:reaction:tomato`。
- 在游戏展示给玩家前过滤非法资源。
- 记录 catalog 或资源冲突的诊断信息。

Core 不内置素材，也不决定资源怎么渲染。

### `client/social-protocol.mjs`

社交消息 payload 工具。

职责：

- 创建聊天、表情、文字片段和互动 payload。
- 在社交消息中保留 catalog 身份。
- 归一化定向互动的 peerId。

消息仍然放在普通 P2P Core 信封里传输。

## Server

### `server/index.mjs`

Node 启动入口。

职责：

- 读取 `core.config.json`。
- 应用环境变量覆盖。
- 启动信令服务。
- 在 `SIGINT` 和 `SIGTERM` 时关闭服务。

### `server/config.mjs`

Core 服务端配置加载器。

职责：

- 归一化默认配置。
- 校验正整数配置。
- 从磁盘读取配置。
- 解析环境变量覆盖。

### `server/signaling-server.mjs`

HTTP 和 WebSocket 信令服务。

职责：

- 提供 `/health`。
- 接受 `/ws` WebSocket upgrade。
- 处理 create、join、resume、heartbeat、signal、presence。
- 把 socket 绑定到房间玩家。
- 广播玩家加入、恢复、离开和房主迁移事件。
- 定期清理掉线玩家和空房间。

它不是游戏服务器。

### `server/room-manager.mjs`

内存房间模型。

职责：

- 创建私有房间。
- 添加在线玩家。
- 保留掉线玩家记录以支持可选恢复。
- 处理房主迁移。
- 标记心跳超时玩家为掉线。
- 在 `emptyRoomTtlMs` 后销毁空房间。

它只知道房间生命周期，不知道任何游戏规则。

### `server/websocket.mjs`

无依赖的最小 WebSocket 实现。

职责：

- 接受 WebSocket 握手。
- 编码服务端文本帧。
- 解码浏览器 masked 文本帧。
- 处理 close 和 ping。

这样 Core 服务端无需安装包也能运行。

## Documentation

### `Doc/interfaces.md`

公共 API 和协议合同。

### `Doc/file-map.md`

本文件。

### `Doc/integration-guide.md`

把离线游戏改造成 Core P2P 在线游戏的手把手指南。

### `Doc/case-study.md`

双人棋类接入案例。

### `Doc/deployment.md`

本地部署、服务器部署、HTTP、HTTPS 和 Nginx WebSocket 反向代理。

## 游戏侧文件

这些不是 Core 文件，但使用 Core 的游戏通常会有对应文件：

```text
game.config.json
src/online-adapter.*
src/rules.*
src/ui.*
```

游戏自己负责：

- 座位和角色。
- 合法行动判断。
- 胜负和计分。
- 快照格式。
- 远程行动如何应用。
- 在线状态如何显示。
