import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

// Keep the actual editor/window callbacks and shared circuit code. Rendering
// primitives and child artwork are replaced so this tests transitions without a
// browser, a server, or fragile snapshots of the implementation source.
const hooks = `let slots=[],cursor=0,effects=[],dirty=false,deferred=false;
export function deferFunctionalUpdates(){deferred=true;}
export function unmount(){for(const slot of slots){slot?.cleanup?.();if(slot)slot.cleanup=null;}}
export function reset(){unmount();slots=[];cursor=0;effects=[];dirty=false;deferred=false;}
export function begin(){cursor=0;dirty=false;}
export function flush(){for(const run of effects.splice(0))run();return dirty;}
export function useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial,pending:[]};for(const update of slots[i].pending.splice(0))slots[i].value=update(slots[i].value);return [slots[i].value,next=>{if(deferred&&typeof next==='function'){slots[i].pending.push(next);dirty=true;return;}const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];}
export function useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});}
export function useMemo(factory,deps){const i=cursor++;const old=slots[i];if(!old||deps.some((value,index)=>value!==old.deps[index]))slots[i]={deps,value:factory()};return slots[i].value;}
export const useCallback=(callback,deps)=>useMemo(()=>callback,deps);
export const useId=()=>useRef('editor-reference-test').current;
export function useEffect(effect,deps){const i=cursor++;const old=slots[i];if(!old||deps.some((value,index)=>value!==old.deps[index])){slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=effect();});}}
export const useLayoutEffect=useEffect;`;
const bundle = await build({
  stdin: { contents: `export {default as Editor} from './app/simulator/editor/SimulatorEditor';export {default as Picker} from './app/simulator/ReferenceDrawingPicker';export {default as Floating} from './app/simulator/editor/FloatingSchematic';export {default as Video} from './app/simulator/reference-video/ReferenceVideoPlayer';export * from './app/simulator/reference-video/catalog';export * from './app/simulator/core/lessons';export * from './app/simulator/core/validation';export {reset,begin,flush,unmount,deferFunctionalUpdates} from 'react';`, resolveDir: process.cwd() },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' },
  plugins: [{ name: 'reference-editor-primitives', setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: 'hooks', namespace: 'reference-editor-test' }));
    build.onLoad({ filter: /^hooks$/, namespace: 'reference-editor-test' }, () => ({ contents: hooks }));
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'jsx', namespace: 'reference-editor-test' }));
    build.onLoad({ filter: /^jsx$/, namespace: 'reference-editor-test' }, () => ({ contents: 'export const Fragment=Symbol.for("react.fragment");export const jsx=(type,props,key)=>({type,props,key});export const jsxs=jsx;' }));
    build.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'reference-editor-test' }));
    build.onLoad({ filter: /^portal$/, namespace: 'reference-editor-test' }, () => ({ contents: 'export const createPortal=value=>value;export const flushSync=fn=>fn();' }));
    build.onResolve({ filter: /^@xyflow\/react$/ }, () => ({ path: 'flow', namespace: 'reference-editor-test' }));
    build.onLoad({ filter: /^flow$/, namespace: 'reference-editor-test' }, () => ({ contents: 'export const Background=()=>null,Controls=()=>null,ReactFlow=()=>null,ReactFlowProvider=()=>null;export const BackgroundVariant={Dots:"dots"},ConnectionMode={Loose:"loose"},ConnectionLineType={Straight:"straight",Bezier:"bezier",Step:"step"};const flow={setViewport(){},fitView(){},screenToFlowPosition:p=>p};export const useReactFlow=()=>flow;' }));
    build.onResolve({ filter: /^lucide-react$/ }, () => ({ path: 'icons', namespace: 'reference-editor-test' }));
    build.onLoad({ filter: /^icons$/, namespace: 'reference-editor-test' }, () => ({ contents: 'export const ExternalLink=()=>null,AlertTriangle=()=>null,LocateFixed=()=>null,CheckCheck=()=>null,ChevronLeft=()=>null,ChevronRight=()=>null,Copy=()=>null,Download=()=>null,FileImage=()=>null,FolderOpen=()=>null,PanelRightClose=()=>null,Play=()=>null,Redo2=()=>null,Search=()=>null,ShieldCheck=()=>null,Square=()=>null,Undo2=()=>null,X=()=>null,BookOpen=()=>null,GripHorizontal=()=>null,Maximize2=()=>null,Minimize2=()=>null,Minus=()=>null,Plus=()=>null,ZoomIn=()=>null,ZoomOut=()=>null,RotateCcw=()=>null,RotateCw=()=>null,Video=()=>null;' }));
    build.onResolve({ filter: /\/(DeviceArtwork|DeviceNode|WireEdge|PdfDrawing)$/ }, () => ({ path: 'artwork', namespace: 'reference-editor-test' }));
    build.onLoad({ filter: /^artwork$/, namespace: 'reference-editor-test' }, () => ({ contents: 'export default ()=>null;' }));
  } }],
});
const { Editor, Picker, Floating, Video, referenceVideoForDiagram, createLessonDocument, validateDocument, reset, begin, flush, unmount, deferFunctionalUpdates } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const Workspace = Editor({}).props.children.type;
function all(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate));
  return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
}
function mount(Component, initialProps) {
  reset(); let props = initialProps, tree;
  function render() { for (let i = 0; i < 15; i++) { begin(); tree = Component(props); if (!flush()) return; } throw new Error('render did not settle'); }
  render();
  return { render, update: next => { props = { ...props, ...next }; render(); }, tree: () => tree, find: predicate => all(tree, predicate)[0] };
}
function environment() {
  const keys = ['document', 'setTimeout', 'clearTimeout', 'ResizeObserver'];
  const old = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { body: {style:{}} } });
  Object.defineProperty(globalThis, 'setTimeout', { configurable: true, value: () => 1 });
  Object.defineProperty(globalThis, 'clearTimeout', { configurable: true, value: () => {} });
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
  return () => { unmount(); for (const key of keys) { if (old[key]) Object.defineProperty(globalThis, key, old[key]); else delete globalThis[key]; } };
}
function editor(document, extra = {}) {
  const updates = []; let current = document;
  const ui = mount(Workspace, { document, documentKey: 'same-workspace', onDocumentChange: next => { current = next; updates.push(next); }, ...extra });
  function render() { ui.update({ document: current, drawingUrl: current.drawingMediaId ? `/api/media/${current.drawingMediaId}` : undefined, drawingType: current.drawingMediaType }); }
  return { ...ui, render, document: () => current, updates, picker: () => ui.find(node => node.type === Picker), window: () => ui.find(node => node.type === Floating), button: label => ui.find(node => node.type === 'button' && node.props['aria-label'] === label) };
}
const example = () => createLessonDocument('motor-self-hold', { wired: true });

