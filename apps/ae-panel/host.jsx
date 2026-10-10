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
    .replace(/\b(?:true|false|null)\b/g,'0')
    .replace(/-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,'0')
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
    var transform=layer.property('ADBE Transform Group'), names=['ADBE Position','ADBE Scale','ADBE Opacity','ADBE Rotate Z'];
    for (var j=0;j<names.length;j++) {
      var prop=transform && transform.property(names[j]);
      if (prop) {
        var keys=[];
        if (prop.numKeys > 100) result.truncated=true;
        for (var k=1;k<=Math.min(prop.numKeys,100);k++) keys.push({ time:prop.keyTime(k), value:prop.keyValue(k) });
        summary.transforms[names[j]]={ value:prop.value, keys:keys, expressionEnabled:prop.expressionEnabled, dimensionsSeparated:prop.dimensionsSeparated || false };
      }
    }
    var textProp=layer.property('ADBE Text Properties');
    if (textProp) { var source=textProp.property('ADBE Text Document'); if (source) summary.text=source.value.text; }
    result.activeComp.layers.push(summary);
    if (layer.selected) result.selection.push(ref);
  }
  return result;
};
Bridge.property = function (layer, path) {
  if (!(path instanceof Array) || path.length !== 2 || path[0] !== 'ADBE Transform Group') throw new Error('Unsupported property path');
  if (path[1] !== 'ADBE Position' && path[1] !== 'ADBE Scale' && path[1] !== 'ADBE Opacity' && path[1] !== 'ADBE Rotate Z') throw new Error('Unsupported property');
  if (layer.threeDLayer || layer.parent) throw new Error('Parented or 3D transforms not supported in this slice');
  var property=layer.property(path[0]).property(path[1]);
  if (!property || property.dimensionsSeparated || property.expressionEnabled) throw new Error('Property unavailable, separated, or expression-driven');
  return property;
};
Bridge.executeBatch = function (batch) {
  var outcomes=[], created={}, comp=app.project.activeItem;
  if (!(comp instanceof CompItem)) return Bridge.error('WRONG_PROJECT','Activate a composition before editing');
  app.beginUndoGroup(batch.label);
  try {
    for (var i=0;i<batch.operations.length;i++) {
      var op=batch.operations[i], layer=null;
      try {
        if (op.op === 'layer.create_text' || op.op === 'layer.create_shape') {
          if (Bridge.ref(comp,'comp') !== op.compRef) throw new Error('Wrong active composition');
          if (op.op === 'layer.create_text') {
            layer=comp.layers.addText(op.text);
          } else {
            layer=comp.layers.addShape();
            var root=layer.property('ADBE Root Vectors Group');
            var group=root.addProperty('ADBE Vector Group');
            var children=group.property('ADBE Vectors Group');
            var rect=children.addProperty('ADBE Vector Shape - Rect');
            rect.property('ADBE Vector Rect Size').setValue(op.sizePx);
            rect.property('ADBE Vector Rect Roundness').setValue(op.radiusPx);
            var fill=children.addProperty('ADBE Vector Graphic - Fill');
            fill.property('ADBE Vector Fill Color').setValue(op.fillRgb);
          }
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
        } else throw new Error('Unsupported operation');
      } catch (e) {
        outcomes.push({ id:op.id, state:'failed', error:String(e) });
        return { ok:true, value:{ state:'partial', outcomes:outcomes, warning:'Undo group may contain completed changes; inspect before retrying' } };
      }
    }
    return { ok:true, value:{ state:'succeeded', outcomes:outcomes, created:created } };
  } finally { app.endUndoGroup(); }
};
Bridge.renderFrame = function (p) {
  var comp=Bridge.comp(p.compRef), frame=p.frame, time=frame*comp.frameDuration;
  if (app.project.activeItem !== comp) return Bridge.error('WRONG_PROJECT','Activate the target composition before rendering');
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
    else result=Bridge.error('UNSUPPORTED_CAPABILITY','Unknown host method');
    Bridge.recent[id]=result; Bridge.recentOrder.push(id);
    if (Bridge.recentOrder.length > 50) delete Bridge.recent[Bridge.recentOrder.shift()];
    return Bridge.stringify(result);
  } catch (e) { return Bridge.stringify(Bridge.error('AE_ERROR',e)); }
};
