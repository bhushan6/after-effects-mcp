import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
test('MCP stdio uses newline JSON-RPC and lists bridge tools', async () => {
  const child=spawn(process.execPath,[resolve('apps/mcp/main.js')],{ stdio:['pipe','pipe','pipe'] });
  let buffer='', messages=[];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',x=>{ buffer+=x; let at; while((at=buffer.indexOf('\n'))>=0){ messages.push(JSON.parse(buffer.slice(0,at))); buffer=buffer.slice(at+1); } });
  child.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-11-25', capabilities:{}, clientInfo:{ name:'test', version:'1' } } })+'\n');
  child.stdin.write(JSON.stringify({ jsonrpc:'2.0', id:2, method:'tools/list' })+'\n');
  await new Promise((resolve,reject)=>{ const start=Date.now(); const timer=setInterval(()=>{ if(messages.length>=2){clearInterval(timer); resolve();} else if(Date.now()-start>3000){clearInterval(timer); reject(new Error('MCP timeout'));} },10); });
  assert.equal(messages[0].result.serverInfo.name,'after-effects-agent-bridge');
  assert.ok(messages[1].result.tools.some(x=>x.name==='ae_render_frame'));
  child.kill();
});
