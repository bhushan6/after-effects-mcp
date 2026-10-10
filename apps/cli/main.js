#!/usr/bin/env node
import { connectRuntime, callBridge } from '../../packages/core/client.js';
import { existsSync, readFileSync, readdirSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
const [command, ...args] = process.argv.slice(2);
const panelSource = resolve(dirname(fileURLToPath(import.meta.url)), '../ae-panel');
const panelTarget = join(homedir(),'Library','Application Support','Adobe','CEP','extensions','com.aftereffects.agentbridge.panel');
try {
  if (command === 'doctor') {
    const c = await connectRuntime();
    const context = await callBridge('ae_context', {}, c);
    const aeInstallations = existsSync('/Applications') ? readdirSync('/Applications').filter(x => /After Effects/i.test(x)) : [];
    const ffmpeg = spawnSync('ffmpeg',['-version'],{ stdio:'ignore' }).status === 0;
    console.log(JSON.stringify({ service:'running', port:c.runtime.port, panelInstalled:existsSync(panelTarget), panelConnected:context.connected, aeInstallations, ffmpeg, context }, null, 2));
  } else if (command === 'install-panel') {
    if (process.platform !== 'darwin') throw new Error('Panel installer currently supports macOS only');
    if (existsSync(panelTarget)) throw new Error(`Panel already exists at ${panelTarget}; remove it explicitly before reinstalling`);
    mkdirSync(dirname(panelTarget),{ recursive:true });
    cpSync(panelSource,panelTarget,{ recursive:true, mode:0o700 });
    console.log(`Installed CEP panel at ${panelTarget}`);
    console.log('Unsigned development panels require CEP developer mode or signing; this installer does not change global Adobe settings.');
  } else if (command === 'uninstall-panel') {
    if (!existsSync(join(panelTarget,'CSXS','manifest.xml'))) throw new Error('Owned panel installation not found');
    const manifest=readFileSync(join(panelTarget,'CSXS','manifest.xml'),'utf8');
    if (!manifest.includes('com.aftereffects.agentbridge.panel')) throw new Error('Refusing to remove a panel with a different extension ID');
    rmSync(panelTarget,{ recursive:true });
    console.log(`Removed panel at ${panelTarget}`);
  } else if (command === 'panel-config') {
    const c = await connectRuntime();
    console.log(JSON.stringify({ port:c.runtime.port, secret:c.secret }, null, 2));
  } else if (command === 'context') {
    console.log(JSON.stringify(await callBridge('ae_context'), null, 2));
  } else if (command === 'inspect') {
    console.log(JSON.stringify(await callBridge('ae_inspect'), null, 2));
  } else if (command === 'catalog') {
    console.log(JSON.stringify(await callBridge('ae_catalog'), null, 2));
  } else if (command === 'apply') {
    if (!args[0]) throw new Error('Usage: npm run cli -- apply batch.json');
    console.log(JSON.stringify(await callBridge('ae_apply', { batch:JSON.parse(readFileSync(args[0],'utf8')) }), null, 2));
  } else if (command === 'frame') {
    const [projectSessionId, compRef, frame] = args;
    console.log(JSON.stringify(await callBridge('ae_render_frame', { projectSessionId, compRef, frame:Number(frame) }), null, 2));
  } else {
    console.log('Commands: doctor, install-panel, uninstall-panel, panel-config, context, inspect, catalog, apply FILE, frame SESSION COMP FRAME');
  }
} catch (e) { console.error(`${e.code || 'ERROR'}: ${e.message}`); process.exitCode = 1; }
