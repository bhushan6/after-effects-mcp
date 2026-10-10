import { spawn } from 'node:child_process';
import { BridgeError } from '../protocol/index.js';
export async function resizePng(source, output, longEdge) {
  await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-i', source, '-vf', `scale=${longEdge}:${longEdge}:force_original_aspect_ratio=decrease`, '-frames:v', '1', '-y', output], { stdio:['ignore','ignore','pipe'] });
    let error='';
    child.stderr.on('data', d => { error=(error+d).slice(-2000); });
    child.on('error', e => reject(new BridgeError('UNSUPPORTED_CAPABILITY', `FFmpeg unavailable: ${e.message}`)));
    child.on('close', code => code === 0 ? resolve() : reject(new BridgeError('RENDER_FAILED', `PNG resize failed: ${error.slice(-500)}`)));
  });
}
export async function cropPng(source, output, crop, maxLongEdge) {
  const filter=`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${maxLongEdge}:${maxLongEdge}:force_original_aspect_ratio=decrease`;
  await new Promise((resolve,reject) => {
    const child=spawn('ffmpeg',['-i',source,'-vf',filter,'-frames:v','1','-y',output],{stdio:['ignore','ignore','pipe']});
    let error='';
    child.stderr.on('data',d=>{error=(error+d).slice(-2000);});
    child.on('error',e=>reject(new BridgeError('UNSUPPORTED_CAPABILITY',`FFmpeg unavailable: ${e.message}`)));
    child.on('close',code=>code===0?resolve():reject(new BridgeError('RENDER_FAILED',`Crop failed: ${error.slice(-500)}`)));
  });
}
export async function assembleSheet(entries, output, width, height, frameDuration) {
  if (!entries.length) throw new BridgeError('RENDER_FAILED', 'No frames available for sheet');
  const columns = Math.min(4, entries.length);
  const rows = Math.ceil(entries.length / columns);
  const tileW = Math.max(128, Math.min(480, Math.floor(2048 / columns)));
  const tileH = Math.max(96, Math.min(Math.round(tileW * height / width), Math.floor(2048 / rows) - 36));
  const cellH = tileH + 36;
  const args = [];
  for (const e of entries) args.push('-i', e.path);
  const filters = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const seconds = (e.frame * frameDuration).toFixed(3);
    const label = `#${i + 1}  frame ${e.frame}  ${seconds}s`;
    filters.push(`[${i}:v]scale=${tileW}:${tileH}:force_original_aspect_ratio=decrease,pad=${tileW}:${cellH}:(ow-iw)/2:0:color=0x202020,drawtext=text='${label}':fontcolor=white:fontsize=17:x=10:y=${tileH + 7}[v${i}]`);
  }
  const layout = entries.map((_, i) => `${(i % columns) * tileW}_${Math.floor(i / columns) * cellH}`).join('|');
  filters.push(`${entries.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${entries.length}:layout=${layout}:fill=0x202020[out]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[out]', '-frames:v', '1', '-y', output);
  await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio:['ignore','ignore','pipe'] });
    let error = '';
    child.stderr.on('data', d => { error = (error + d).slice(-3000); });
    child.on('error', e => reject(new BridgeError('UNSUPPORTED_CAPABILITY', `FFmpeg unavailable: ${e.message}`)));
    child.on('close', code => code === 0 ? resolve() : reject(new BridgeError('RENDER_FAILED', `Contact sheet assembly failed: ${error.slice(-600)}`)));
  });
  return { columns, rows, tileWidth:tileW, tileHeight:tileH, width:columns * tileW, height:rows * cellH };
}
