import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInContext, createContext } from 'node:vm';
// AE's ExtendScript engine has no native JSON, so load host.jsx without it to exercise the fallback parser.
const host = createContext({ JSON:undefined });
runInContext(readFileSync(new URL('../apps/ae-panel/host.jsx', import.meta.url), 'utf8'), host);
const parse = text => runInContext(`Bridge.parse(${JSON.stringify(text)})`, host);
test('fallback parser accepts numbers, booleans and null', () => {
  const value = parse('{"frame":12,"fillRgb":[0.18,-1,2e3],"on":true,"off":false,"none":null,"s":"a\\"b"}');
  assert.equal(value.frame, 12);
  assert.equal(value.fillRgb[2], 2000);
  assert.equal(value.on, true);
  assert.equal(value.s, 'a"b');
});
test('text style sets fill, size, justification and centres the anchor on the restyled box', () => {
  host.ParagraphJustification = { LEFT_JUSTIFY:7413, CENTER_JUSTIFY:7415, RIGHT_JUSTIFY:7414 };
  const source = { numKeys:0, expressionEnabled:false, value:{ text:'Hello', fontSize:50, justification:7413, applyFill:false }, setValue(v) { this.value = v; } };
  const anchor = { numKeys:0, expressionEnabled:false, value:[0,0,0], setValue(v) { this.value = v; } };
  const layer = { threeDLayer:false, inPoint:0, outPoint:10,
    property: name => name === 'ADBE Text Properties' ? { property:() => source } : { property:() => anchor },
    sourceRectAtTime: () => source.value.fontSize === 120 ? { left:-150, top:-90, width:300, height:110 } : { left:0, top:0, width:1, height:1 } };
  host.args = [layer, { id:'s', op:'text.set_style', target:'layer_1', fillRgb:[1,1,1], fontSize:120, justification:'center', anchor:'center' }, { time:0, frameDuration:1/30 }];
  runInContext('Bridge.setTextStyle(args[0], args[1], args[2])', host);
  assert.deepEqual({ ...source.value, fillColor:[...source.value.fillColor] }, { text:'Hello', fontSize:120, justification:7415, applyFill:true, fillColor:[1,1,1] });
  assert.deepEqual([...anchor.value], [0, -35]);
  host.doc = source.value;
  assert.deepEqual(JSON.parse(JSON.stringify(runInContext('Bridge.textStyle(doc)', host))), { fontSize:120, justification:'center', fillRgb:[1,1,1] });
  source.numKeys = 1;
  assert.throws(() => runInContext('Bridge.setTextStyle(args[0], args[1], args[2])', host), /keyframed/);
});
// Stand-in for an AE keyframed property: keys hold interpolation types and temporal ease arrays.
function keyedProperty(propertyValueType, frames, dims) {
  const ease = () => Array.from({ length:dims }, () => ({ speed:5, influence:16.666 }));
  const keys = frames.map(f => ({ time:f / 30, value:f, in:6612, out:6612, inEase:ease(), outEase:ease() }));
  return { keys, propertyValueType, get numKeys() { return keys.length; },
    keyTime:k => keys[k-1].time, keyValue:k => keys[k-1].value,
    keyInInterpolationType:k => keys[k-1].in, keyOutInterpolationType:k => keys[k-1].out,
    keyInTemporalEase:k => keys[k-1].inEase, keyOutTemporalEase:k => keys[k-1].outEase,
    setInterpolationTypeAtKey(k, a, b) { keys[k-1].in = a; keys[k-1].out = b; },
    setTemporalEaseAtKey(k, a, b) { keys[k-1].inEase = a; keys[k-1].outEase = b; } };
}
const plain = x => JSON.parse(JSON.stringify(x));
test('keyframe easing sets bezier ease per dimension, only on the requested side and keys', () => {
  host.KeyframeInterpolationType = { LINEAR:6612, BEZIER:6613, HOLD:6614 };
  host.PropertyValueType = { ThreeD_SPATIAL:6412, ThreeD:6413, TwoD_SPATIAL:6414, TwoD:6415, OneD:6417 };
  runInContext('function KeyframeEase(speed, influence) { this.speed = speed; this.influence = influence; }', host);
  const comp = { frameDuration:1/30 };
  const scale = keyedProperty(6413, [0, 15], 3);
  host.args = [scale, { op:'keyframe.ease', ease:'ease_in_out' }, comp];
  runInContext('Bridge.easeKeys(args[0], args[1], args[2])', host);
  for (const key of scale.keys) {
    assert.deepEqual([key.in, key.out], [6613, 6613]);
    assert.deepEqual(plain(key.inEase), [{ speed:0, influence:33.333 }, { speed:0, influence:33.333 }, { speed:0, influence:33.333 }]);
    assert.deepEqual(plain(key.outEase), plain(key.inEase));
  }
  const position = keyedProperty(6414, [6, 21], 1);
  host.args = [position, { op:'keyframe.ease', ease:'ease_out', frames:[6], influence:70 }, comp];
  runInContext('Bridge.easeKeys(args[0], args[1], args[2])', host);
  assert.deepEqual([position.keys[0].in, position.keys[0].out], [6612, 6613]);
  assert.deepEqual(plain(position.keys[0].outEase), [{ speed:0, influence:70 }]);
  assert.deepEqual(plain(position.keys[0].inEase), [{ speed:5, influence:16.666 }]);
  assert.deepEqual([position.keys[1].in, position.keys[1].out], [6612, 6612]);
  host.args = [position, { op:'keyframe.ease', ease:'linear' }, comp];
  runInContext('Bridge.easeKeys(args[0], args[1], args[2])', host);
  assert.deepEqual(position.keys.map(k => [k.in, k.out]), [[6612, 6612], [6612, 6612]]);
  host.args = [position, { op:'keyframe.ease', ease:'ease_in', frames:[7] }, comp];
  assert.throws(() => runInContext('Bridge.easeKeys(args[0], args[1], args[2])', host), /No keyframe at frame 7/);
  host.args = [scale];
  assert.deepEqual(plain(runInContext('Bridge.keySummary(args[0], 1)', host)), { time:0, value:0, interpolation:['bezier','bezier'], influence:[33.333, 33.333] });
});
test('timing trims in the right order and bounds map to comp space', () => {
  const comp = { frameDuration:1/24, duration:9, time:0 };
  const layer = { inPoint:0, outPoint:9 };
  host.args = [layer, { inFrame:200, outFrame:210 }, comp];
  runInContext('Bridge.setTiming(args[0], args[1], args[2])', host);
  assert.deepEqual([layer.inPoint * 24, layer.outPoint * 24].map(Math.round), [200, 210]);
  host.args = [layer, { inFrame:28, outFrame:39 }, comp];
  runInContext('Bridge.setTiming(args[0], args[1], args[2])', host);
  assert.deepEqual([layer.inPoint * 24, layer.outPoint * 24].map(Math.round), [28, 39]);
  host.args = [layer, { inFrame:0, outFrame:300 }, comp];
  assert.throws(() => runInContext('Bridge.setTiming(args[0], args[1], args[2])', host), /past the end/);
  const values = { 'ADBE Rotate Z':0, 'ADBE Anchor Point':[10, 0, 0], 'ADBE Position':[960, 564, 0], 'ADBE Scale':[50, 100, 100] };
  const textLayer = { inPoint:28/24, outPoint:39/24, parent:null, threeDLayer:false,
    sourceRectAtTime: () => ({ left:-100, top:-80, width:200, height:100 }),
    property: () => ({ property: name => ({ valueAtTime: () => values[name] }) }) };
  const summary = {};
  host.args = [summary, textLayer, comp];
  runInContext('Bridge.addBounds(args[0], args[1], args[2])', host);
  assert.equal(Math.round(summary.bounds.time * 24), 28);
  assert.deepEqual(plain(summary.compBounds), { left:905, top:484, width:100, height:100 });
});
test('text style sets font, leading and tracking, and refuses a missing font', () => {
  const source = { numKeys:0, expressionEnabled:false, value:{ text:'Hi', font:'ArialMT', autoLeading:true, leading:0, tracking:0, spaceBefore:12, spaceAfter:12 }, setValue(v) { this.value = v; } };
  const layer = { property: () => ({ property: () => source }) };
  host.app = { fonts:{ getFontsByPostScriptName: name => name === 'HelveticaNeue' ? [{}] : [] } };
  host.args = [layer, { font:'HelveticaNeue', leading:140, tracking:-10 }, {}];
  runInContext('Bridge.setTextStyle(args[0], args[1], args[2])', host);
  assert.deepEqual(plain(source.value), { text:'Hi', font:'HelveticaNeue', autoLeading:false, leading:140, tracking:-10, spaceBefore:0, spaceAfter:0 });
  host.args = [layer, { font:'NotAFont' }, {}];
  assert.throws(() => runInContext('Bridge.setTextStyle(args[0], args[1], args[2])', host), /Font not installed: NotAFont/);
  delete host.app;
});
// Stand-in for an AE property group that records added children by matchName.
function group(name) {
  const g = { name, children:[], value:undefined, setValue(v) { this.value = v; },
    addProperty(match) { const c = group(match); g.children.push(c); return c; },
    property(match) { let c = g.children.find(x => x.name === match); if (!c) { c = group(match); g.children.push(c); } return c; } };
  return g;
}
test('paths get one group per path, paint per group, and an optional trim', () => {
  runInContext('function Shape() {}', host);
  const root = group('ADBE Root Vectors Group');
  host.comp = { layers:{ addShape: () => ({ property: () => root }) } };
  host.op = { paths:[{ vertices:[[0,0],[10,0]], closed:false }, { vertices:[[0,0],[0,10]], outTangents:[[1,1],[2,2]], closed:true }], strokeRgb:[1,0.9,0], strokeWidthPx:6, lineCap:'round', trim:'individual' };
  runInContext('Bridge.createPath(comp, op)', host);
  assert.deepEqual(root.children.map(c => c.name), ['ADBE Vector Group', 'ADBE Vector Group', 'ADBE Vector Filter - Trim']);
  const second = root.children[1].property('ADBE Vectors Group');
  assert.deepEqual(second.children.map(c => c.name), ['ADBE Vector Shape - Group', 'ADBE Vector Graphic - Stroke']);
  const shape = second.children[0].property('ADBE Vector Shape').value;
  assert.deepEqual(plain({ v:shape.vertices, i:shape.inTangents, o:shape.outTangents, c:shape.closed }), { v:[[0,0],[0,10]], i:[[0,0],[0,0]], o:[[1,1],[2,2]], c:true });
  const stroke = second.children[1];
  assert.deepEqual([stroke.property('ADBE Vector Stroke Width').value, stroke.property('ADBE Vector Stroke Line Cap').value], [6, 2]);
  assert.equal(root.children[2].property('ADBE Vector Trim Type').value, 2);
  const shapeRoot = group('ADBE Root Vectors Group');
  host.comp = { layers:{ addShape: () => ({ property: () => shapeRoot }) } };
  host.op = { shape:'ellipse', sizePx:[40,40], fillRgb:[1,1,1], strokeRgb:[0,0,0] };
  runInContext('Bridge.createShape(comp, op)', host);
  assert.deepEqual(shapeRoot.children[0].property('ADBE Vectors Group').children.map(c => c.name), ['ADBE Vector Shape - Ellipse', 'ADBE Vector Graphic - Stroke', 'ADBE Vector Graphic - Fill']);
});
test('parenting refuses cycles and property paths walk to trim paths', () => {
  const a = { id:1, parent:null }, b = { id:2, parent:a, setParentWithJump(p) { this.parent = p; } };
  host.args = [a, b];
  a.setParentWithJump = function (p) { this.parent = p; };
  assert.throws(() => runInContext('Bridge.setParent(args[0], args[1])', host), /cycle/);
  host.args = [b, null];
  runInContext('Bridge.setParent(args[0], args[1])', host);
  assert.equal(b.parent, null);
  const trimEnd = { dimensionsSeparated:false, expressionEnabled:false };
  const layer = { threeDLayer:false, property: n => n === 'ADBE Root Vectors Group' ? { property: () => ({ property: () => trimEnd }) } : null };
  // Build path arrays inside the host context: Bridge.property checks instanceof Array, which is per realm.
  const trimPath = "['ADBE Root Vectors Group','ADBE Vector Filter - Trim','ADBE Vector Trim End']";
  host.args = [layer];
  assert.equal(runInContext(`Bridge.property(args[0], ${trimPath})`, host), trimEnd);
  host.args = [{ threeDLayer:false, property: () => null }];
  assert.throws(() => runInContext(`Bridge.property(args[0], ${trimPath})`, host), /layer.create_path trim/);
  assert.throws(() => runInContext("Bridge.property(args[0], ['ADBE Effect Parade','ADBE Slider Control'])", host), /Unsupported property path/);
});
test('replace_image reloads footage already imported from the path, else imports it, and swaps the layer source', () => {
  runInContext('function FootageItem() {} function ImportOptions(file) { this.file = file; } function File(path) { this.fsName = path; this.exists = !/missing/.test(path); }', host);
  const footage = (id, path) => Object.assign(runInContext('new FootageItem()', host), { id, file:{ fsName:path }, reloads:0, mainSource:{ reload() { footage.log.push('reload ' + id); } } });
  footage.log = [];
  const old = footage(1, '/a/ui.png'), items = [old, footage(2, '/a/ui-v2.png')];
  host.app = { project:{ get numItems() { return items.length; }, item:i => items[i-1],
    importFile(o) { const x = footage(items.length + 1, o.file.fsName); items.push(x); footage.log.push('import ' + x.id); return x; } } };
  const layer = { source:old, replaceSource(item, fix) { footage.log.push('replace ' + item.id + ' ' + fix); this.source = item; } };
  host.args = [layer, { path:'/a/ui.png' }];
  runInContext('Bridge.replaceImage(args[0], args[1])', host);
  assert.deepEqual(footage.log, ['reload 1']);
  host.args = [layer, { path:'/a/ui-v2.png' }];
  runInContext('Bridge.replaceImage(args[0], args[1])', host);
  assert.deepEqual(footage.log, ['reload 1', 'reload 2', 'replace 2 false']);
  host.args = [layer, { path:'/a/new.png' }];
  runInContext('Bridge.replaceImage(args[0], args[1])', host);
  assert.deepEqual(footage.log.slice(3), ['import 3', 'replace 3 false']);
  host.args = [layer, { path:'/a/missing.png' }];
  assert.throws(() => runInContext('Bridge.replaceImage(args[0], args[1])', host), /Image file not found/);
  host.args = [{ source:null, replaceSource() {} }, { path:'/a/ui.png' }];
  assert.throws(() => runInContext('Bridge.replaceImage(args[0], args[1])', host), /not a footage layer/);
  delete host.app;
});
test('frame render opens the target comp in the viewer instead of refusing', () => {
  runInContext('function CompItem() {}', host);
  const project = { activeItem:null, items:[] };
  const comp = Object.assign(runInContext('new CompItem()', host), { id:7, frameDuration:1/30, duration:2, time:0, width:320, height:180,
    openInViewer() { project.activeItem = this; }, saveFrameToPng(t, file) { this.saved = [t, file.fsName]; } });
  const other = Object.assign(runInContext('new CompItem()', host), { id:8 });
  project.items = [other, comp]; project.activeItem = other;
  host.app = { project:{ get activeItem() { return project.activeItem; }, get numItems() { return project.items.length; }, item:i => project.items[i-1] } };
  const result = plain(runInContext('Bridge.renderFrame({ compRef:"comp_7", frame:15, outputPath:"/tmp/f.png" })', host));
  assert.equal(project.activeItem, comp);
  assert.deepEqual([result.ok, result.value.effectiveFrame, comp.saved], [true, 15, [0.5, '/tmp/f.png']]);
  project.activeItem = other;
  assert.deepEqual(plain(runInContext('Bridge.openComp({ compRef:"comp_7" })', host)), { ok:true, value:{ ref:'comp_7', active:true } });
  delete host.app;
});
test('project save works in place, needs a path when unsaved, and never replaces another file', () => {
  const files = { '/p/Promo.aep':true, '/p/Other.aep':true };
  runInContext('function File(path) { this.fsName = path; this.exists = !!existing[path]; this.parent = { exists: path.indexOf("/missing/") < 0, fsName: path.replace(/\\/[^\\/]*$/, "") }; }', host);
  host.existing = files;
  const saves = [];
  host.app = { project:{ file:null, save(f) { saves.push(f ? f.fsName : 'in place'); if (f) this.file = f; } } };
  assert.throws(() => runInContext('Bridge.saveProject({})', host), /never been saved/);
  assert.throws(() => runInContext('Bridge.saveProject({ path:"/p/Other.aep" })', host), /different file already exists/);
  assert.throws(() => runInContext('Bridge.saveProject({ path:"/missing/New.aep" })', host), /Folder does not exist/);
  assert.equal(runInContext('Bridge.saveProject({ path:"/p/New.aep" })', host), '/p/New.aep');
  assert.equal(runInContext('Bridge.saveProject({})', host), '/p/New.aep');
  host.app.project.file = runInContext('new File("/p/Promo.aep")', host);
  assert.equal(runInContext('Bridge.saveProject({ path:"/p/Promo.aep" })', host), '/p/Promo.aep');
  assert.deepEqual(saves, ['/p/New.aep', 'in place', '/p/Promo.aep']);
  delete host.app;
});
test('fallback parser rejects non-JSON before evaluation', () => {
  for (const text of ['{"a":1}x', '{"a":alert(1)}', '(function(){})()']) assert.throws(() => parse(text), /Invalid JSON payload/);
});
