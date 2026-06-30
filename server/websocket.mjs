import crypto from "node:crypto";

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function createAcceptKey(clientKey) {
  return crypto.createHash("sha1").update(`${clientKey}${WS_MAGIC}`).digest("base64");
}

export function encodeTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  if (payload.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

export function encodeCloseFrame() {
  return Buffer.from([0x88, 0]);
}

export function encodePongFrame(payload = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([0x8a, payload.length]), payload]);
}

export function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break;
      const bigLength = buffer.readBigUInt64BE(offset + 2);
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("frame too large");
      length = Number(bigLength);
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (offset + frameLength > buffer.length) break;

    const payloadStart = offset + headerLength + maskLength;
    const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + length));
    if (masked) {
      const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }

    if (opcode === 1) messages.push({ opcode, text: payload.toString("utf8") });
    if (opcode === 8) messages.push({ opcode, close: true });
    if (opcode === 9) messages.push({ opcode, ping: payload });
    offset += frameLength;
  }

  return {
    messages,
    remaining: buffer.subarray(offset),
  };
}

export function acceptWebSocket(request, socket, { onMessage, onClose }) {
  const key = request.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return null;
  }

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${createAcceptKey(key)}`,
      "",
      "",
    ].join("\r\n"),
  );

  let buffer = Buffer.alloc(0);
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    try {
      socket.write(encodeCloseFrame());
    } catch {
      // Socket may already be closed.
    }
    socket.destroy();
    onClose?.();
  }

  const connection = {
    send(value) {
      if (closed) return;
      socket.write(encodeTextFrame(typeof value === "string" ? value : JSON.stringify(value)));
    },
    close,
  };

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let decoded;
    try {
      decoded = decodeFrames(buffer);
    } catch {
      close();
      return;
    }
    buffer = decoded.remaining;
    for (const message of decoded.messages) {
      if (message.close) {
        close();
      } else if (message.ping) {
        socket.write(encodePongFrame(message.ping));
      } else if (message.text) {
        onMessage?.(message.text, connection);
      }
    }
  });

  socket.on("close", () => {
    if (closed) return;
    closed = true;
    onClose?.();
  });

  socket.on("error", () => close());
  return connection;
}
