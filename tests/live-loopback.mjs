// Manual integration test: requires permission to bind localhost and FFmpeg.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
const root=mkdtempSync(join(tmpdir(),'ae-bridge-live-'));
process.env.AE_BRIDGE_HOME=root;
const { connectRuntime, callBridge }=await import('../packages/core/client.js');
let connection, ws, mcp;
try {
  const source=join(root,'source.png');
  const generated=spawnSync('ffmpeg',['-f','lavfi','-i','color=c=green:s=320x180:d=0.1','-frames:v','1','-y',source],{encoding:'utf8'});
  assert.equal(generated.status,0,generated.stderr.slice(-500));
  connection=await connectRuntime();
  ws=new WebSocket(`ws://127.0.0.1:${connection.runtime.port}/panel`);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.send(JSON.stringify({type:'hello',secret:connection.secret,protocolVersion:1,sessionNonce:'manual-test',adapterVersion:'mock',scope:'edit'}));
  const sessionId=await new Promise(resolve=>{ ws.onmessage=e=>{
    const msg=JSON.parse(e.data);
    if(msg.type==='welcome') resolve(msg.projectSessionId);
    if(msg.type==='command') {
      let value;
      if(msg.method==='inspect') value={project:{signature:'mock'},activeComp:{ref:'comp_7',name:'Mock',width:320,height:180,frameDuration:1/30,layers:[]},selection:[],currentTime:{frame:0,seconds:0},capabilities:{liveFrame:true}};
      if(msg.method==='renderFrame'){copyFileSync(source,msg.params.outputPath);value={supported:true,effectiveFrame:msg.params.frame,effectiveSeconds:msg.params.frame/30,width:320,height:180};}
      ws.send(JSON.stringify({type:'result',id:msg.id,ok:true,value}));
    }
  };});
  const context=await callBridge('ae_context',{},connection);
  mcp=spawn(process.execPath,[resolve('apps/mcp/main.js')],{env:{...process.env,AE_BRIDGE_HOME:root},stdio:['pipe','pipe','pipe']});
  let buffer='', resolveMessage;
  const messages=[];
  mcp.stdout.setEncoding('utf8');
  mcp.stdout.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){messages.push(JSON.parse(buffer.slice(0,at)));buffer=buffer.slice(at+1);if(resolveMessage){resolveMessage();resolveMessage=null;}}});
  async function receive(){if(messages.length)return messages.shift();await new Promise((resolve,reject)=>{resolveMessage=resolve;setTimeout(()=>reject(new Error('MCP response timeout')),3000);});return messages.shift();}
  function send(msg){mcp.stdin.write(JSON.stringify(msg)+'\n');}
  send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}});
  await receive();
  send({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'ae_render_frame',arguments:{projectSessionId:sessionId,compRef:'comp_7',frame:5,expectedInspectionToken:context.inspectionToken}}});
  const result=await receive();
  assert.equal(result.id,2);
  const image=result.result.content.find(x=>x.type==='image');
  assert.equal(image.mimeType,'image/png');
  assert.ok(Buffer.from(image.data,'base64').length>100);
  console.log('Live loopback and MCP image delivery: PASS');
} finally {
  mcp?.kill(); ws?.close(); if(connection)process.kill(connection.runtime.pid,'SIGTERM');
  await new Promise(r=>setTimeout(r,100));
  rmSync(root,{recursive:true,force:true});
}
