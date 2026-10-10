import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { BridgeError } from '../protocol/index.js';
const MAX_MESSAGE = 1024 * 1024;
export class WebSocketPeer extends EventEmitter {
  constructor(socket) {
    super(); this.socket = socket; this.buffer = Buffer.alloc(0); this.closed = false;
    socket.on('data', data => this.feed(data));
    socket.on('close', () => { this.closed = true; this.emit('close'); });
    socket.on('error', e => this.emit('error', e));
  }
  feed(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0], b1 = this.buffer[1];
      let len = b1 & 127, header = 2;
      if ((b0 & 0x70) || !(b1 & 128) || !(b0 & 0x80)) return this.close(1002);
      if (len === 126) { if (this.buffer.length < 4) return; len = this.buffer.readUInt16BE(2); header = 4; }
      if (len === 127) { if (this.buffer.length < 10) return; const high = this.buffer.readUInt32BE(2); if (high) return this.close(1009); len = this.buffer.readUInt32BE(6); header = 10; }
      if (len > MAX_MESSAGE) return this.close(1009);
      if (this.buffer.length < header + 4 + len) return;
      const mask = this.buffer.subarray(header, header + 4);
      const payload = Buffer.from(this.buffer.subarray(header + 4, header + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i % 4];
      this.buffer = this.buffer.subarray(header + 4 + len);
      const opcode = b0 & 15;
      if (opcode === 8) return this.close(1000);
      if (opcode === 9) { this.sendFrame(10, payload); continue; }
      if (opcode !== 1) return this.close(1003);
      try { this.emit('message', JSON.parse(payload.toString('utf8'))); }
      catch { this.close(1007); return; }
    }
  }
  sendFrame(opcode, payload) {
    if (this.closed) return;
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const header = body.length < 126 ? Buffer.from([0x80 | opcode, body.length]) : body.length < 65536 ? Buffer.from([0x80 | opcode, 126, body.length >> 8, body.length & 255]) : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | opcode; h[1] = 127; h.writeUInt32BE(body.length, 6); return h; })();
    this.socket.write(Buffer.concat([header, body]));
  }
  send(value) { this.sendFrame(1, JSON.stringify(value)); }
  close(code = 1000) { if (this.closed) return; this.sendFrame(8, Buffer.from([code >> 8, code & 255])); this.closed = true; this.socket.destroy(); }
}
export function upgradeWebSocket(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (req.headers.upgrade?.toLowerCase() !== 'websocket' || typeof key !== 'string' || Buffer.from(key, 'base64').length !== 16)
    throw new BridgeError('INVALID_ARGUMENT', 'Invalid WebSocket upgrade');
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const peer = new WebSocketPeer(socket);
  if (head?.length) peer.feed(head);
  return peer;
}
