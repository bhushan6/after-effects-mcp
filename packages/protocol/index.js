export const PROTOCOL_VERSION = 1;
export const MAX_OPERATIONS = 24;
export const MAX_FRAMES = 12;

export class BridgeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.details = details;
  }
  toJSON() { return { code: this.code, message: this.message, ...this.details }; }
}

const finite = x => typeof x === 'number' && Number.isFinite(x);
const str = (x, name, max = 256) => {
  if (typeof x !== 'string' || !x.length || x.length > max) throw new BridgeError('INVALID_ARGUMENT', `${name} must be a nonempty string (max ${max})`);
  return x;
};
const vec = (x, n, name) => {
  if (!Array.isArray(x) || x.length !== n || !x.every(finite)) throw new BridgeError('INVALID_ARGUMENT', `${name} must contain ${n} finite numbers`);
  return x;
};
export const catalog = Object.freeze({
  'layer.create_text': { description: 'Create an editable text layer', args: { compRef: 'comp reference', text: 'string', name: 'optional string' } },
  'layer.create_shape': { description: 'Create an editable rounded rectangle', args: { compRef: 'comp reference', name: 'optional string', sizePx: '[width,height]', radiusPx: 'number', fillRgb: '[r,g,b], 0..1' } },
  'property.set': { description: 'Set a 2D layer transform property', args: { target: 'layer ref or {createdBy:id}', path: 'matchName array', value: 'property value', coordinateSpace: 'parent for position' } },
  'keyframe.set': { description: 'Set one layer transform keyframe at a zero-based comp frame', args: { target: 'layer ref or {createdBy:id}', path: 'matchName array', frame: 'integer', value: 'property value' } }
});
const paths = {
  'ADBE Position': 2,
  'ADBE Scale': 2,
  'ADBE Opacity': 1,
  'ADBE Rotate Z': 1
};
function validateTarget(target, prior) {
  if (typeof target === 'string') return str(target, 'target');
  if (target && typeof target === 'object' && typeof target.createdBy === 'string' && prior.has(target.createdBy)) return target;
  throw new BridgeError('INVALID_ARGUMENT', 'target must be a layer reference or earlier createdBy operation');
}
function validateProperty(op) {
  if (!Array.isArray(op.path) || op.path.length !== 2 || op.path[0] !== 'ADBE Transform Group' || !(op.path[1] in paths))
    throw new BridgeError('INVALID_PROPERTY', 'Only 2D transform matchName paths are supported');
  const count = paths[op.path[1]];
  if (count === 1 && !finite(op.value)) throw new BridgeError('INVALID_ARGUMENT', 'Property value must be finite');
  if (count === 2) vec(op.value, 2, 'value');
  if (op.path[1] === 'ADBE Position' && op.coordinateSpace !== 'parent') throw new BridgeError('INVALID_ARGUMENT', 'Position requires coordinateSpace: parent');
  if (op.path[1] === 'ADBE Opacity' && (op.value < 0 || op.value > 100)) throw new BridgeError('INVALID_ARGUMENT', 'Opacity must be 0..100');
}
export function validateBatch(batch) {
  if (!batch || typeof batch !== 'object') throw new BridgeError('INVALID_ARGUMENT', 'Batch object required');
  str(batch.requestId, 'requestId', 128);
  str(batch.projectSessionId, 'projectSessionId', 128);
  str(batch.expectedInspectionToken, 'expectedInspectionToken', 128);
  str(batch.label, 'label', 128);
  if (!Array.isArray(batch.operations) || batch.operations.length < 1 || batch.operations.length > MAX_OPERATIONS)
    throw new BridgeError('INVALID_ARGUMENT', `operations must contain 1..${MAX_OPERATIONS} items`);
  const ids = new Set();
  for (const op of batch.operations) {
    if (!op || typeof op !== 'object' || !(op.op in catalog)) throw new BridgeError('UNSUPPORTED_CAPABILITY', `Unsupported operation: ${op?.op}`);
    str(op.id, 'operation id', 128);
    if (ids.has(op.id)) throw new BridgeError('INVALID_ARGUMENT', `Duplicate operation id: ${op.id}`);
    if (op.op === 'layer.create_text') {
      str(op.compRef, 'compRef');
      str(op.text, 'text', 10000);
      if (op.name !== undefined) str(op.name, 'name');
    } else if (op.op === 'layer.create_shape') {
      str(op.compRef, 'compRef');
      if (op.name !== undefined) str(op.name, 'name');
      vec(op.sizePx, 2, 'sizePx');
      if (op.sizePx.some(x => x <= 0 || x > 30000)) throw new BridgeError('INVALID_ARGUMENT', 'Shape size must be positive and <= 30000px');
      if (!finite(op.radiusPx) || op.radiusPx < 0) throw new BridgeError('INVALID_ARGUMENT', 'radiusPx must be nonnegative');
      vec(op.fillRgb, 3, 'fillRgb');
      if (op.fillRgb.some(x => x < 0 || x > 1)) throw new BridgeError('INVALID_ARGUMENT', 'fillRgb values must be 0..1');
    } else {
      validateTarget(op.target, ids);
      validateProperty(op);
      if (op.op === 'keyframe.set' && (!Number.isSafeInteger(op.frame) || op.frame < 0)) throw new BridgeError('INVALID_ARGUMENT', 'frame must be a nonnegative integer');
    }
    ids.add(op.id);
  }
  return batch;
}
export function validateFrame(input) {
  str(input.projectSessionId, 'projectSessionId');
  str(input.compRef, 'compRef');
  if (!Number.isSafeInteger(input.frame) || input.frame < 0) throw new BridgeError('INVALID_ARGUMENT', 'frame must be a nonnegative integer');
  const maxLongEdge = input.maxLongEdge ?? 1280;
  if (!Number.isInteger(maxLongEdge) || maxLongEdge < 64 || maxLongEdge > 4096) throw new BridgeError('INVALID_ARGUMENT', 'maxLongEdge must be 64..4096');
  return { ...input, maxLongEdge };
}
export function normalizeError(e) {
  return e instanceof BridgeError ? e.toJSON() : { code: 'INTERNAL_ERROR', message: e?.message || String(e) };
}
