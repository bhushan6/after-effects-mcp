import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WebSocketPeer } from '../packages/core/websocket.js';
// Client frames are masked; build them the way a browser does.
function frame(opcode, text, fin = true) {
  const body = Buffer.from(text), mask = Buffer.from([1, 2, 3, 4]);
  const len = body.length < 126 ? Buffer.from([0x80 | body.length]) : Buffer.from([0x80 | 126, body.length >> 8, body.length & 255]);
  const masked = Buffer.from(body.map((b, i) => b ^ mask[i % 4]));
  return Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | opcode]), len, mask, masked]);
}
function peer() {
  const socket = Object.assign(new EventEmitter(), { written:[], write(b) { this.written.push(b); }, destroy() { this.destroyed = true; } });
  const p = new WebSocketPeer(socket), messages = [];
  p.on('message', m => messages.push(m));
  return { p, socket, messages };
}
test('reassembles a message split into continuation frames, even across reads', () => {
  const { socket, messages } = peer();
  const json = JSON.stringify({ type:'result', value:'x'.repeat(300) });
  const parts = [json.slice(0, 100), json.slice(100, 250), json.slice(250)];
  const bytes = Buffer.concat([frame(1, parts[0], false), frame(0, parts[1], false), frame(9, ''), frame(0, parts[2], true)]);
  socket.emit('data', bytes.subarray(0, 77)); socket.emit('data', bytes.subarray(77));
  assert.deepEqual(messages, [JSON.parse(json)]);
  assert.ok(!socket.destroyed);
  assert.equal(socket.written.length, 1, 'ping between fragments still gets a pong');
});
test('rejects a continuation frame with no message started, and ignores pongs', () => {
  const ok = peer();
  ok.socket.emit('data', Buffer.concat([frame(10, ''), frame(1, '{"a":1}')]));
  assert.deepEqual(ok.messages, [{ a:1 }]);
  const bad = peer();
  bad.socket.emit('data', frame(0, '{}'));
  assert.ok(bad.socket.destroyed);
});
