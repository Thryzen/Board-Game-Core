# Deployment

Board Games Core has two deployable pieces:

1. A static game site that serves HTML, CSS, JavaScript, game assets, `game.config.json`, and the Core browser SDK.
2. A Node signaling server that serves `/health` and `/ws`.

The browser SDK is a static file. The signaling server is a running Node process.

## Local Development

Serve the game site with any static HTTP server.

Example:

```bash
python -m http.server 8765 --bind 127.0.0.1
```

Start Core:

```bash
node Core/server/index.mjs
```

Use this game config:

```json
{
  "online": {
    "signalingUrl": "ws://127.0.0.1:8787/ws",
    "coreClientModuleUrl": "./Core/client/board-games-core.mjs"
  }
}
```

Open:

```text
http://127.0.0.1:8765/
```

Do not use `file://` for ES modules.

## Local Network Testing

If another device on the same LAN should connect, bind the static site and Core server to an address reachable from the LAN.

Static site:

```bash
python -m http.server 8765 --bind 0.0.0.0
```

Core config:

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

Game config:

```json
{
  "online": {
    "signalingUrl": "ws://LAN_HOST_IP:8787/ws",
    "coreClientModuleUrl": "./Core/client/board-games-core.mjs"
  }
}
```

Every player must use the LAN host IP, not `127.0.0.1`.

## Server Deployment: HTTP

Use HTTP only when the game site is also HTTP.

Example public layout:

```text
http://game.example.com/
ws://core.example.com:8787/ws
```

Core config:

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

Game config:

```json
{
  "online": {
    "signalingUrl": "ws://core.example.com:8787/ws",
    "coreClientModuleUrl": "./vendor/board-games-core/board-games-core.mjs"
  }
}
```

Make sure:

- TCP port `8787` is open to players.
- The static game site serves `.mjs` as JavaScript.
- `coreClientModuleUrl` points to a file served by the static game site.

## Server Deployment: HTTPS

If the game site uses HTTPS, the signaling URL must use WSS.

Good:

```text
https://game.example.com/
wss://core.example.com/ws
```

Bad:

```text
https://game.example.com/
ws://core.example.com:8787/ws
```

Browsers block insecure WebSocket connections from HTTPS pages.

## Recommended HTTPS Layout

Run Core on localhost:

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

Put Nginx in front:

```text
public WSS -> Nginx TLS -> local Core WS
```

Game config:

```json
{
  "online": {
    "signalingUrl": "wss://core.example.com/ws",
    "coreClientModuleUrl": "./vendor/board-games-core/board-games-core.mjs"
  }
}
```

## Nginx HTTPS Reverse Proxy

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

## Same-Domain HTTPS Layout

You may serve the static game and Core WebSocket from the same domain:

```text
https://game.example.com/
wss://game.example.com/ws
```

Nginx:

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

Game config:

```json
{
  "online": {
    "signalingUrl": "wss://game.example.com/ws",
    "coreClientModuleUrl": "./vendor/board-games-core/board-games-core.mjs"
  }
}
```

## HTTP Reverse Proxy

If you are intentionally serving the game over HTTP, you can proxy WS without TLS:

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

Game config:

```json
{
  "online": {
    "signalingUrl": "ws://core.example.com/ws",
    "coreClientModuleUrl": "./vendor/board-games-core/board-games-core.mjs"
  }
}
```

## Static MIME Types

Browsers require module scripts to be served as JavaScript.

Make sure `.mjs` is served as:

```text
application/javascript
text/javascript
```

Nginx usually supports this through `mime.types`. If not, add:

```nginx
types {
    application/javascript js mjs;
}
```

## Domain or IP?

For HTTP, a public IP can work if players can reach it.

For HTTPS/WSS, use a domain. TLS certificates must match the host that players open in the browser. Domain-based certificates are the normal path.

## Firewall Checklist

- Static site port is open.
- Nginx HTTP/HTTPS ports are open.
- Direct Core port is open only if you intentionally expose it.
- If using Nginx, Core may listen on `127.0.0.1`.

## P2P Connectivity

Deployment of the signaling server does not guarantee every P2P connection will succeed.

For restrictive NATs, add TURN later through the SDK `iceServers` option. Until TURN exists, some networks may fail to establish a DataChannel even though room creation and WebSocket signaling work.
