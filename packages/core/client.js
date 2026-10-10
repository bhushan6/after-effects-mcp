import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimePaths, ensureSecret, probeRuntime } from './runtime.js';
import { BridgeError } from '../protocol/index.js';
const sleep = ms => new Promise(r => setTimeout(r,ms));
export async function connectRuntime({ start = true } = {}) {
  const paths = runtimePaths();
  const secret = ensureSecret(paths);
  let runtime = await probeRuntime(paths);
  if (!runtime && start) {
    const main = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/bridge/main.js');
    const child = spawn(process.execPath, [main], { cwd:process.cwd(), env:{ ...process.env, AE_BRIDGE_HOME:paths.root }, stdio:'ignore', detached:true });
    child.unref();
    for (let i=0; i<50 && !runtime; i++) { await sleep(100); runtime = await probeRuntime(paths); }
  }
  if (!runtime) throw new BridgeError('SERVICE_UNAVAILABLE','Bridge service did not start');
  return { paths, secret, runtime };
}
export async function callBridge(method, params = {}, connection) {
  const c = connection || await connectRuntime();
  const response = await fetch(`http://127.0.0.1:${c.runtime.port}/rpc`, { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${c.secret}` }, body:JSON.stringify({ method, params }), signal:AbortSignal.timeout(120000) });
  if (!response.ok) throw new BridgeError('SERVICE_ERROR', `Bridge HTTP ${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new BridgeError(data.error.code, data.error.message, data.error);
  return data.result;
}
