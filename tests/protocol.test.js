import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBatch, BridgeError } from '../packages/protocol/index.js';
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
test('uniform sampling includes endpoints and yields distinct frames', () => {
  assert.deepEqual(sampleFrames({ startFrame:10, endFrameExclusive:18, count:8 }), [10,11,12,13,14,15,16,17]);
  assert.deepEqual(sampleFrames({ startFrame:10, endFrameExclusive:14, count:8 }), [10,11,12,13]);
  assert.deepEqual(sampleFrames({ startFrame:0, endFrameExclusive:101, count:3 }), [0,50,100]);
  assert.throws(() => sampleFrames({ startFrame:0, endFrameExclusive:10, count:3, policy:'explicit', frames:[1,1] }), e => e.code === 'INVALID_ARGUMENT');
});
