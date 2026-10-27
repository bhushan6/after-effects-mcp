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
  'layer.create_shape': { description: 'Create an editable rounded rectangle or ellipse centred on the layer origin, filled and/or stroked', args: { compRef: 'comp reference', name: 'optional string', shape: 'optional rect|ellipse, default rect', sizePx: '[width,height]', radiusPx: 'rect corner radius; required for rect', fillRgb: 'optional [r,g,b], 0..1', strokeRgb: 'optional [r,g,b], 0..1', strokeWidthPx: 'optional px, default 2 when stroked' } },
  'layer.create_image': { description: 'Import an image file (or reuse it if already imported) and add it as a layer centred in the comp', args: { compRef: 'comp reference', path: 'absolute .png/.jpg/.jpeg/.psd/.tif path', name: 'optional string' } },
  'layer.replace_image': { description: 'Swap an image layer source to a file, importing it or reloading the already-imported footage from disk, so a re-exported asset updates without Reload Footage. Transforms are kept; the anchor point is not re-centred if the image size changes', args: { target: 'layer ref or {createdBy:id}', path: 'absolute .png/.jpg/.jpeg/.psd/.tif path' } },
  'layer.create_path': { description: 'Create a shape layer from bezier paths in layer space, one group per path. trim adds Trim Paths (start 0, end 100) that keyframe.set can animate', args: { compRef: 'comp reference', name: 'optional string', paths: '1..32 of {vertices:[[x,y]...], inTangents?:[[x,y]...], outTangents?:[[x,y]...], closed:boolean}', fillRgb: 'optional [r,g,b], 0..1', strokeRgb: 'optional [r,g,b], 0..1', strokeWidthPx: 'optional px', lineCap: 'optional butt|round|square', lineJoin: 'optional miter|round|bevel', trim: 'optional simultaneous|individual' } },
  'layer.set_parent': { description: 'Parent a layer (or clear with parent null). Existing transform values are kept and reinterpreted in the parent layer space, so set Position after parenting', args: { target: 'layer ref or {createdBy:id}', parent: 'layer ref, {createdBy:id} or null' } },
  'layer.set_track_matte': { description: 'Use another layer as this layer track matte and hide the matte layer', args: { target: 'layer ref or {createdBy:id}', matte: 'layer ref or {createdBy:id}', type: 'alpha|alpha_inverted|luma|luma_inverted' } },
  'layer.set_switches': { description: 'Set layer switches. Turning motion blur on also enables it for the comp', args: { target: 'layer ref or {createdBy:id}', motionBlur: 'boolean' } },
  'text.typewriter': { description: 'Type the layer text out one character at a time between two frames, driven by a "Typewriter" slider. Style the text first: styling refuses expression-driven text. caret adds a blinking caret layer that follows the typed text, shares the text parent and timing, and becomes this operation created ref', args: { target: 'text layer ref or {createdBy:id}', startFrame: 'integer', endFrame: 'integer > startFrame', caret: 'optional {sizePx:[w,h], colorRgb:[r,g,b], gapPx?:number}' } },
  'property.set': { description: 'Set a 2D transform property (Position, Anchor Point, Scale, Opacity, Rotation) or a Trim Paths start/end on a layer made with trim', args: { target: 'layer ref or {createdBy:id}', path: 'matchName array', value: 'property value', coordinateSpace: 'parent for position' } },
  'keyframe.set': { description: 'Set one keyframe of a property.set property at a zero-based comp frame', args: { target: 'layer ref or {createdBy:id}', path: 'matchName array', frame: 'integer', value: 'property value' } },
  'text.set_style': { description: 'Style a whole text layer; give at least one field. anchor "center" moves the anchor to the text box centre so Position places the visual centre', args: { target: 'text layer ref or {createdBy:id}', font: 'optional installed PostScript name, e.g. HelveticaNeue', fillRgb: 'optional [r,g,b], 0..1', fontSize: 'optional px, 1..1296', leading: 'optional line spacing px, 1..5000 (turns off auto leading)', tracking: 'optional -1000..10000', justification: 'optional left|center|right', anchor: 'optional "center"' } },
  'text.set_text': { description: 'Replace the text of an existing text layer, keeping its style', args: { target: 'text layer ref or {createdBy:id}', text: 'string; \\r starts a new line' } },
  'layer.set_timing': { description: 'Trim when a layer is visible. Frames are zero-based comp frames; outFrame is exclusive', args: { target: 'layer ref or {createdBy:id}', inFrame: 'integer', outFrame: 'integer > inFrame, <= comp length in frames' } },
  'project.save': { description: 'Save the project file. Saves in place when the project already has a file; a never-saved project needs path. Refuses to overwrite a different existing file. Must be the only operation in its batch', args: { path: 'optional absolute .aep path (required for a never-saved project; otherwise Save As)' } },
  'comp.create': { description: 'Create a composition and open it in the viewer so it becomes the active comp. Must be the only operation in its batch; inspect again for its compRef', args: { name: 'string', width: 'px', height: 'px', fps: '1..120', durationFrames: 'integer', backgroundRgb: 'optional [r,g,b], 0..1' } },
  'keyframe.ease': { description: 'Set temporal easing on existing keyframes of a property.set property. ease_in slows into a key, ease_out slows out of it, ease_in_out does both (AE Easy Ease), linear removes easing', args: { target: 'layer ref or {createdBy:id}', path: 'matchName array', ease: 'ease_in|ease_out|ease_in_out|linear', frames: 'optional keyframe frames; default all keys on the property', influence: 'optional percent 0.1..100, default 33.333' } }
});
export const JUSTIFICATIONS = ['left', 'center', 'right'];
export const EASES = ['ease_in', 'ease_out', 'ease_in_out', 'linear'];
export const SHAPES = ['rect', 'ellipse'];
export const LINE_CAPS = ['butt', 'round', 'square'];
export const LINE_JOINS = ['miter', 'round', 'bevel'];
export const TRIM_MODES = ['simultaneous', 'individual'];
export const MATTE_TYPES = ['alpha', 'alpha_inverted', 'luma', 'luma_inverted'];
export const IMAGE_EXTENSIONS = /\.(png|jpe?g|psd|tiff?)$/i;
// Supported property paths (matchNames joined by "/") and their dimensions.
const paths = {
  'ADBE Transform Group/ADBE Anchor Point': 2,
  'ADBE Transform Group/ADBE Position': 2,
  'ADBE Transform Group/ADBE Scale': 2,
  'ADBE Transform Group/ADBE Opacity': 1,
  'ADBE Transform Group/ADBE Rotate Z': 1,
  'ADBE Root Vectors Group/ADBE Vector Filter - Trim/ADBE Vector Trim Start': 1,
  'ADBE Root Vectors Group/ADBE Vector Filter - Trim/ADBE Vector Trim End': 1
};
function validateImagePath(path) {
  str(path, 'path', 1024);
  if (!path.startsWith('/') || /[\r\n]/.test(path) || !IMAGE_EXTENSIONS.test(path)) throw new BridgeError('INVALID_ARGUMENT', 'path must be an absolute .png, .jpg, .jpeg, .psd or .tif file path');
}
const pathKey = path => Array.isArray(path) && path.every(x => typeof x === 'string') ? path.join('/') : '';
function validateTarget(target, prior) {
  if (typeof target === 'string') return str(target, 'target');
  if (target && typeof target === 'object' && typeof target.createdBy === 'string' && prior.has(target.createdBy)) return target;
  throw new BridgeError('INVALID_ARGUMENT', 'target must be a layer reference or earlier createdBy operation');
}
function validatePath(op) {
  if (!(pathKey(op.path) in paths)) throw new BridgeError('INVALID_PROPERTY', 'Only 2D transform and Trim Paths start/end matchName paths are supported');
}
const rgb = (x, name) => {
  vec(x, 3, name);
  if (x.some(v => v < 0 || v > 1)) throw new BridgeError('INVALID_ARGUMENT', `${name} values must be 0..1`);
};
const oneOf = (x, list, name) => { if (!list.includes(x)) throw new BridgeError('INVALID_ARGUMENT', `${name} must be one of ${list.join(', ')}`); };
function validatePaint(op, needsPaint) {
  if (op.fillRgb !== undefined) rgb(op.fillRgb, 'fillRgb');
  if (op.strokeRgb !== undefined) rgb(op.strokeRgb, 'strokeRgb');
  if (needsPaint && op.fillRgb === undefined && op.strokeRgb === undefined) throw new BridgeError('INVALID_ARGUMENT', 'Give fillRgb, strokeRgb or both');
  if (op.strokeWidthPx !== undefined && (!finite(op.strokeWidthPx) || op.strokeWidthPx <= 0 || op.strokeWidthPx > 1000)) throw new BridgeError('INVALID_ARGUMENT', 'strokeWidthPx must be >0 and <= 1000');
}
const points = (x, n, name) => {
  if (!Array.isArray(x) || x.length !== n) throw new BridgeError('INVALID_ARGUMENT', `${name} must contain ${n} points`);
  x.forEach((p, i) => vec(p, 2, `${name}[${i}]`));
};
function validateBezier(paths) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 32) throw new BridgeError('INVALID_ARGUMENT', 'paths must contain 1..32 paths');
  for (const p of paths) {
    if (!p || !Array.isArray(p.vertices) || p.vertices.length < 2 || p.vertices.length > 500) throw new BridgeError('INVALID_ARGUMENT', 'Each path needs 2..500 vertices');
    points(p.vertices, p.vertices.length, 'vertices');
    if (p.inTangents !== undefined) points(p.inTangents, p.vertices.length, 'inTangents');
    if (p.outTangents !== undefined) points(p.outTangents, p.vertices.length, 'outTangents');
    if (typeof p.closed !== 'boolean') throw new BridgeError('INVALID_ARGUMENT', 'Each path needs closed: true or false');
  }
}
function validateRef(target, prior, name) {
  try { return validateTarget(target, prior); }
  catch { throw new BridgeError('INVALID_ARGUMENT', `${name} must be a layer reference or earlier createdBy operation`); }
}
function validateEase(op) {
  validatePath(op);
  if (!EASES.includes(op.ease)) throw new BridgeError('INVALID_ARGUMENT', `ease must be one of ${EASES.join(', ')}`);
  if (op.frames !== undefined) {
    if (!Array.isArray(op.frames) || op.frames.length < 1 || op.frames.length > 100 || !op.frames.every(f => Number.isSafeInteger(f) && f >= 0) || new Set(op.frames).size !== op.frames.length)
      throw new BridgeError('INVALID_ARGUMENT', 'frames must be 1..100 distinct nonnegative integers');
  }
  if (op.influence !== undefined && (!finite(op.influence) || op.influence < 0.1 || op.influence > 100)) throw new BridgeError('INVALID_ARGUMENT', 'influence must be 0.1..100');
}
function validateProperty(op) {
  validatePath(op);
  const count = paths[pathKey(op.path)], last = op.path[op.path.length - 1];
  if (count === 1 && !finite(op.value)) throw new BridgeError('INVALID_ARGUMENT', 'Property value must be finite');
  if (count === 2) vec(op.value, 2, 'value');
  if (last === 'ADBE Position' && op.coordinateSpace !== 'parent') throw new BridgeError('INVALID_ARGUMENT', 'Position requires coordinateSpace: parent');
  if ((last === 'ADBE Opacity' || last.startsWith('ADBE Vector Trim')) && (op.value < 0 || op.value > 100)) throw new BridgeError('INVALID_ARGUMENT', `${last === 'ADBE Opacity' ? 'Opacity' : 'Trim start/end'} must be 0..100`);
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
      if (op.shape !== undefined) oneOf(op.shape, SHAPES, 'shape');
      vec(op.sizePx, 2, 'sizePx');
      if (op.sizePx.some(x => x <= 0 || x > 30000)) throw new BridgeError('INVALID_ARGUMENT', 'Shape size must be positive and <= 30000px');
      if ((op.shape || 'rect') === 'rect' && (!finite(op.radiusPx) || op.radiusPx < 0)) throw new BridgeError('INVALID_ARGUMENT', 'radiusPx must be nonnegative');
      validatePaint(op, true);
    } else if (op.op === 'layer.create_image') {
      str(op.compRef, 'compRef');
      if (op.name !== undefined) str(op.name, 'name');
      validateImagePath(op.path);
    } else if (op.op === 'layer.replace_image') {
      validateTarget(op.target, ids);
      validateImagePath(op.path);
    } else if (op.op === 'layer.create_path') {
      str(op.compRef, 'compRef');
      if (op.name !== undefined) str(op.name, 'name');
      validateBezier(op.paths);
      validatePaint(op, true);
      if (op.lineCap !== undefined) oneOf(op.lineCap, LINE_CAPS, 'lineCap');
      if (op.lineJoin !== undefined) oneOf(op.lineJoin, LINE_JOINS, 'lineJoin');
      if (op.trim !== undefined) oneOf(op.trim, TRIM_MODES, 'trim');
    } else if (op.op === 'layer.set_parent') {
      validateTarget(op.target, ids);
      if (op.parent !== null) validateRef(op.parent, ids, 'parent');
    } else if (op.op === 'layer.set_track_matte') {
      validateTarget(op.target, ids);
      validateRef(op.matte, ids, 'matte');
      oneOf(op.type, MATTE_TYPES, 'type');
    } else if (op.op === 'layer.set_switches') {
      validateTarget(op.target, ids);
      if (typeof op.motionBlur !== 'boolean') throw new BridgeError('INVALID_ARGUMENT', 'motionBlur must be true or false');
    } else if (op.op === 'text.typewriter') {
      validateTarget(op.target, ids);
      if (!Number.isSafeInteger(op.startFrame) || op.startFrame < 0) throw new BridgeError('INVALID_ARGUMENT', 'startFrame must be a nonnegative integer');
      if (!Number.isSafeInteger(op.endFrame) || op.endFrame <= op.startFrame) throw new BridgeError('INVALID_ARGUMENT', 'endFrame must be an integer greater than startFrame');
      if (op.caret !== undefined) {
        if (!op.caret || typeof op.caret !== 'object') throw new BridgeError('INVALID_ARGUMENT', 'caret must be an object');
        vec(op.caret.sizePx, 2, 'caret.sizePx');
        if (op.caret.sizePx.some(x => x <= 0 || x > 30000)) throw new BridgeError('INVALID_ARGUMENT', 'caret.sizePx must be positive');
        rgb(op.caret.colorRgb, 'caret.colorRgb');
        if (op.caret.gapPx !== undefined && !finite(op.caret.gapPx)) throw new BridgeError('INVALID_ARGUMENT', 'caret.gapPx must be finite');
      }
    } else if (op.op === 'project.save') {
      if (batch.operations.length !== 1) throw new BridgeError('INVALID_ARGUMENT', 'project.save must be the only operation in its batch');
      if (op.path !== undefined) {
        str(op.path, 'path', 1024);
        if (!op.path.startsWith('/') || /[\r\n]/.test(op.path) || !/\.aep$/i.test(op.path)) throw new BridgeError('INVALID_ARGUMENT', 'path must be an absolute .aep file path');
      }
    } else if (op.op === 'comp.create') {
      if (batch.operations.length !== 1) throw new BridgeError('INVALID_ARGUMENT', 'comp.create must be the only operation in its batch');
      str(op.name, 'name');
      for (const k of ['width', 'height']) if (!Number.isSafeInteger(op[k]) || op[k] < 4 || op[k] > 30000) throw new BridgeError('INVALID_ARGUMENT', `${k} must be an integer 4..30000`);
      if (!finite(op.fps) || op.fps < 1 || op.fps > 120) throw new BridgeError('INVALID_ARGUMENT', 'fps must be 1..120');
      if (!Number.isSafeInteger(op.durationFrames) || op.durationFrames < 1 || op.durationFrames > 100000) throw new BridgeError('INVALID_ARGUMENT', 'durationFrames must be an integer 1..100000');
      if (op.backgroundRgb !== undefined) {
        vec(op.backgroundRgb, 3, 'backgroundRgb');
        if (op.backgroundRgb.some(x => x < 0 || x > 1)) throw new BridgeError('INVALID_ARGUMENT', 'backgroundRgb values must be 0..1');
      }
    } else if (op.op === 'text.set_text') {
      validateTarget(op.target, ids);
      str(op.text, 'text', 10000);
    } else if (op.op === 'layer.set_timing') {
      validateTarget(op.target, ids);
      if (!Number.isSafeInteger(op.inFrame) || op.inFrame < 0) throw new BridgeError('INVALID_ARGUMENT', 'inFrame must be a nonnegative integer');
      if (!Number.isSafeInteger(op.outFrame) || op.outFrame <= op.inFrame) throw new BridgeError('INVALID_ARGUMENT', 'outFrame must be an integer greater than inFrame');
    } else if (op.op === 'text.set_style') {
      validateTarget(op.target, ids);
      if ([op.font, op.fillRgb, op.fontSize, op.leading, op.tracking, op.justification, op.anchor].every(x => x === undefined)) throw new BridgeError('INVALID_ARGUMENT', 'text.set_style needs at least one style field');
      if (op.font !== undefined && !/^[A-Za-z0-9_\-.]{1,128}$/.test(op.font)) throw new BridgeError('INVALID_ARGUMENT', 'font must be a PostScript name such as HelveticaNeue');
      if (op.leading !== undefined && (!finite(op.leading) || op.leading < 1 || op.leading > 5000)) throw new BridgeError('INVALID_ARGUMENT', 'leading must be 1..5000');
      if (op.tracking !== undefined && (!finite(op.tracking) || op.tracking < -1000 || op.tracking > 10000)) throw new BridgeError('INVALID_ARGUMENT', 'tracking must be -1000..10000');
      if (op.fillRgb !== undefined) {
        vec(op.fillRgb, 3, 'fillRgb');
        if (op.fillRgb.some(x => x < 0 || x > 1)) throw new BridgeError('INVALID_ARGUMENT', 'fillRgb values must be 0..1');
      }
      if (op.fontSize !== undefined && (!finite(op.fontSize) || op.fontSize < 1 || op.fontSize > 1296)) throw new BridgeError('INVALID_ARGUMENT', 'fontSize must be 1..1296');
      if (op.justification !== undefined && !JUSTIFICATIONS.includes(op.justification)) throw new BridgeError('INVALID_ARGUMENT', 'justification must be left, center or right');
      if (op.anchor !== undefined && op.anchor !== 'center') throw new BridgeError('INVALID_ARGUMENT', 'anchor must be "center"');
    } else if (op.op === 'keyframe.ease') {
      validateTarget(op.target, ids);
      validateEase(op);
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
export const MAX_VIDEO_FRAMES = 7200;
export function validateVideo(input) {
  str(input.projectSessionId, 'projectSessionId');
  str(input.compRef, 'compRef');
  if (!Number.isSafeInteger(input.startFrame) || input.startFrame < 0) throw new BridgeError('INVALID_ARGUMENT', 'startFrame must be a nonnegative integer');
  if (!Number.isSafeInteger(input.endFrameExclusive) || input.endFrameExclusive <= input.startFrame || input.endFrameExclusive - input.startFrame > MAX_VIDEO_FRAMES)
    throw new BridgeError('INVALID_ARGUMENT', `endFrameExclusive must be an integer 1..${MAX_VIDEO_FRAMES} frames after startFrame`);
  if (input.maxLongEdge !== undefined && (!Number.isInteger(input.maxLongEdge) || input.maxLongEdge < 64 || input.maxLongEdge > 4096)) throw new BridgeError('INVALID_ARGUMENT', 'maxLongEdge must be 64..4096');
  if (input.outputPath !== undefined) {
    str(input.outputPath, 'outputPath', 1024);
    if (!input.outputPath.startsWith('/') || /[\r\n]/.test(input.outputPath) || !/\.mp4$/i.test(input.outputPath)) throw new BridgeError('INVALID_ARGUMENT', 'outputPath must be an absolute .mp4 file path');
  }
  return input;
}
export function normalizeError(e) {
  return e instanceof BridgeError ? e.toJSON() : { code: 'INTERNAL_ERROR', message: e?.message || String(e) };
}