test('reference picker integration preserves graph, clears previous lesson/media, and undo/redo restores exact documents', () => {
  const restore = environment();
  try {
    const original = { ...example(), drawingMediaId: 'private-old', drawingMediaType: 'image/png', trainingProjectId: 'project-02', projectDrawings: { schematic: { mediaId: 'private-old', type: 'image/png' } }, drawingKind: 'schematic' };
    const before = structuredClone(original);
    const ui = editor(original, { drawingUrl: '/api/media/private-old', drawingType: 'image/png' });
    const windowKey = ui.window().props.documentKey;
    ui.picker().props.onSelect(32); ui.render();
    const selected = structuredClone(ui.document());
    assert.equal(selected.referenceDiagramId, 32); assert.equal(validateDocument(selected).valid, true);
    assert.deepEqual(selected.components, before.components); assert.deepEqual(selected.wires, before.wires); assert.equal(selected.title, before.title);
    for (const key of ['lessonId', 'roles', 'drawingMediaId', 'drawingMediaType', 'trainingProjectId', 'projectDrawings', 'drawingKind']) assert.equal(selected[key], undefined, key);
    assert.equal(ui.window().props.video.diagramId, 32);
    assert.equal(ui.window().props.documentKey, windowKey, 'reference replacement does not reset the floating tab or collapse state');
    ui.button('撤销').props.onClick(); ui.render(); assert.deepEqual(ui.document(), before); assert.equal(ui.window().props.video, undefined);
    ui.button('重做').props.onClick(); ui.render(); assert.deepEqual(ui.document(), selected); assert.equal(ui.window().props.video.diagramId, 32);
    assert.deepEqual(original, before, 'history does not mutate the document being replaced');
  } finally { restore(); }
});

