/**
 * A minimal WebSocket server, by hand.
 *
 * The obvious alternative is the `ws` package, and for most projects that is
 * the right call. Here it would cost something specific: this server has no
 * dependencies at all, which is why it can be dropped onto a box and run under
 * systemd or in a scratch container without a build step or an npm install. For
 * a game that carries small JSON messages between a handful of colleagues, the
 * part of RFC 6455 that actually gets used is the handshake and text frames,
 * and that is a couple of hundred lines rather than a library.
 *
 * What is implemented: the opening handshake, text frames in both directions,
 * fragmentation, close, and ping/pong. What is not: binary frames, extensions,
 * and permessage-deflate. Anything unrecognised closes the connection rather
 * than being guessed at.
 */

import { createHash, randomUUID } from 'node:crypto';

/** The constant every WebSocket handshake hashes the client key against. */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OP_CONTINUATION = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

/**
 * Largest message accepted from a client.
 *
 * A position update is a couple of hundred bytes. Anything approaching this is
 * either a bug or someone seeing how much memory the server will allocate on
 * request, and the connection is closed rather than buffered.
 */
const MAX_MESSAGE_BYTES = 64 * 1024;

/** Silence after which a connection is assumed dead, and the ping interval. */
const PING_INTERVAL_MS = 15000;
const IDLE_TIMEOUT_MS = 45000;

export function acceptKey(key) {
  return createHash('sha1')
    .update(key + GUID)
    .digest('base64');
}

/**
 * Complete the handshake on an HTTP upgrade and return a connection.
 *
 * @returns a connection object, or null if the request was not a valid
 *          WebSocket upgrade — in which case the socket has been closed.
 */
export function upgradeConnection(req, socket) {
  const key = req.headers['sec-websocket-key'];
  const version = req.headers['sec-websocket-version'];
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key || version !== '13') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return null;
  }

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
  );
  // Disable Nagle: these are small messages sent on a clock, and coalescing
  // them adds latency to exactly the thing that needs to feel immediate.
  socket.setNoDelay(true);

  return new Connection(socket);
}

class Connection {
  constructor(socket) {
    this.id = randomUUID();
    this.socket = socket;
    this.open = true;
    /** Set by the application; anything it likes. */
    this.data = {};

    this.onMessage = null;
    this.onClose = null;

    this._buffer = Buffer.alloc(0);
    /** Payload chunks of a fragmented message, and the opcode that began it. */
    this._fragments = [];
    this._fragmentOpcode = 0;
    this._lastSeen = Date.now();

    socket.on('data', (chunk) => this._receive(chunk));
    socket.on('error', () => this.close());
    socket.on('close', () => this._closed());

    this._ping = setInterval(() => {
      if (Date.now() - this._lastSeen > IDLE_TIMEOUT_MS) {
        this.close();
        return;
      }
      this._send(OP_PING, Buffer.alloc(0));
    }, PING_INTERVAL_MS);
    this._ping.unref?.();
  }

  send(text) {
    if (!this.open) return;
    this._send(OP_TEXT, Buffer.from(text, 'utf8'));
  }

  close() {
    if (!this.open) return;
    this._send(OP_CLOSE, Buffer.alloc(0));
    this.socket.end();
    this._closed();
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    clearInterval(this._ping);
    this.onClose?.(this);
  }

  _send(opcode, payload) {
    // Server-to-client frames are never masked, and these messages are far
    // below the point where fragmentation would help, so every frame is a
    // complete one.
    const length = payload.length;
    let header;
    if (length < 126) {
      header = Buffer.from([0x80 | opcode, length]);
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch {
      this._closed();
    }
  }

  _receive(chunk) {
    this._lastSeen = Date.now();
    this._buffer = this._buffer.length === 0 ? chunk : Buffer.concat([this._buffer, chunk]);

    // TCP hands over arbitrary slices, so a frame may arrive in pieces or
    // several may arrive together. Keep taking complete frames off the front
    // until what is left is a partial one.
    for (;;) {
      const frame = this._readFrame();
      if (!frame) return;
      if (!this._handleFrame(frame)) return;
    }
  }

  /** Take one complete frame off the buffer, or return null if it is not all here yet. */
  _readFrame() {
    const buf = this._buffer;
    if (buf.length < 2) return null;

    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let length = buf[1] & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (buf.length < offset + 2) return null;
      length = buf.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buf.length < offset + 8) return null;
      const big = buf.readBigUInt64BE(offset);
      if (big > BigInt(MAX_MESSAGE_BYTES)) {
        this.close();
        return null;
      }
      length = Number(big);
      offset += 8;
    }

    if (length > MAX_MESSAGE_BYTES) {
      this.close();
      return null;
    }

    let mask = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      mask = buf.subarray(offset, offset + 4);
      offset += 4;
    }

    if (buf.length < offset + length) return null;

    const payload = Buffer.from(buf.subarray(offset, offset + length));
    if (mask) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    }
    this._buffer = buf.subarray(offset + length);

    return { fin, opcode, payload, masked };
  }

  /** @returns false when the connection was closed and parsing must stop. */
  _handleFrame({ fin, opcode, payload, masked }) {
    // Every frame from a client must be masked. An unmasked one is either a
    // broken client or something that is not a client at all.
    if (!masked) {
      this.close();
      return false;
    }

    switch (opcode) {
      case OP_PING:
        this._send(OP_PONG, payload);
        return true;
      case OP_PONG:
        return true;
      case OP_CLOSE:
        this.close();
        return false;
      case OP_BINARY:
        // Nothing here speaks binary; treating it as text would hand the
        // application mojibake instead of an error.
        this.close();
        return false;
      case OP_TEXT:
      case OP_CONTINUATION:
        break;
      default:
        this.close();
        return false;
    }

    if (opcode === OP_TEXT) {
      if (this._fragments.length > 0) {
        // A new message starting before the previous one finished.
        this.close();
        return false;
      }
      this._fragmentOpcode = opcode;
    } else if (this._fragments.length === 0) {
      // Continuation with nothing to continue.
      this.close();
      return false;
    }

    this._fragments.push(payload);
    const total = this._fragments.reduce((n, p) => n + p.length, 0);
    if (total > MAX_MESSAGE_BYTES) {
      this.close();
      return false;
    }
    if (!fin) return true;

    const message = Buffer.concat(this._fragments).toString('utf8');
    this._fragments = [];
    this.onMessage?.(message, this);
    return true;
  }
}
