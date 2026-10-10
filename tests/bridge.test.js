import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Bridge } from '../packages/core/bridge.js';
class FakePeer extends EventEmitter {
  constructor(handler) { super(); this.handler=handler; this.messages=[]; }
  send(msg) { this.messages.push(msg); if (msg.type === 'command') queueMicrotask(() => this.handler(msg,this)); }
  close() { this.emit('close'); }
}
function fixture(t, handler, scope='edit') {
  const root=mkdtempSync(join(tmpdir(),'ae-bridge-test-'));
  t.after(() => rmSync(root,{ recursive:true, force:true }));
  const paths={ root, artifacts:join(root,'artifacts') }; mkdirSync(paths.artifacts);
  const bridge=new Bridge(paths,'secret'); const peer=new FakePeer(handler);
  bridge.attachPanel(peer); peer.emit('message',{ type:'hello', secret:'secret', protocolVersion:1, sessionNonce:'n', adapterVersion:'mock', scope });
  const sessionId=peer.messages[0].projectSessionId;
  return { bridge, peer, sessionId, root };
}
const inspect=()=>({ project:{ signature:'project-a' }, activeComp:{ ref:'comp_7', name:'Main', width:1920, height:1080, frameDuration:1/30, layers:[] }, selection:[], currentTime:{ frame:0, seconds:0 }, capabilities:{ liveFrame:false } });
test('applies once and journals duplicate request without redispatch', async t => {
  let calls=0;
  const { bridge, sessionId }=fixture(t,(msg,peer) => {
    const value=msg.method === 'inspect' ? inspect() : (calls++, { state:'succeeded', outcomes:[{ id:'text', state:'succeeded', ref:'layer_8' }] });
    peer.emit('message',{ type:'result', id:msg.id, ok:true, value });
  });
  const ctx=await bridge.rpc('ae_context');
  const batch={ requestId:'request-1', projectSessionId:sessionId, expectedInspectionToken:ctx.inspectionToken, label:'Add title', operations:[{ id:'text', op:'layer.create_text', compRef:'comp_7', text:'Hello' }] };
  const first=await bridge.rpc('ae_apply',{ batch });
  assert.equal(first.state,'succeeded'); assert.equal(calls,1);
  const second=await bridge.rpc('ae_apply',{ batch });
  assert.equal(second.state,'succeeded'); assert.equal(calls,1);
  await assert.rejects(bridge.rpc('ae_apply',{ batch:{...batch, label:'Different edit'} }),e=>e.code==='REQUEST_ID_CONFLICT');
});
test('rejects stale state before mutation', async t => {
  let calls=0, revision=0;
  const { bridge, sessionId }=fixture(t,(msg,peer) => {
    if (msg.method === 'executeBatch') calls++;
    const state=inspect(); state.activeComp.name='Revision '+revision;
    peer.emit('message',{ type:'result', id:msg.id, ok:true, value:msg.method === 'inspect' ? state : { state:'succeeded' } });
  });
  const ctx=await bridge.rpc('ae_context'); revision++;
  const batch={ requestId:'request-2', projectSessionId:sessionId, expectedInspectionToken:ctx.inspectionToken, label:'Add title', operations:[{ id:'text', op:'layer.create_text', compRef:'comp_7', text:'Hello' }] };
  const job=await bridge.rpc('ae_apply',{ batch });
  assert.equal(job.state,'failed'); assert.equal(job.error.code,'STATE_CONFLICT'); assert.equal(calls,0);
});
test('read-only panel rejects edits', async t => {
  const { bridge, sessionId }=fixture(t,(msg,peer)=>peer.emit('message',{type:'result',id:msg.id,ok:true,value:inspect()}),'read');
  const ctx=await bridge.rpc('ae_context');
  const batch={ requestId:'read-only', projectSessionId:sessionId, expectedInspectionToken:ctx.inspectionToken, label:'Add title', operations:[{ id:'text', op:'layer.create_text', compRef:'comp_7', text:'Hello' }] };
  await assert.rejects(bridge.rpc('ae_apply',{batch}),e=>e.code==='READ_ONLY');
});
test('panel disconnect during mutation marks outcome unknown', async t => {
  const { bridge, peer, sessionId }=fixture(t,(msg,p) => {
    if (msg.method === 'inspect') p.emit('message',{ type:'result', id:msg.id, ok:true, value:inspect() });
    else p.close();
  });
  const ctx=await bridge.rpc('ae_context');
  const batch={ requestId:'request-3', projectSessionId:sessionId, expectedInspectionToken:ctx.inspectionToken, label:'Add title', operations:[{ id:'text', op:'layer.create_text', compRef:'comp_7', text:'Hello' }] };
  const job=await bridge.rpc('ae_apply',{ batch });
  assert.equal(job.state,'outcome_unknown');
});
test('contact sheet returns mapped native frame artifacts', { skip:spawnSync('ffmpeg',['-version']).status !== 0 }, async t => {
  let source;
  const { bridge, sessionId, root }=fixture(t,(msg,peer) => {
    if (msg.method === 'inspect') peer.emit('message',{ type:'result', id:msg.id, ok:true, value:inspect() });
    if (msg.method === 'renderFrame') {
      copyFileSync(source,msg.params.outputPath);
      peer.emit('message',{ type:'result', id:msg.id, ok:true, value:{ supported:true, effectiveFrame:msg.params.frame, effectiveSeconds:msg.params.frame/30, width:320, height:180 } });
    }
  });
  source=join(root,'source.png');
  const generated=spawnSync('ffmpeg',['-f','lavfi','-i','color=c=blue:s=320x180:d=0.1','-frames:v','1','-y',source],{ encoding:'utf8' });
  assert.equal(generated.status,0,generated.stderr.slice(-500));
  const ctx=await bridge.rpc('ae_context');
  const result=await bridge.rpc('ae_render_contact_sheet',{ projectSessionId:sessionId, compRef:'comp_7', startFrame:0, endFrameExclusive:31, count:3, expectedInspectionToken:ctx.inspectionToken });
  assert.equal(result.completeness,'complete');
  assert.deepEqual(result.tiles.map(x=>x.frame),[0,15,30]);
  assert.ok(existsSync(result.path));
  const detail=await bridge.rpc('ae_artifact',{ id:result.tiles[1].artifactId, crop:{x:40,y:30,width:100,height:80}, maxLongEdge:400 });
  assert.ok(existsSync(detail.path));
  assert.deepEqual(detail.metadata.crop,{x:40,y:30,width:100,height:80});
});