test('confirming the same reference resets external browsing context without adding a graph history entry', () => {
  const restore = environment();
  try {
    const { lessonId, roles, ...graph } = example(); const snapshots = [];
    const ui = editor({ ...graph, referenceDiagramId: 32 }, { renderSchematic: (preview, revision) => { snapshots.push({ preview, revision }); return preview; } });
    const initial = snapshots.at(-1).revision;
    ui.picker().props.onSelect(32); ui.render();
    assert.equal(ui.updates.length, 0); assert.equal(snapshots.at(-1).revision, initial + 1);
    assert.equal(ui.button('撤销').props.disabled, true);
    assert.equal(ui.window().props.video.diagramId, 32);
  } finally { restore(); }
});

test('personal image upload clears the public reference and does not alter the electrical topology', async () => {
  const restore = environment();
  try {
    const { lessonId, roles, ...graph } = example(); const original = { ...graph, referenceDiagramId: 32 };
    const ui = editor(original, { onImportDrawing: async () => ({ id: 'uploaded-own', url: '/api/media/uploaded-own' }) });
    const input = ui.find(node => node.type === 'input' && node.props.accept === 'image/png,image/jpeg,image/webp');
    await input.props.onChange({ target: { files: [{ size: 40, type: 'image/png' }], value: 'drawing.png' } }); ui.render();
    assert.equal(ui.document().referenceDiagramId, undefined); assert.equal(ui.document().drawingMediaId, 'uploaded-own');
    assert.equal(ui.document().drawingMediaType, 'image/png'); assert.equal(validateDocument(ui.document()).valid, true);
    assert.deepEqual(ui.document().components, original.components); assert.deepEqual(ui.document().wires, original.wires);
    assert.equal(ui.window().props.video, undefined, 'a private image cannot inherit the old public reference video');
  } finally { restore(); }
});

test('read-only editor refuses a stale picker confirmation callback', () => {
  const restore = environment();
  try {
    const ui = editor(example(), { readOnly: true });
    assert.equal(ui.picker().props.disabled, true); ui.picker().props.onSelect(32); ui.render();
    assert.equal(ui.updates.length, 0); assert.equal(ui.document().lessonId, 'motor-self-hold');
  } finally { restore(); }
});

test('slow uploads cannot replace a later reference confirmation, including a same-ID confirmation', async () => {
  const restore = environment();
  try {
    for (const chosenId of [31, 32]) {
      const { lessonId, roles, ...graph } = example(); const original = { ...graph, referenceDiagramId: 32 };
      let resolveUpload;
      const uploaded = new Promise(resolve => { resolveUpload = resolve; });
      const ui = editor(original, { onImportDrawing: () => uploaded });
      const input = ui.find(node => node.type === 'input' && node.props.accept === 'image/png,image/jpeg,image/webp');
      const pending = input.props.onChange({ target: { files: [{ size: 40, type: 'image/png' }], value: 'slow.png' } }); ui.render();
      ui.picker().props.onSelect(chosenId); ui.render();
      const selected = structuredClone(ui.document());
      resolveUpload({ id: 'old-upload-result', url: '/api/media/old-upload-result' }); await pending; ui.render();
      assert.deepEqual(ui.document(), selected); assert.equal(ui.document().referenceDiagramId, chosenId);
      assert.equal(ui.document().drawingMediaId, undefined); assert.equal(ui.window().props.video.diagramId, chosenId);
      assert.ok(ui.find(node => node.props?.role === 'status'), 'the user is told the old upload was not applied');
    }
  } finally { restore(); }
});

test('slow JSON imports cannot overwrite later edits, a running session, a replaced workspace or read-only state', async () => {
  const restore = environment();
  try {
    for (const transition of ['edit', 'run', 'replace', 'read-only', 'unmount']) {
      const original = example(), incoming = createLessonDocument('motor-jog', { wired: true });
      const ui = editor(original);
      let resolveText;
      const text = new Promise(resolve => { resolveText = resolve; });
      const input = ui.find(node => node.type === 'input' && node.props.accept === 'application/json,.json');
      const pending = input.props.onChange({ target: { files: [{ size: 200, text: () => text }], value: 'slow.json' } });
      if (transition === 'edit') { ui.picker().props.onSelect(32); ui.render(); }
      else if (transition === 'run') { ui.find(node => node.type === 'button' && node.props.children?.some?.(child => child === '开始仿真')).props.onClick(); ui.render(); }
      else if (transition === 'replace') ui.update({ documentKey: 'another-workspace', document: incoming });
      else if (transition === 'read-only') ui.update({ readOnly: true });
      else unmount();
      const count = ui.updates.length;
      resolveText(JSON.stringify(incoming)); await pending;
      assert.equal(ui.updates.length, count, `${transition}: stale file read must not change the document`);
    }
  } finally { restore(); }
});

