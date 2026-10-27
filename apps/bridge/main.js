import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { ensureSecret, runtimePaths, probeRuntime, readRuntime, acquireStartupLock, publishRuntime } from '../../packages/core/runtime.js';
import { Bridge } from '../../packages/core/bridge.js';
import { upgradeWebSocket } from '../../packages/core/websocket.js';
import { normalizeError } from '../../packages/protocol/index.js';

const paths = runtimePaths();
const existing = await probeRuntime(paths);
if (existing) { console.error(`Bridge already running on port ${existing.port}`); process.exit(0); }
const release = await acquireStartupLock(paths);
if (!release) process.exit(0);
const secret = ensureSecret(paths);
const bridge = new Bridge(paths, secret);
const server = createServer(async (req, res) => {
  const host = req.headers.host;
  if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) { res.writeHead(403).end(); return; }
  if (req.url === '/health' && req.method === 'GET') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ ok:true, instanceId:bridge.instanceId, panelConnected:!!bridge.panel })); return; }
  if (req.url !== '/rpc' || req.method !== 'POST') { res.writeHead(404).end(); return; }
  if (!bridge.authenticated(req.headers.authorization?.replace(/^Bearer /i,''))) { res.writeHead(401).end(); return; }
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 1024 * 1024) { res.writeHead(413).end(); return; } chunks.push(chunk); }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { res.writeHead(400).end(); return; }
  try { const result = await bridge.rpc(input.method, input.params || {}); res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ ok:true, result })); }
  catch (e) { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ ok:false, error:normalizeError(e) })); }
});
// Reuse the last port so a connected panel's saved settings survive a service restart.
let preferredPort = readRuntime(paths)?.port || 0;
server.on('error', e => {
  if (e.code === 'EADDRINUSE' && preferredPort) { preferredPort = 0; server.listen(0, '127.0.0.1'); return; }
  release(); console.error(`Cannot start AE bridge: ${e.message}`); process.exitCode = 1;
});
server.on('upgrade', (req, socket, head) => {
  const host = req.headers.host;
  const origin = req.headers.origin;
  if (req.url !== '/panel' || !host || !/^127\.0\.0\.1:\d+$/.test(host) || (origin && !/^(file:|https?:\/\/127\.0\.0\.1(?::\d+)?$|null$)/.test(origin))) { socket.destroy(); return; }
  try { bridge.attachPanel(upgradeWebSocket(req, socket, head)); } catch { socket.destroy(); }
});
server.listen(preferredPort, '127.0.0.1', () => {
  const address = server.address();
  publishRuntime(paths, { port:address.port, pid:process.pid, instanceId:bridge.instanceId, startedAt:new Date().toISOString() });
  release();
  console.error(`AE bridge listening on 127.0.0.1:${address.port}`);
});
// server.close() waits for open connections, and the panel's WebSocket never ends on its own, so close it
// (1012: service restarting) and exit; otherwise the old process lingers and the panel never reconnects.
function shutdown() {
  server.close();
  bridge.panel?.peer.close(1012);
  setTimeout(() => process.exit(0), 300);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
