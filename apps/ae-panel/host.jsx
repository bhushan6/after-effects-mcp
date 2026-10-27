/* After Effects ExtendScript (ES3-compatible syntax). Ordinary calls are allowlisted. */
var Bridge = Bridge || {};
Bridge.recent = Bridge.recent || {};
Bridge.recentOrder = Bridge.recentOrder || [];
Bridge.quote = function (s) {
  return '"' + String(s).replace(/[\\"\x00-\x1f]/g,function (c) {
    if (c === '"') return '\\"';
    if (c === '\\') return '\\\\';
    var code=c.charCodeAt(0).toString(16); while(code.length<4) code='0'+code;
    return '\\u'+code;
  }) + '"';
};
Bridge.stringify = function (x) {
  if (x === null || x === undefined) return 'null';
  if (typeof x === 'string') return Bridge.quote(x);
  if (typeof x === 'number') return isFinite(x) ? String(x) : 'null';
  if (typeof x === 'boolean') return String(x);
  var out = [], i, k;
  if (x instanceof Array) { for (i=0;i<x.length;i++) out.push(Bridge.stringify(x[i])); return '[' + out.join(',') + ']'; }
  for (k in x) if (x.hasOwnProperty(k) && x[k] !== undefined) out.push(Bridge.quote(k) + ':' + Bridge.stringify(x[k]));
  return '{' + out.join(',') + '}';
};
Bridge.parse = function (text) {
  if (typeof JSON !== 'undefined' && JSON.parse) return JSON.parse(text);
  // JSON grammar validation before evaluation on older ExtendScript engines.
  var safe = text.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g,'@')
    .replace(/"[^"\\\n\r]*"/g,'')
    .replace(/\b(?:true|false|null)\b/g,']')
    .replace(/-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,']')
    .replace(/[\[\]{}:,\s]/g,'');
  if (safe.length) throw new Error('Invalid JSON payload');
  return eval('(' + text + ')');
};
Bridge.error = function (code, message) { return { ok:false, error:{ code:code, message:String(message) } }; };
Bridge.ref = function (item, prefix) { if (item.id === undefined) throw new Error('Native item IDs unavailable'); return prefix + '_' + item.id; };
Bridge.comp = function (ref) {
  if (!/^comp_\d+$/.test(ref)) throw new Error('Invalid comp reference');
  var id = Number(ref.substr(5));
  for (var i=1;i<=app.project.numItems;i++) { var x=app.project.item(i); if (x instanceof CompItem && x.id === id) return x; }
  throw new Error('Stale comp reference');
};
Bridge.layer = function (ref, comp) {
  if (!/^layer_\d+$/.test(ref)) throw new Error('Invalid layer reference');
  var id = Number(ref.substr(6));
  for (var i=1;i<=comp.numLayers;i++) if (comp.layer(i).id === id) return comp.layer(i);
  throw new Error('Stale layer reference');
};
Bridge.inspect = function () {
  var active=app.project.activeItem, comp=active instanceof CompItem ? active : null;
  var projectFile=app.project.file ? app.project.file.fsName : null;
  var result={ project:{ path:projectFile, itemCount:app.project.numItems, signature:(projectFile || 'unsaved') + ':' + (app.project.rootFolder.id || 'root') }, activeComp:null, selection:[], currentTime:null, truncated:false,
    capabilities:{ nativeIds:!!(comp && comp.id !== undefined && (!comp.numLayers || comp.layer(1).id !== undefined)), liveFrame:!!(comp && typeof comp.saveFrameToPng === 'function'), undoGroup:true, automatedRevert:false } };
  if (!comp) return result;
  result.activeComp={ ref:Bridge.ref(comp,'comp'), name:comp.name, width:comp.width, height:comp.height, duration:comp.duration, frameDuration:comp.frameDuration, displayStartTime:comp.displayStartTime, layers:[] };
  result.currentTime={ seconds:comp.time, frame:Math.round(comp.time/comp.frameDuration) };
  if (comp.numLayers > 200) result.truncated=true;
  for (var i=1;i<=Math.min(comp.numLayers,200);i++) {
    var layer=comp.layer(i), ref=Bridge.ref(layer,'layer');
    var summary={ ref:ref, name:layer.name, index:i, inPoint:layer.inPoint, outPoint:layer.outPoint, threeD:layer.threeDLayer, parentRef:layer.parent ? Bridge.ref(layer.parent,'layer') : null, selected:layer.selected, transforms:{} };
    var transform=layer.property('ADBE Transform Group'), names=['ADBE Anchor Point','ADBE Position','ADBE Scale','ADBE Opacity','ADBE Rotate Z'];
    for (var j=0;j<names.length;j++) {
      var prop=transform && transform.property(names[j]);
      if (prop) {
        var keys=[];
        if (prop.numKeys > 100) result.truncated=true;
        for (var k=1;k<=Math.min(prop.numKeys,100);k++) keys.push(Bridge.keySummary(prop,k));
        summary.transforms[names[j]]={ value:prop.value, keys:keys, expressionEnabled:prop.expressionEnabled, dimensionsSeparated:prop.dimensionsSeparated || false };
      }
    }
    var textProp=layer.property('ADBE Text Properties');
    if (textProp) { var source=textProp.property('ADBE Text Document'); if (source) { summary.text=source.value.text; summary.textStyle=Bridge.textStyle(source.value); } }
    try { Bridge.addBounds(summary, layer, comp); } catch (e) {}
    result.activeComp.layers.push(summary);
    if (layer.selected) result.selection.push(ref);
  }
  return result;
};
// ExtendScript groups chained ternaries (a ? b : c ? d : e) left to right, so map enums with a table instead.
Bridge.justifications = function () {
  return { left:ParagraphJustification.LEFT_JUSTIFY, center:ParagraphJustification.CENTER_JUSTIFY, right:ParagraphJustification.RIGHT_JUSTIFY };
};
Bridge.textStyle = function (doc) {
  var names=Bridge.justifications(), justification='other';
  for (var name in names) if (names.hasOwnProperty(name) && names[name] === doc.justification) justification=name;
  var style={ font:doc.font, fontSize:doc.fontSize, leading:doc.autoLeading ? 'auto' : doc.leading, tracking:doc.tracking, justification:justification };
  try { if (doc.applyFill) style.fillRgb=doc.fillColor; } catch (e) {}
  try { style.spaceBefore=doc.spaceBefore; style.spaceAfter=doc.spaceAfter; } catch (e) {}
  return style;
};
// Layer-space content box, plus its comp-space box when the layer is unparented and unrotated, at a time the layer is visible.
Bridge.addBounds = function (summary, layer, comp) {
  if (typeof layer.sourceRectAtTime !== 'function') return;
  var t=Math.max(layer.inPoint, Math.min(comp.time, layer.outPoint - comp.frameDuration));
  var box=layer.sourceRectAtTime(t, false);
  summary.bounds={ time:t, left:box.left, top:box.top, width:box.width, height:box.height };
  var transform=layer.property('ADBE Transform Group');
  if (layer.parent || layer.threeDLayer || transform.property('ADBE Rotate Z').valueAtTime(t,false) !== 0) return;
  var anchor=transform.property('ADBE Anchor Point').valueAtTime(t,false), position=transform.property('ADBE Position').valueAtTime(t,false), scale=transform.property('ADBE Scale').valueAtTime(t,false);
  summary.compBounds={ left:position[0] + (box.left - anchor[0])*scale[0]/100, top:position[1] + (box.top - anchor[1])*scale[1]/100, width:box.width*scale[0]/100, height:box.height*scale[1]/100 };
};
Bridge.setTiming = function (layer, op, comp) {
  var inTime=op.inFrame*comp.frameDuration, outTime=op.outFrame*comp.frameDuration;
  if (outTime > comp.duration + comp.frameDuration/2) throw new Error('outFrame is past the end of the composition');
  // Move the far edge first so inPoint never has to pass outPoint.
  if (inTime >= layer.outPoint) { layer.outPoint=outTime; layer.inPoint=inTime; }
  else { layer.inPoint=inTime; layer.outPoint=outTime; }
};
Bridge.createComp = function (op) {
  var comp=app.project.items.addComp(op.name, op.width, op.height, 1, op.durationFrames/op.fps, op.fps);
  if (op.backgroundRgb) comp.bgColor=op.backgroundRgb;
  comp.openInViewer();
  return comp;
};
Bridge.setTextStyle = function (layer, op, comp) {
  var textProp=layer.property('ADBE Text Properties');
  if (!textProp) throw new Error('Target is not a text layer');
  var source=textProp.property('ADBE Text Document');
  if (source.numKeys > 0 || source.expressionEnabled) throw new Error('Source text is keyframed or expression-driven');
  if (op.font || op.fillRgb || op.fontSize !== undefined || op.leading !== undefined || op.tracking !== undefined || op.justification) {
    var doc=source.value;
    if (op.font) {
      if (typeof app !== 'undefined' && app.fonts && app.fonts.getFontsByPostScriptName && !app.fonts.getFontsByPostScriptName(op.font).length) throw new Error('Font not installed: ' + op.font);
      doc.font=op.font;
    }
    if (op.fillRgb) { doc.applyFill=true; doc.fillColor=op.fillRgb; }
    if (op.fontSize !== undefined) doc.fontSize=op.fontSize;
    // Each line break is a paragraph, so paragraph spacing inherited from AE's Paragraph panel adds to the line pitch.
    if (op.leading !== undefined) { doc.autoLeading=false; doc.leading=op.leading; try { doc.spaceBefore=0; doc.spaceAfter=0; } catch (e) {} }
    if (op.tracking !== undefined) doc.tracking=op.tracking;
    if (op.justification) doc.justification=Bridge.justifications()[op.justification];
    source.setValue(doc);
  }
  if (op.anchor === 'center') {
    if (layer.threeDLayer) throw new Error('3D text anchors not supported in this slice');
    var anchor=layer.property('ADBE Transform Group').property('ADBE Anchor Point');
    if (anchor.numKeys > 0 || anchor.expressionEnabled) throw new Error('Anchor point is keyframed or expression-driven');
    // Measure after restyling, at a time the layer is visible.
    var t=Math.max(layer.inPoint, Math.min(comp.time, layer.outPoint - comp.frameDuration));
    var box=layer.sourceRectAtTime(t, false);
    anchor.setValue([box.left + box.width/2, box.top + box.height/2]);
  }
};
Bridge.propertyPaths = {
  'ADBE Transform Group/ADBE Anchor Point':1, 'ADBE Transform Group/ADBE Position':1, 'ADBE Transform Group/ADBE Scale':1, 'ADBE Transform Group/ADBE Opacity':1, 'ADBE Transform Group/ADBE Rotate Z':1,
  'ADBE Root Vectors Group/ADBE Vector Filter - Trim/ADBE Vector Trim Start':1, 'ADBE Root Vectors Group/ADBE Vector Filter - Trim/ADBE Vector Trim End':1
};
Bridge.property = function (layer, path) {
  if (!(path instanceof Array) || !Bridge.propertyPaths.hasOwnProperty(path.join('/'))) throw new Error('Unsupported property path');
  if (path[0] === 'ADBE Transform Group' && layer.threeDLayer) throw new Error('3D transforms not supported in this slice');
  var property=layer;
  for (var i=0;i<path.length && property;i++) property=property.property(path[i]);
  if (!property) throw new Error('Property not found on this layer' + (path[0] === 'ADBE Root Vectors Group' ? '; create it with layer.create_path trim' : ''));
  if (property.dimensionsSeparated || property.expressionEnabled) throw new Error('Property is separated or expression-driven');
  return property;
};
Bridge.resolve = function (target, created) { return typeof target === 'string' ? target : created[target.createdBy]; };
// Stroke is added before fill so it draws on top, matching AE's default for new shapes.
Bridge.addPaint = function (contents, op) {
  if (op.strokeRgb) {
    var stroke=contents.addProperty('ADBE Vector Graphic - Stroke');
    stroke.property('ADBE Vector Stroke Color').setValue(op.strokeRgb);
    stroke.property('ADBE Vector Stroke Width').setValue(op.strokeWidthPx === undefined ? 2 : op.strokeWidthPx);
    if (op.lineCap) stroke.property('ADBE Vector Stroke Line Cap').setValue({ butt:1, round:2, square:3 }[op.lineCap]);
    if (op.lineJoin) stroke.property('ADBE Vector Stroke Line Join').setValue({ miter:1, round:2, bevel:3 }[op.lineJoin]);
  }
  if (op.fillRgb) contents.addProperty('ADBE Vector Graphic - Fill').property('ADBE Vector Fill Color').setValue(op.fillRgb);
};
Bridge.createShape = function (comp, op) {
  var layer=comp.layers.addShape();
  var contents=layer.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group').property('ADBE Vectors Group');
  if (op.shape === 'ellipse') contents.addProperty('ADBE Vector Shape - Ellipse').property('ADBE Vector Ellipse Size').setValue(op.sizePx);
  else {
    var rect=contents.addProperty('ADBE Vector Shape - Rect');
    rect.property('ADBE Vector Rect Size').setValue(op.sizePx);
    rect.property('ADBE Vector Rect Roundness').setValue(op.radiusPx);
  }
  Bridge.addPaint(contents, op);
  return layer;
};
Bridge.zeros = function (n) { var out=[]; for (var i=0;i<n;i++) out.push([0,0]); return out; };
Bridge.createPath = function (comp, op) {
  var layer=comp.layers.addShape(), root=layer.property('ADBE Root Vectors Group');
  for (var i=0;i<op.paths.length;i++) {
    var p=op.paths[i], contents=root.addProperty('ADBE Vector Group').property('ADBE Vectors Group');
    var shape=new Shape();
    shape.vertices=p.vertices;
    shape.inTangents=p.inTangents || Bridge.zeros(p.vertices.length);
    shape.outTangents=p.outTangents || Bridge.zeros(p.vertices.length);
    shape.closed=p.closed;
    contents.addProperty('ADBE Vector Shape - Group').property('ADBE Vector Shape').setValue(shape);
    Bridge.addPaint(contents, op);
  }
  if (op.trim) root.addProperty('ADBE Vector Filter - Trim').property('ADBE Vector Trim Type').setValue(op.trim === 'individual' ? 2 : 1);
  return layer;
};
Bridge.findFootage = function (file) {
  for (var i=1;i<=app.project.numItems;i++) {
    var x=app.project.item(i);
    if (x instanceof FootageItem && x.file && x.file.fsName === file.fsName) return x;
  }
  return null;
};
Bridge.imageFile = function (path) {
  var file=new File(path);
  if (!file.exists) throw new Error('Image file not found: ' + path);
  return file;
};
// Reuse footage already imported from the same file so repeated batches don't duplicate project items.
Bridge.createImage = function (comp, op) {
  var file=Bridge.imageFile(op.path);
  return comp.layers.add(Bridge.findFootage(file) || app.project.importFile(new ImportOptions(file)));
};
// Reload footage already imported from the file so a re-exported asset shows its new pixels, then point the layer at it.
Bridge.replaceImage = function (layer, op) {
  if (typeof layer.replaceSource !== 'function' || !(layer.source instanceof FootageItem)) throw new Error('Target is not a footage layer');
  var file=Bridge.imageFile(op.path), item=Bridge.findFootage(file);
  if (!item) item=app.project.importFile(new ImportOptions(file));
  else if (item.mainSource && typeof item.mainSource.reload === 'function') item.mainSource.reload();
  else item.replace(file);
  if (layer.source.id !== item.id) layer.replaceSource(item, false);
};
Bridge.setParent = function (layer, parent) {
  if (!parent) { layer.parent=null; return; }
  for (var p=parent; p; p=p.parent) if (p.id === layer.id) throw new Error('Parenting would create a cycle');
  layer.setParentWithJump(parent);
};
Bridge.setTrackMatte = function (layer, matte, type) {
  if (matte.id === layer.id) throw new Error('A layer cannot be its own track matte');
  if (typeof layer.setTrackMatte !== 'function') throw new Error('Track mattes by layer need After Effects 23 or newer');
  var types={ alpha:TrackMatteType.ALPHA, alpha_inverted:TrackMatteType.ALPHA_INVERTED, luma:TrackMatteType.LUMA, luma_inverted:TrackMatteType.LUMA_INVERTED };
  layer.setTrackMatte(matte, types[type]);
  matte.enabled=false;
};
// Reveals the text with a "Typewriter" slider feeding a Source Text expression, so the text stays editable.
Bridge.typewriter = function (layer, op, comp) {
  var textProp=layer.property('ADBE Text Properties');
  if (!textProp) throw new Error('Target is not a text layer');
  var source=textProp.property('ADBE Text Document');
  if (source.numKeys > 0 || source.expressionEnabled) throw new Error('Source text is already keyframed or expression-driven');
  for (var i=1;i<=comp.numLayers;i++) if (comp.layer(i).name === layer.name && comp.layer(i).id !== layer.id) throw new Error('Give the text layer a unique name first; expressions find it by name');
  var doc=source.value, fd=comp.frameDuration;
  if (op.endFrame*fd >= comp.duration) throw new Error('endFrame outside comp duration');
  var slider=layer.property('ADBE Effect Parade').addProperty('ADBE Slider Control');
  slider.name='Typewriter';
  var amount=slider.property('ADBE Slider Control-0001');
  amount.setValueAtTime(op.startFrame*fd, 0);
  amount.setValueAtTime(op.endFrame*fd, doc.text.length);
  for (var k=1;k<=amount.numKeys;k++) amount.setInterpolationTypeAtKey(k, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
  var expression='var n = Math.round(effect("Typewriter")(1));\rtext.sourceText.toString().substr(0, Math.max(0, n))';
  if (!op.caret) { source.expression=expression; return layer; }
  // Measure the full text before the expression empties it: one line's height places the caret on the last typed line.
  var t=Math.max(layer.inPoint, Math.min(comp.time, layer.outPoint - fd)), box=layer.sourceRectAtTime(t, false);
  var lineHeight=/[\r\n]/.test(doc.text) ? doc.fontSize*1.2 : box.height, gap=op.caret.gapPx === undefined ? doc.fontSize*0.08 : op.caret.gapPx;
  source.expression=expression;
  var caret=Bridge.createShape(comp, { sizePx:op.caret.sizePx, radiusPx:0, fillRgb:op.caret.colorRgb });
  caret.name=layer.name + ' Caret';
  if (layer.parent) caret.setParentWithJump(layer.parent);
  caret.outPoint=layer.outPoint; caret.inPoint=layer.inPoint;
  var target='thisComp.layer(' + Bridge.quote(layer.name) + ')';
  var transform=caret.property('ADBE Transform Group');
  transform.property('ADBE Position').expression='var l = ' + target + ';\rvar r = l.sourceRectAtTime(time, false);\r' +
    'var p = l.toComp([r.left + r.width + ' + gap + ', r.height > 0 ? r.top + r.height - ' + lineHeight/2 + ' : ' + (-doc.fontSize*0.35) + ']);\r' +
    'hasParent ? parent.fromComp(p) : p';
  transform.property('ADBE Opacity').expression='var t0 = ' + op.startFrame*fd + ', t1 = ' + op.endFrame*fd + ';\r' +
    '(time >= t0 && time <= t1) ? 100 : (Math.floor(Math.abs(time - t1) * 2.2) % 2 == 0 ? 100 : 0)';
  return caret;
};
Bridge.interpolationName = function (type) {
  var names={ linear:KeyframeInterpolationType.LINEAR, bezier:KeyframeInterpolationType.BEZIER, hold:KeyframeInterpolationType.HOLD };
  for (var name in names) if (names.hasOwnProperty(name) && names[name] === type) return name;
  return 'other';
};
Bridge.keySummary = function (prop, k) {
  return { time:prop.keyTime(k), value:prop.keyValue(k),
    interpolation:[Bridge.interpolationName(prop.keyInInterpolationType(k)), Bridge.interpolationName(prop.keyOutInterpolationType(k))],
    influence:[prop.keyInTemporalEase(k)[0].influence, prop.keyOutTemporalEase(k)[0].influence] };
};
// Spatial properties take one temporal ease per side; other multi-dimensional ones take one per dimension.
Bridge.easeDimensions = function (prop) {
  if (prop.propertyValueType === PropertyValueType.TwoD) return 2;
  if (prop.propertyValueType === PropertyValueType.ThreeD) return 3;
  return 1;
};
Bridge.easeKeys = function (prop, op, comp) {
  if (prop.numKeys < 1) throw new Error('Property has no keyframes to ease');
  var keys=[], k, i;
  if (op.frames) {
    for (i=0;i<op.frames.length;i++) {
      var found=0;
      for (k=1;k<=prop.numKeys;k++) if (Math.round(prop.keyTime(k)/comp.frameDuration) === op.frames[i]) found=k;
      if (!found) throw new Error('No keyframe at frame ' + op.frames[i]);
      keys.push(found);
    }
  } else for (k=1;k<=prop.numKeys;k++) keys.push(k);
  var easeIn=op.ease === 'ease_in' || op.ease === 'ease_in_out', easeOut=op.ease === 'ease_out' || op.ease === 'ease_in_out';
  var influence=op.influence === undefined ? 33.333 : op.influence, dims=Bridge.easeDimensions(prop);
  var BEZIER=KeyframeInterpolationType.BEZIER, LINEAR=KeyframeInterpolationType.LINEAR;
  for (i=0;i<keys.length;i++) {
    k=keys[i];
    if (op.ease === 'linear') { prop.setInterpolationTypeAtKey(k, LINEAR, LINEAR); continue; }
    var inEase=prop.keyInTemporalEase(k), outEase=prop.keyOutTemporalEase(k);
    if (easeIn) { inEase=[]; for (var d=0;d<dims;d++) inEase.push(new KeyframeEase(0, influence)); }
    if (easeOut) { outEase=[]; for (var e=0;e<dims;e++) outEase.push(new KeyframeEase(0, influence)); }
    var inType=prop.keyInInterpolationType(k), outType=prop.keyOutInterpolationType(k);
    if (easeIn) inType=BEZIER;
    if (easeOut) outType=BEZIER;
    prop.setInterpolationTypeAtKey(k, inType, outType);
    prop.setTemporalEaseAtKey(k, inEase, outEase);
  }
};
// Save in place, or to a new .aep (needed when the project has never been saved). Never replaces some other existing file.
Bridge.saveProject = function (op) {
  var current=app.project.file;
  if (!op.path) {
    if (!current) throw new Error('The project has never been saved; give an absolute .aep path');
    app.project.save();
    return current.fsName;
  }
  var file=new File(op.path);
  if (file.exists && !(current && current.fsName === file.fsName)) throw new Error('A different file already exists at ' + op.path);
  if (!file.parent.exists) throw new Error('Folder does not exist: ' + file.parent.fsName);
  app.project.save(file);
  return file.fsName;
};
Bridge.executeBatch = function (batch) {
  var outcomes=[], created={}, comp=app.project.activeItem;
  if (batch.operations.length === 1 && batch.operations[0].op === 'project.save') {
    var saveOp=batch.operations[0];
    try { return { ok:true, value:{ state:'succeeded', outcomes:[{ id:saveOp.id, state:'succeeded', path:Bridge.saveProject(saveOp) }] } }; }
    catch (e) { return { ok:true, value:{ state:'partial', outcomes:[{ id:saveOp.id, state:'failed', error:String(e) }], warning:'Project was not saved' } }; }
  }
  if (batch.operations.length === 1 && batch.operations[0].op === 'comp.create') {
    app.beginUndoGroup(batch.label);
    try {
      var newComp=Bridge.createComp(batch.operations[0]);
      created[batch.operations[0].id]=Bridge.ref(newComp,'comp');
      return { ok:true, value:{ state:'succeeded', outcomes:[{ id:batch.operations[0].id, state:'succeeded', ref:created[batch.operations[0].id] }], created:created } };
    } catch (e) {
      return { ok:true, value:{ state:'partial', outcomes:[{ id:batch.operations[0].id, state:'failed', error:String(e) }], warning:'Inspect before retrying' } };
    } finally { app.endUndoGroup(); }
  }
  if (!(comp instanceof CompItem)) return Bridge.error('WRONG_PROJECT','Activate a composition before editing');
  app.beginUndoGroup(batch.label);
  try {
    for (var i=0;i<batch.operations.length;i++) {
      var op=batch.operations[i], layer=null;
      try {
        if (op.op === 'layer.create_text' || op.op === 'layer.create_shape' || op.op === 'layer.create_image' || op.op === 'layer.create_path') {
          if (Bridge.ref(comp,'comp') !== op.compRef) throw new Error('Wrong active composition');
          if (op.op === 'layer.create_text') layer=comp.layers.addText(op.text);
          else if (op.op === 'layer.create_shape') layer=Bridge.createShape(comp, op);
          else if (op.op === 'layer.create_image') layer=Bridge.createImage(comp, op);
          else layer=Bridge.createPath(comp, op);
          if (op.name) layer.name=op.name;
          created[op.id]=Bridge.ref(layer,'layer');
          outcomes.push({ id:op.id, state:'succeeded', ref:created[op.id] });
        } else if (op.op === 'property.set' || op.op === 'keyframe.set') {
          var target=typeof op.target === 'string' ? op.target : created[op.target.createdBy];
          layer=Bridge.layer(target,comp);
          var prop=Bridge.property(layer,op.path);
          if (op.op === 'property.set') prop.setValue(op.value);
          else { if (op.frame*comp.frameDuration >= comp.duration) throw new Error('Frame outside comp duration'); prop.setValueAtTime(op.frame*comp.frameDuration,op.value); }
          outcomes.push({ id:op.id, state:'succeeded', ref:target });
        } else if (op.op === 'text.set_text') {
          var textTarget=typeof op.target === 'string' ? op.target : created[op.target.createdBy];
          var textGroup=Bridge.layer(textTarget,comp).property('ADBE Text Properties');
          if (!textGroup) throw new Error('Target is not a text layer');
          var sourceText=textGroup.property('ADBE Text Document');
          if (sourceText.numKeys > 0 || sourceText.expressionEnabled) throw new Error('Source text is keyframed or expression-driven');
          var textDoc=sourceText.value; textDoc.text=op.text; sourceText.setValue(textDoc);
          outcomes.push({ id:op.id, state:'succeeded', ref:textTarget });
        } else if (op.op === 'layer.set_timing') {
          var timingTarget=typeof op.target === 'string' ? op.target : created[op.target.createdBy];
          Bridge.setTiming(Bridge.layer(timingTarget,comp),op,comp);
          outcomes.push({ id:op.id, state:'succeeded', ref:timingTarget });
        } else if (op.op === 'keyframe.ease') {
          var easeTarget=typeof op.target === 'string' ? op.target : created[op.target.createdBy];
          Bridge.easeKeys(Bridge.property(Bridge.layer(easeTarget,comp),op.path),op,comp);
          outcomes.push({ id:op.id, state:'succeeded', ref:easeTarget });
        } else if (op.op === 'layer.set_parent' || op.op === 'layer.set_track_matte' || op.op === 'layer.set_switches') {
          var linkTarget=Bridge.resolve(op.target, created), linked=Bridge.layer(linkTarget,comp);
          if (op.op === 'layer.set_parent') Bridge.setParent(linked, op.parent === null ? null : Bridge.layer(Bridge.resolve(op.parent, created),comp));
          else if (op.op === 'layer.set_track_matte') Bridge.setTrackMatte(linked, Bridge.layer(Bridge.resolve(op.matte, created),comp), op.type);
          else { linked.motionBlur=op.motionBlur; if (op.motionBlur) comp.motionBlur=true; }
          outcomes.push({ id:op.id, state:'succeeded', ref:linkTarget });
        } else if (op.op === 'layer.replace_image') {
          var imageTarget=Bridge.resolve(op.target, created);
          Bridge.replaceImage(Bridge.layer(imageTarget,comp),op);
          outcomes.push({ id:op.id, state:'succeeded', ref:imageTarget });
        } else if (op.op === 'text.typewriter') {
          var typed=Bridge.typewriter(Bridge.layer(Bridge.resolve(op.target, created),comp),op,comp);
          created[op.id]=Bridge.ref(typed,'layer');
          outcomes.push({ id:op.id, state:'succeeded', ref:created[op.id] });
        } else if (op.op === 'text.set_style') {
          var styleTarget=typeof op.target === 'string' ? op.target : created[op.target.createdBy];
          Bridge.setTextStyle(Bridge.layer(styleTarget,comp),op,comp);
          outcomes.push({ id:op.id, state:'succeeded', ref:styleTarget });
        } else throw new Error('Unsupported operation');
      } catch (e) {
        outcomes.push({ id:op.id, state:'failed', error:String(e) });
        return { ok:true, value:{ state:'partial', outcomes:outcomes, warning:'Undo group may contain completed changes; inspect before retrying' } };
      }
    }
    return { ok:true, value:{ state:'succeeded', outcomes:outcomes, created:created } };
  } finally { app.endUndoGroup(); }
};
// Rendering needs the comp to be the viewer's active item, so open it rather than refusing.
Bridge.openComp = function (p) {
  var comp=Bridge.comp(p.compRef);
  if (app.project.activeItem !== comp) comp.openInViewer();
  return { ok:true, value:{ ref:p.compRef, active:app.project.activeItem === comp } };
};
Bridge.renderFrame = function (p) {
  var comp=Bridge.comp(p.compRef), frame=p.frame, time=frame*comp.frameDuration;
  if (app.project.activeItem !== comp) comp.openInViewer();
  if (time < 0 || time >= comp.duration) return Bridge.error('INVALID_ARGUMENT','Frame outside composition duration');
  if (typeof comp.saveFrameToPng !== 'function') return { ok:true, value:{ supported:false, reason:'saveFrameToPng is unavailable in this After Effects scripting build' } };
  var priorTime=comp.time;
  try {
    comp.saveFrameToPng(time, new File(p.outputPath));
    return { ok:true, value:{ supported:true, effectiveFrame:frame, effectiveSeconds:time, width:comp.width, height:comp.height, warnings:[] } };
  } catch (e) { return Bridge.error('RENDER_FAILED',e); }
  finally { if (comp.time !== priorTime) comp.time=priorTime; }
};
Bridge.dispatch = function (payload) {
  try {
    var request=Bridge.parse(payload), method=request.method, wrapper=request.params || {};
    if (method === 'hello') return Bridge.stringify({ ok:true, value:{ aeVersion:app.version } });
    var id=wrapper.id;
    if (!id || typeof id !== 'string') return Bridge.stringify(Bridge.error('INVALID_ARGUMENT','Request ID required'));
    if (Bridge.recent.hasOwnProperty(id)) return Bridge.stringify(Bridge.recent[id]);
    var p=wrapper.params || {}, result;
    if (method === 'inspect') result={ ok:true, value:Bridge.inspect() };
    else if (method === 'executeBatch') result=Bridge.executeBatch(p);
    else if (method === 'renderFrame') result=Bridge.renderFrame(p);
    else if (method === 'openComp') result=Bridge.openComp(p);
    else result=Bridge.error('UNSUPPORTED_CAPABILITY','Unknown host method');
    Bridge.recent[id]=result; Bridge.recentOrder.push(id);
    if (Bridge.recentOrder.length > 50) delete Bridge.recent[Bridge.recentOrder.shift()];
    return Bridge.stringify(result);
  } catch (e) { return Bridge.stringify(Bridge.error('AE_ERROR',e)); }
};