test('the latest JSON file selection wins while a normal import remains undoable', async () => {
  const restore = environment();
  try {
    const original = example(), incoming = createLessonDocument('motor-jog', { wired: true });
    const ui = editor(original);
    const input = ui.find(node => node.type === 'input' && node.props.accept === 'application/json,.json');
    let resolveOld, resolveNew;
    const oldText = new Promise(resolve => { resolveOld = resolve; });
    const newText = new Promise(resolve => { resolveNew = resolve; });
    const read = text => input.props.onChange({ target: { files: [{ size: 200, text: () => text }], value: 'circuit.json' } });
    const oldRead = read(oldText), newRead = read(newText);
    resolveOld(JSON.stringify({ ...original, title: 'Superseded selection' })); await oldRead;
    assert.equal(ui.updates.length, 0, 'an earlier selection cannot win even when it finishes first');
    resolveNew(JSON.stringify(incoming)); await newRead; ui.render();
    assert.deepEqual(ui.document(), incoming);
    ui.button('撤销').props.onClick(); ui.render(); assert.deepEqual(ui.document(), original);
    ui.button('重做').props.onClick(); ui.render(); assert.deepEqual(ui.document(), incoming);
  } finally { restore(); }
});

test('floating reference changes retain video tab, drawing zoom, position and collapse state, with exact new video metadata', () => {
  const restore = environment();
  try {
    let requests = 0;
    const ui = mount(Floating, { panelRef: { current: null }, boardRef: { current: null }, documentKey: 'workspace', children: 'diagram32', video: referenceVideoForDiagram(32), onChooseDrawing: () => requests++ });
    const button = label => ui.find(node => node.type === 'button' && node.props['aria-label'] === label);
    button('放大图纸').props.onClick(); ui.render();
    const windowWidth = ui.tree().props.style.width;
    ui.find(node => node.type === 'button' && node.props.children === '教学视频').props.onClick(); ui.render();
    assert.equal(button('放大图纸').props.disabled, true);
    button('放大图纸').props.onClick(); ui.render();
    assert.equal(ui.tree().props.style.width, windowWidth);
    button('拖动图纸窗口').props.onKeyDown({ key: 'ArrowLeft', preventDefault() {}, stopPropagation() {} }); ui.render();
    const transform = ui.tree().props.style.transform;
    button('选择图纸').props.onClick(); assert.equal(requests, 1);
    ui.update({ children: 'diagram31', video: referenceVideoForDiagram(31) });
    assert.equal(ui.find(node => node.type === Video).props.video.diagramId, 31);
    assert.equal(ui.tree().props.style.transform, transform); assert.equal(ui.tree().props['data-window-scale'], '1.0'); assert.equal(ui.tree().props['data-drawing-zoom'], 1.25);
    button('收起图纸').props.onClick(); ui.render();
    ui.update({ children: 'diagram15', video: referenceVideoForDiagram(15) });
    assert.ok(button('展开图纸')); assert.equal(ui.find(node => node.type === Video), undefined);
    button('展开图纸').props.onClick(); ui.render();
    assert.equal(ui.find(node => node.type === Video).props.video.diagramId, 15); assert.equal(ui.find(node => node.type === Video).props.video.url, null);
    assert.equal(ui.tree().props.style.transform, transform);
  } finally { restore(); }
});

