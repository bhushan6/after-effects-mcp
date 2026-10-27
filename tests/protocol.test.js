import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBatch, validateVideo, BridgeError } from '../packages/protocol/index.js';
import { sampleFrames } from '../packages/previews/sampling.js';
const batch = { requestId:'r1', projectSessionId:'s1', expectedInspectionToken:'inspection_x', label:'Create card', operations:[
  { id:'shape', op:'layer.create_shape', compRef:'comp_7', name:'Card', sizePx:[280,360], radiusPx:24, fillRgb:[1,1,1] },
  { id:'place', op:'property.set', target:{ createdBy:'shape' }, path:['ADBE Transform Group','ADBE Position'], value:[320,540], coordinateSpace:'parent' }
] };
test('validates provisional references and bounded typed batch', () => {
  assert.equal(validateBatch(batch), batch);
  assert.throws(() => validateBatch({ ...batch, operations:[batch.operations[1]] }), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch({ ...batch, operations:[{ ...batch.operations[0], op:'script.run' }] }), e => e.code === 'UNSUPPORTED_CAPABILITY');
  assert.throws(() => validateBatch({ ...batch, operations:[{ ...batch.operations[0], fillRgb:[2,0,0] }] }), e => e.code === 'INVALID_ARGUMENT');
});
test('validates text.set_style fields', () => {
  const style = fields => ({ ...batch, operations:[{ id:'style', op:'text.set_style', target:'layer_1', ...fields }] });
  assert.ok(validateBatch(style({ fillRgb:[1,1,1], fontSize:96, justification:'center', anchor:'center' })));
  assert.ok(validateBatch(style({ fontSize:12 })));
  assert.throws(() => validateBatch(style({})), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(style({ fontSize:0 })), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(style({ justification:'middle' })), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(style({ anchor:'top' })), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(style({ fillRgb:[1,1] })), e => e.code === 'INVALID_ARGUMENT');
});
test('validates keyframe.ease fields', () => {
  const ease = fields => ({ ...batch, operations:[{ id:'ease', op:'keyframe.ease', target:'layer_1', path:['ADBE Transform Group','ADBE Scale'], ease:'ease_in_out', ...fields }] });
  assert.ok(validateBatch(ease({})));
  assert.ok(validateBatch(ease({ ease:'ease_out', frames:[0, 15], influence:75 })));
  assert.throws(() => validateBatch(ease({ ease:'bounce' })), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(ease({ frames:[3, 3] })), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(ease({ frames:[-1] })), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(ease({ influence:0 })), e => e.code === 'INVALID_ARGUMENT');
  assert.ok(validateBatch(ease({ path:['ADBE Transform Group','ADBE Anchor Point'] })));
  assert.throws(() => validateBatch(ease({ path:['ADBE Transform Group','ADBE Rotate X'] })), e => e.code === 'INVALID_PROPERTY');
});
test('validates comp.create, layer.set_timing and extended text style', () => {
  const one = op => ({ ...batch, operations:[{ id:'x', ...op }] });
  const comp = { op:'comp.create', name:'Recreation', width:1920, height:1080, fps:24, durationFrames:216 };
  assert.ok(validateBatch(one(comp)));
  assert.throws(() => validateBatch({ ...batch, operations:[{ id:'x', ...comp }, batch.operations[0]] }), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(one({ ...comp, fps:0 })), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(one({ ...comp, durationFrames:2.5 })), e => e.code === 'INVALID_ARGUMENT');
  assert.ok(validateBatch(one({ op:'layer.set_timing', target:'layer_1', inFrame:28, outFrame:39 })));
  assert.throws(() => validateBatch(one({ op:'layer.set_timing', target:'layer_1', inFrame:39, outFrame:39 })), e => e.code === 'INVALID_ARGUMENT');
  assert.ok(validateBatch(one({ op:'text.set_style', target:'layer_1', font:'HelveticaNeue', leading:140, tracking:-10 })));
  assert.throws(() => validateBatch(one({ op:'text.set_style', target:'layer_1', font:'Helvetica Neue; $.evalFile' })), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(one({ op:'text.set_style', target:'layer_1', leading:0 })), e => e.code === 'INVALID_ARGUMENT');
  assert.ok(validateBatch(one({ op:'text.set_text', target:'layer_1', text:'row one\rrow two' })));
  assert.throws(() => validateBatch(one({ op:'text.set_text', target:'layer_1', text:'' })), e => e.code === 'INVALID_ARGUMENT');
});
test('validates shapes, images, paths and trim keyframes', () => {
  const one = op => ({ ...batch, operations:[{ id:'x', compRef:'comp_7', ...op }] });
  assert.ok(validateBatch(one({ op:'layer.create_shape', shape:'ellipse', sizePx:[40,40], strokeRgb:[0,0,1], strokeWidthPx:3 })));
  assert.ok(validateBatch(one({ op:'layer.create_shape', sizePx:[40,40], radiusPx:4, fillRgb:[1,1,1] })));
  assert.throws(() => validateBatch(one({ op:'layer.create_shape', shape:'ellipse', sizePx:[40,40] })), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(one({ op:'layer.create_shape', shape:'star', sizePx:[40,40], fillRgb:[1,1,1] })), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(one({ op:'layer.create_shape', sizePx:[40,40], fillRgb:[1,1,1] })), e => e.code === 'INVALID_ARGUMENT');
  assert.ok(validateBatch(one({ op:'layer.create_image', path:'/Users/me/ui.png' })));
  for (const path of ['ui.png', '/Users/me/ui.mov', '/a\nb.png']) assert.throws(() => validateBatch(one({ op:'layer.create_image', path })), e => e.code === 'INVALID_ARGUMENT');
  const line = { vertices:[[0,0],[10,0]], closed:false };
  assert.ok(validateBatch(one({ op:'layer.create_path', paths:[line, { vertices:[[0,0],[5,5],[0,10]], inTangents:[[0,0],[0,-2],[0,0]], closed:true }], strokeRgb:[1,0.9,0], strokeWidthPx:6, lineCap:'round', trim:'individual' })));
  assert.throws(() => validateBatch(one({ op:'layer.create_path', paths:[line] })), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(one({ op:'layer.create_path', paths:[{ vertices:[[0,0]], closed:false }], fillRgb:[0,0,0] })), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(one({ op:'layer.create_path', paths:[{ ...line, outTangents:[[0,0]] }], fillRgb:[0,0,0] })), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(one({ op:'layer.create_path', paths:[{ vertices:line.vertices }], fillRgb:[0,0,0] })), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(one({ op:'layer.create_path', paths:[line], fillRgb:[0,0,0], trim:'yes' })), e => e.code === 'INVALID_ARGUMENT');
  const trimEnd = ['ADBE Root Vectors Group','ADBE Vector Filter - Trim','ADBE Vector Trim End'];
  assert.ok(validateBatch(one({ op:'keyframe.set', target:'layer_1', path:trimEnd, frame:3, value:100 })));
  assert.throws(() => validateBatch(one({ op:'keyframe.set', target:'layer_1', path:trimEnd, frame:3, value:120 })), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(one({ op:'keyframe.set', target:'layer_1', path:['ADBE Root Vectors Group','ADBE Vector Filter - Trim','ADBE Vector Trim Offset'], frame:3, value:1 })), e => e.code === 'INVALID_PROPERTY');
});
test('validates parenting, mattes, switches and typewriter', () => {
  const two = op => ({ ...batch, operations:[batch.operations[0], { id:'x', ...op }] });
  assert.ok(validateBatch(two({ op:'layer.set_parent', target:'layer_2', parent:{ createdBy:'shape' } })));
  assert.ok(validateBatch(two({ op:'layer.set_parent', target:'layer_2', parent:null })));
  assert.throws(() => validateBatch(two({ op:'layer.set_parent', target:'layer_2', parent:{ createdBy:'later' } })), e => e.code === 'INVALID_ARGUMENT');
  assert.ok(validateBatch(two({ op:'layer.set_track_matte', target:'layer_2', matte:{ createdBy:'shape' }, type:'alpha' })));
  assert.throws(() => validateBatch(two({ op:'layer.set_track_matte', target:'layer_2', matte:'layer_3', type:'stencil' })), e => e.code === 'INVALID_ARGUMENT');
  assert.ok(validateBatch(two({ op:'layer.set_switches', target:'layer_2', motionBlur:true })));
  assert.throws(() => validateBatch(two({ op:'layer.set_switches', target:'layer_2', motionBlur:'on' })), e => e.code === 'INVALID_ARGUMENT');
  assert.ok(validateBatch(two({ op:'text.typewriter', target:'layer_2', startFrame:10, endFrame:70, caret:{ sizePx:[3,40], colorRgb:[0,0,0], gapPx:4 } })));
  assert.throws(() => validateBatch(two({ op:'text.typewriter', target:'layer_2', startFrame:10, endFrame:10 })), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(two({ op:'text.typewriter', target:'layer_2', startFrame:0, endFrame:10, caret:{ sizePx:[3,40] } })), e => e.code === 'INVALID_ARGUMENT');
});
test('validates layer.replace_image and video render ranges', () => {
  const two = op => ({ ...batch, operations:[batch.operations[0], { id:'x', ...op }] });
  assert.ok(validateBatch(two({ op:'layer.replace_image', target:'layer_2', path:'/Users/me/ui-v2.png' })));
  assert.ok(validateBatch(two({ op:'layer.replace_image', target:{ createdBy:'shape' }, path:'/Users/me/ui.jpeg' })));
  for (const path of ['ui.png', '/Users/me/ui.mov', '/a\nb.png', undefined]) assert.throws(() => validateBatch(two({ op:'layer.replace_image', target:'layer_2', path })), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch(two({ op:'layer.replace_image', target:{ createdBy:'later' }, path:'/a.png' })), e => e.code === 'INVALID_ARGUMENT');
  const video = { projectSessionId:'s1', compRef:'comp_7', startFrame:0, endFrameExclusive:480 };
  assert.ok(validateVideo(video));
  assert.ok(validateVideo({ ...video, outputPath:'/Users/me/promo.mp4', maxLongEdge:1280 }));
  for (const bad of [{ endFrameExclusive:0 }, { startFrame:-1 }, { endFrameExclusive:8000 }, { outputPath:'promo.mp4' }, { outputPath:'/a/promo.mov' }, { maxLongEdge:32 }])
    assert.throws(() => validateVideo({ ...video, ...bad }), e => e.code === 'INVALID_ARGUMENT');
});
test('validates project.save', () => {
  const one = op => ({ ...batch, operations:[{ id:'x', op:'project.save', ...op }] });
  assert.ok(validateBatch(one({})));
  assert.ok(validateBatch(one({ path:'/Users/me/Promo.aep' })));
  for (const path of ['Promo.aep', '/Users/me/Promo.prproj', '/a\nb.aep']) assert.throws(() => validateBatch(one({ path })), e => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => validateBatch({ ...batch, operations:[{ id:'x', op:'project.save' }, batch.operations[0]] }), e => e.code === 'INVALID_ARGUMENT');
});
test('uniform sampling includes endpoints and yields distinct frames', () => {
  assert.deepEqual(sampleFrames({ startFrame:10, endFrameExclusive:18, count:8 }), [10,11,12,13,14,15,16,17]);
  assert.deepEqual(sampleFrames({ startFrame:10, endFrameExclusive:14, count:8 }), [10,11,12,13]);
  assert.deepEqual(sampleFrames({ startFrame:0, endFrameExclusive:101, count:3 }), [0,50,100]);
  assert.throws(() => sampleFrames({ startFrame:0, endFrameExclusive:10, count:3, policy:'explicit', frames:[1,1] }), e => e.code === 'INVALID_ARGUMENT');
});
