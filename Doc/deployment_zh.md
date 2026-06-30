# 部署

Board Games Core 有两个需要部署的部分：

1. 静态游戏站点：提供 HTML、CSS、JavaScript、游戏资源、`game.config.json` 和 Core 浏览器 SDK。
2. Node 信令服务器：提供 `/health` 和 `/ws`。

浏览器 SDK 是静态文件。信令服务器是一个正在运行的 Node 进程。

## 本地开发

用任意静态 HTTP 服务托管游戏站点。

示例：

```bash
python -m http.server 8765 --bind 127.0.0.1
```

启动 Core：

```bash
node Core/server/index.mjs
```

使用这个游戏配置：

```json
{
  "online": {
    "signalingUrl": "ws://127.0.0.1:8787/ws",
    "coreClientModuleUrl": "./Core/client/board-games-core.mjs"
  }
}
```

打开：

```text
http://127.0.0.1:8765/
```

不要用 `file://` 打开 ES modules 项目。

## 局域网测试

如果同一局域网内的其他设备也要连接，需要让静态站点和 Core 服务监听局域网可访问地址。

静态站点：

```bash
python -m http.server 8765 --bind 0.0.0.0
```

Core 配置：

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 8787,
    "heartbeatTimeoutMs": 30000,
    "reapIntervalMs": 5000,
    "emptyRoomTtlMs": 180000
  }
}
```

游戏配置：

```json
{
  "online": {
    "signalingUrl": "ws://LAN_HOST_IP:8787/ws",
    "coreClientModuleUrl": "./Core/client/board-games-core.mjs"
  }
}
```

所有玩家都必须访问局域网主机 IP，不能使用 `127.0.0.1`。

## 服务器部署：HTTP

只有当游戏站点本身也是 HTTP 时，才使用 HTTP。

示例公开结构：

```text
http://game.example.com/
ws://core.example.com:8787/ws
```

Core 配置：

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 8787,
    "heartbeatTimeoutMs": 30000,
    "reapIntervalMs": 5000,
    "emptyRoomTtlMs": 180000
  }
}
```

游戏配置：

```json
{
  "online": {
    "signalingUrl": "ws://core.example.com:8787/ws",
    "coreClientModuleUrl": "./vendor/board-games-core/board-games-core.mjs"
  }
}
```

需要确认：

- TCP `8787` 端口对玩家开放。
- 静态游戏站点会把 `.mjs` 作为 JavaScript 文件提供。
- `coreClientModuleUrl` 指向静态游戏站点实际可访问的文件。

## 服务器部署：HTTPS

如果游戏站点使用 HTTPS，信令地址必须使用 WSS。

正确：

```text
https://game.example.com/
wss://core.example.com/ws
```

错误：

```text
https://game.example.com/
ws://core.example.com:8787/ws
```

浏览器会阻止 HTTPS 页面发起不安全的 WebSocket 连接。

## 推荐的 HTTPS 结构

让 Core 只监听本机：

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

用 Nginx 放在前面：

```text
public WSS -> Nginx TLS -> local Core WS
```

游戏配置：

```json
{
  "online": {
    "signalingUrl": "wss://core.example.com/ws",
    "coreClientModuleUrl": "./vendor/board-games-core/board-games-core.mjs"
  }
}
```

## Nginx HTTPS 反向代理

```nginx
server {
    listen 443 ssl http2;
    server_name core.example.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location /health {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

## 同域 HTTPS 结构

也可以让静态游戏和 Core WebSocket 使用同一个域名：

```text
https://game.example.com/
wss://game.example.com/ws
```

Nginx：

```nginx
server {
    listen 443 ssl http2;
    server_name game.example.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    root /var/www/my-game;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

游戏配置：

```json
{
  "online": {
    "signalingUrl": "wss://game.example.com/ws",
    "coreClientModuleUrl": "./vendor/board-games-core/board-games-core.mjs"
  }
}
```

## HTTP 反向代理

如果你明确要用 HTTP 托管游戏，可以不启用 TLS，直接代理 WS：

```nginx
server {
    listen 80;
    server_name core.example.com;

    location /ws {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

游戏配置：

```json
{
  "online": {
    "signalingUrl": "ws://core.example.com/ws",
    "coreClientModuleUrl": "./vendor/board-games-core/board-games-core.mjs"
  }
}
```

## 静态 MIME 类型

浏览器要求 module script 以 JavaScript 类型提供。

请确认 `.mjs` 的 MIME 类型是：

```text
application/javascript
text/javascript
```

Nginx 通常会通过 `mime.types` 支持这一点。如果没有，可以添加：

```nginx
types {
    application/javascript js mjs;
}
```

## 域名还是 IP？

HTTP 下，只要玩家能访问，公网 IP 可以工作。

HTTPS/WSS 下，建议使用域名。TLS 证书必须匹配玩家在浏览器中访问的主机名。常规做法是使用域名证书。

## 防火墙检查

- 静态站点端口已开放。
- Nginx 的 HTTP/HTTPS 端口已开放。
- 只有在你明确要直接暴露 Core 时，才开放 Core 端口。
- 如果使用 Nginx，Core 可以只监听 `127.0.0.1`。

## P2P 连通性

信令服务器部署成功，不等于所有 P2P 连接都一定能建立。

对于限制严格的 NAT，后续可以通过 SDK 的 `iceServers` 选项添加 TURN。在 TURN 补齐之前，部分网络可能会出现房间创建和 WebSocket 信令正常，但 DataChannel 建立失败的情况。
