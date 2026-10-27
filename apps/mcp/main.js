#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { callBridge, connectRuntime } from '../../packages/core/client.js';
import { normalizeError } from '../../packages/protocol/index.js';
const PROTOCOL = '2025-11-25';
const object = (properties, required = []) => ({ type:'object', properties, required, additionalProperties:false });
const s = { type:'string' }, n = { type:'integer' }, b = { type:'boolean' };
const tools = [
  { name:'ae_context', description:'Read current AE session, active comp, selection and capabilities', inputSchema:object({}) },
  { name:'ae_inspect', description:'Inspect current project and active composition', inputSchema:object({ fields:s }) },
  { name:'ae_catalog', description:'Discover supported typed operations', inputSchema:object({}) },
  { name:'ae_apply', description:'Apply a bounded typed batch to the inspected project', inputSchema:object({ batch:{ type:'object' }, preflightOnly:b }, ['batch']) },
  { name:'ae_render_frame', description:'Render one real native AE frame and return PNG pixels', inputSchema:object({ projectSessionId:s, compRef:s, frame:n, maxLongEdge:n, expectedInspectionToken:s }, ['projectSessionId','compRef','frame']) },
  { name:'ae_render_contact_sheet', description:'Render a labelled native AE frame contact sheet', inputSchema:object({ projectSessionId:s, compRef:s, startFrame:n, endFrameExclusive:n, count:n, policy:{ type:'string', enum:['uniform','explicit'] }, frames:{ type:'array', items:n }, expectedInspectionToken:s }, ['projectSessionId','compRef','startFrame','endFrameExclusive']) },
  { name:'ae_render_video', description:'Render a frame range of a comp to an H.264 MP4 through the native frame path and FFmpeg. Returns a jobId at once; poll ae_job until it succeeds (result.path) or fails. Other bridge calls wait while it renders', inputSchema:object({ projectSessionId:s, compRef:s, startFrame:n, endFrameExclusive:n, outputPath:s, maxLongEdge:n }, ['projectSessionId','compRef','startFrame','endFrameExclusive']) },
  { name:'ae_job', description:'Read a journalled bridge job', inputSchema:object({ id:s }, ['id']) },
  { name:'ae_artifact', description:'Retrieve a prior image or a detail crop from an original frame', inputSchema:object({ id:s, crop:object({ x:n, y:n, width:n, height:n }, ['x','y','width','height']), maxLongEdge:n }, ['id']) }
];
const imageMethods = new Set(['ae_render_frame','ae_render_contact_sheet','ae_artifact']);
let input = '';
let connection;
function send(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
async function dispatch(msg) {
  if (!msg || !('id' in msg)) return;
  const id = msg.id;
  try {
    if (msg.method === 'initialize') return send({ jsonrpc:'2.0', id, result:{ protocolVersion:PROTOCOL, capabilities:{ tools:{} }, serverInfo:{ name:'after-effects-agent-bridge', version:'0.1.0' } } });
    if (msg.method === 'ping') return send({ jsonrpc:'2.0', id, result:{} });
    if (msg.method === 'tools/list') return send({ jsonrpc:'2.0', id, result:{ tools } });
    if (msg.method === 'tools/call') {
      const name = msg.params?.name;
      if (!tools.some(t => t.name === name)) throw new Error(`Unknown tool ${name}`);
      connection ||= await connectRuntime();
      const result = await callBridge(name, msg.params.arguments || {}, connection);
      const content = [{ type:'text', text:JSON.stringify(result) }];
      if (imageMethods.has(name)) {
        const artifact = name === 'ae_artifact' ? result : await callBridge('ae_artifact', { id:result.artifactId }, connection);
        if (artifact.kind === 'frame' || artifact.kind === 'contact_sheet') content.push({ type:'image', data:readFileSync(artifact.path).toString('base64'), mimeType:'image/png' });
      }
      return send({ jsonrpc:'2.0', id, result:{ content, structuredContent:result } });
    }
    send({ jsonrpc:'2.0', id, error:{ code:-32601, message:`Method not found: ${msg.method}` } });
  } catch (e) { send({ jsonrpc:'2.0', id, result:{ content:[{ type:'text', text:JSON.stringify(normalizeError(e)) }], isError:true } }); }
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  if (input.length > 1024 * 1024) { process.stdin.pause(); process.exitCode = 1; return; }
  let end;
  while ((end = input.indexOf('\n')) >= 0) {
    const line = input.slice(0,end); input = input.slice(end + 1);
    try { dispatch(JSON.parse(line)); } catch {}
  }
});