test('duct resizing commits one undo entry per gesture, supports redo and cancel, and refuses frozen edits', () => {
  const restore = environment();
  try {
    const original = { ...example(), components: [...example().components, {id:'duct', type:'wire-duct', label:'WD1', position:{x:70,y:90}}] };
    const ui = editor(original);
    const duct = () => ui.find(node => Array.isArray(node.props?.nodes)).props.nodes.find(node => node.id === 'duct').data;
    duct().beginResize('duct');
    for (const width of [320, 400, 480]) { duct().resize('duct', {x:70,y:90,width,height:64}); ui.render(); }
    assert.equal(ui.button('撤销').props.disabled, true, 'unfinished gesture does not fill history');
    duct().resize('duct', {x:55,y:75,width:480,height:84}, true); ui.render();
    const resized = structuredClone(ui.document());
    assert.equal(validateDocument(resized).valid, true);
    deferFunctionalUpdates(); // React may evaluate history updaters after the parent has changed the current document.
    ui.button('撤销').props.onClick(); ui.render(); assert.deepEqual(ui.document(), original);
    assert.equal(ui.button('撤销').props.disabled, true, 'all drag updates undo together');
    ui.button('重做').props.onClick(); ui.render(); assert.deepEqual(ui.document(), resized);
    duct().beginResize('duct'); duct().resize('duct', {x:1,y:2,width:900,height:130}); ui.render();
    duct().cancelResize(); ui.render(); assert.deepEqual(ui.document(), resized);
    ui.update({readOnly:true}); const count=ui.updates.length;
    duct().beginResize('duct'); duct().resize('duct', {x:0,y:0,width:100,height:100}, true);
    assert.equal(ui.updates.length,count);
    ui.update({readOnly:false}); ui.find(node => node.type === 'button' && node.props.children?.some?.(child => child === '开始仿真')).props.onClick(); ui.render();
    duct().beginResize('duct'); duct().resize('duct', {x:0,y:0,width:100,height:100}, true);
    assert.deepEqual(ui.document(),resized,'running state preserves geometry');
  } finally { restore(); }
});

test('prearranging a legacy board and routing all wires is one undoable operation and respects frozen workspaces', () => {
  const restore = environment();
  try {
    const original = example(); original.components = original.components.filter(component => !component.type.startsWith('wire-duct'));
    original.wires = original.wires.map(wire => ({ ...wire, style: 'orthogonal' }));
    const ui = editor(original);
    ui.button('预布线槽').props.onClick(); ui.render();
    const arranged = structuredClone(ui.document());
    assert.ok(arranged.components.some(component => component.type === 'wire-duct'));
    assert.ok(arranged.wires.every(wire => wire.style === 'duct'));
    assert.equal(validateDocument(arranged).valid, true);
    assert.deepEqual(arranged.wires.map(({style, ...wire}) => wire), original.wires.map(({style, ...wire}) => wire));
    ui.button('撤销').props.onClick(); ui.render(); assert.deepEqual(ui.document(), original);
    ui.button('重做').props.onClick(); ui.render(); assert.deepEqual(ui.document(), arranged);
    ui.update({readOnly:true}); const count = ui.updates.length;
    ui.button('导线全部入槽').props.onClick(); assert.equal(ui.updates.length, count);
    ui.update({readOnly:false}); ui.find(node => node.type === 'button' && node.props.children?.some?.(child => child === '开始仿真')).props.onClick(); ui.render();
    ui.button('导线全部入槽').props.onClick(); assert.equal(ui.updates.length, count);
  } finally { restore(); }
});

test('a live short warns once, confirming preserves the fault, and a fresh session warns again', () => {
  const restore=environment();
  try {
    const document=example(); document.wires.push({id:'short',from:{componentId:'source',terminalId:'L1'},to:{componentId:'source',terminalId:'L2'},color:'#000000'});
    const ui=editor(document);
    const toggle=() => ui.find(node => node.type === 'button' && node.props.children?.some?.(child => child === '开始仿真' || child === '结束仿真'));
    const alert=() => ui.find(node => node.type?.name === 'ShortCircuitAlert');
    toggle().props.onClick(); ui.render(); assert.ok(alert());
    alert().props.onClose(); ui.render(); assert.equal(alert(),undefined);
    const data=()=>ui.find(node => Array.isArray(node.props?.nodes)).props.nodes[0].data;
    assert.equal(data().runtime.faultLatched,true); assert.equal(data().runtime.powerOn,false);
    data().action({type:'power',enabled:true}); ui.render(); assert.equal(alert(),undefined);
    assert.equal(data().runtime.faultLatched,true); assert.equal(data().runtime.powerOn,false);
    toggle().props.onClick(); ui.render(); toggle().props.onClick(); ui.render(); assert.ok(alert());
    assert.deepEqual(ui.document(),document,'a warning never edits the electrical document');
  } finally { restore(); }
});
