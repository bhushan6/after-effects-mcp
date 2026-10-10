import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
const sleep = ms => new Promise(r => setTimeout(r, ms));
export function runtimeRoot() { return resolve(process.env.AE_BRIDGE_HOME || join(homedir(), '.after-effects-agent-bridge')); }
export function runtimePaths() { const root = runtimeRoot(); return { root, secret:join(root,'secret'), rendezvous:join(root,'runtime.json'), lock:join(root,'startup.lock'), artifacts:join(root,'artifacts') }; }
export function ensureSecret(paths) {
  mkdirSync(paths.root, { recursive:true, mode:0o700 });
  if (!existsSync(paths.secret)) writeFileSync(paths.secret, randomBytes(32).toString('hex'), { mode:0o600, flag:'wx' });
  return readFileSync(paths.secret, 'utf8').trim();
}
export function readRuntime(paths) { try { return JSON.parse(readFileSync(paths.rendezvous, 'utf8')); } catch { return null; } }
export async function probeRuntime(paths) {
  const runtime = readRuntime(paths);
  if (!runtime?.port || !runtime?.pid) return null;
  try { process.kill(runtime.pid, 0); } catch { return null; }
  try {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/health`, { signal:AbortSignal.timeout(800) });
    const data = await response.json();
    return data.instanceId === runtime.instanceId ? runtime : null;
  } catch { return null; }
}
export async function acquireStartupLock(paths) {
  for (let i = 0; i < 50; i++) {
    try { const fd = openSync(paths.lock, 'wx', 0o600); writeFileSync(fd,String(process.pid)); let released=false; return () => { if(released)return; released=true; closeSync(fd); try { unlinkSync(paths.lock); } catch {} }; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const live = await probeRuntime(paths); if (live) return null;
      let ownerLive=false;
      try { const pid=Number(readFileSync(paths.lock,'utf8')); if (Number.isSafeInteger(pid) && pid>0) { process.kill(pid,0); ownerLive=true; } } catch {}
      if (!ownerLive) { try { unlinkSync(paths.lock); } catch {} }
      await sleep(100);
    }
  }
  throw new Error('Could not acquire bridge startup lock');
}
export function publishRuntime(paths, runtime) {
  const tmp = join(paths.root, `runtime-${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(runtime), { mode:0o600 });
  renameSync(tmp, paths.rendezvous);
}
