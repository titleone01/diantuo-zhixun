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
export function useEffect(effect,deps){const i=cursor++;const old=slots[i];if(!old||!deps||!old.deps||deps.some((value,index)=>value!==old.deps[index])){slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=effect();});}}
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
    build.onLoad({ filter: /^flow$/, namespace: 'reference-editor-test' }, () => ({ contents: 'export const Background=()=>null,ControlButton=()=>null,Controls=()=>null,ReactFlow=()=>null,ReactFlowProvider=()=>null;export const BackgroundVariant={Dots:"dots"},ConnectionMode={Loose:"loose"},ConnectionLineType={Straight:"straight",Bezier:"bezier",Step:"step"};const flow={setViewport(){},fitView(){},screenToFlowPosition:p=>p};export const useReactFlow=()=>flow;' }));
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

test('copied objects cannot be pasted in read-only or running editors and are cleared by account changes', () => {
  const restore = environment();
  try {
    const original = example();
    const ui = editor(original, { clipboardScope: 'account-a:session-1' });
    ui.find(node => typeof node.props?.onNodesChange === 'function').props.onNodesChange([{ type: 'select', id: original.components[0].id, selected: true }]);
    ui.render(); ui.button('复制选中对象').props.onClick(); ui.render();
    assert.equal(ui.button('粘贴对象').props.disabled, false);
    ui.update({ readOnly: true });
    assert.equal(ui.button('粘贴对象').props.disabled, true);
    ui.button('粘贴对象').props.onClick(); assert.equal(ui.updates.length, 0);
    ui.update({ readOnly: false });
    ui.find(node => node.type === 'button' && node.props.children?.some?.(child => child === '开始仿真')).props.onClick(); ui.render();
    assert.equal(ui.button('粘贴对象').props.disabled, true);
    ui.button('粘贴对象').props.onClick(); assert.equal(ui.updates.length, 0);
    ui.update({ clipboardScope: 'account-b:session-2' });
    assert.equal(ui.button('粘贴对象').props.disabled, true);
    assert.deepEqual(ui.document(), original);
  } finally { restore(); }
});

test('opening historical reference and private drawings preserves their graph without a legacy picker', () => {
  const restore = environment();
  try {
    for (const extra of [{referenceDiagramId:32},{drawingMediaId:'private-old',drawingMediaType:'image/png'}]) {
      const original = {...example(),...extra}, before = structuredClone(original);
      let choices = 0;
      const ui = editor(original,{onChooseCourse:()=>choices++});
      assert.equal(ui.picker(),undefined);
      ui.window().props.onChooseDrawing();
      assert.equal(choices,1); assert.deepEqual(ui.document(),before); assert.equal(ui.updates.length,0);
      assert.equal(validateDocument(ui.document()).valid,true);
      if(extra.referenceDiagramId)assert.equal(ui.window().props.video.diagramId,32);
    }
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

test('read-only editors cannot invoke course selection', () => {
  const restore = environment();
  try {
    let choices=0;
    const ui = editor(example(),{readOnly:true,onChooseCourse:()=>choices++});
    assert.equal(ui.window().props.selectionDisabled,true);
    ui.window().props.onChooseDrawing();
    assert.equal(choices,0); assert.equal(ui.updates.length,0);
  } finally { restore(); }
});

test('a slow personal image upload cannot replace a later edit', async () => {
  const restore = environment();
  try {
    const original={...example(),referenceDiagramId:32};
    let resolveUpload;
    const uploaded=new Promise(resolve=>{resolveUpload=resolve;});
    const ui=editor(original,{onImportDrawing:()=>uploaded});
    const input=ui.find(node=>node.type==='input'&&node.props.accept==='image/png,image/jpeg,image/webp');
    const pending=input.props.onChange({target:{files:[{size:40,type:'image/png'}],value:'slow.png'}});ui.render();
    ui.find(node=>typeof node.props?.onNodesChange==='function').props.onNodesChange([{type:'position',id:original.components[0].id,position:{x:0,y:0}}]);ui.render();
    const edited=structuredClone(ui.document());
    resolveUpload({id:'late-upload',url:'/api/media/late-upload'});await pending;ui.render();
    assert.deepEqual(ui.document(),edited);assert.equal(ui.document().drawingMediaId,undefined);
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
      if (transition === 'edit') { ui.find(node => typeof node.props?.onNodesChange === 'function').props.onNodesChange([{type:'position',id:original.components[0].id,position:{x:0,y:0}}]); ui.render(); }
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

test('floating resize cancellation restores responsive or manual sizing intent, including exactly 560', () => {
  const restore = environment();
  try {
    const panel = { offsetWidth: 479, offsetHeight: 600 };
    const ui = mount(Floating, { panelRef: { current: panel }, boardRef: { current: { clientWidth: 1006, clientHeight: 900 } }, children: 'drawing' });
    const handle = () => ui.find(node => node.props?.['data-resize-edge'] === 'w');
    const button = label => ui.find(node => node.type === 'button' && node.props['aria-label'] === label);
    const responsive = ui.tree().props.style.width;
    let captured = false;
    const target = { dataset: { resizeEdge: 'w' }, setPointerCapture() { captured = true; }, hasPointerCapture() { return captured; }, releasePointerCapture() { captured = false; } };
    const event = x => ({ pointerId: 1, button: 0, clientX: x, clientY: 200, currentTarget: target, preventDefault() {}, stopPropagation() {} });
    handle().props.onPointerDown(event(100)); handle().props.onPointerMove(event(19)); ui.render();
    assert.equal(ui.tree().props.style.width, 560);
    handle().props.onPointerCancel(event(19)); ui.render();
    assert.equal(ui.tree().props.style.width, responsive, 'cancelled first resize retains responsive sizing');
    handle().props.onPointerDown(event(100)); handle().props.onPointerMove(event(19)); ui.render();
    handle().props.onPointerUp(event(19)); ui.render(); panel.offsetWidth = 560;
    assert.equal(ui.tree().props.style.width, 560, 'committed 560 is a manual size');
    handle().props.onPointerDown(event(100)); handle().props.onPointerMove(event(40)); ui.render();
    assert.equal(ui.tree().props.style.width, 620);
    handle().props.onPointerCancel(event(40)); ui.render();
    assert.equal(ui.tree().props.style.width, 560, 'cancelled later resize retains the previous manual size');
    button('复位图纸窗口').props.onClick(); ui.render();
    assert.equal(ui.tree().props.style.width, responsive, 'explicit reset restores responsive sizing');
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

test('prelayout and all-wires routing preserve the graph, existing duct positions and manual bends with one undo', () => {
  const restore = environment();
  try {
    const base = example();
    const original = JSON.parse(JSON.stringify({ ...base, components: base.components.filter(component => !component.type.startsWith('wire-duct')), wires: base.wires.map(wire => ({ ...wire, style: 'orthogonal', routing: undefined, waypoints: [{ x: 420, y: 80 }] })) }));
    const before = structuredClone(original), ui = editor(original);
    ui.button('预布线槽').props.onClick(); ui.render();
    const arranged = structuredClone(ui.document());
    assert.equal(arranged.components.filter(component => component.type.startsWith('wire-duct')).length, 6);
    assert.deepEqual(arranged.wires.map(({ style, routing, ...wire }) => wire), before.wires.map(({ style, routing, ...wire }) => wire));
    assert.ok(arranged.wires.every(wire => wire.style === 'orthogonal' && wire.routing === 'duct'));
    assert.equal(validateDocument(arranged).valid, true);
    ui.button('撤销').props.onClick(); ui.render(); assert.deepEqual(ui.document(), before);
    assert.equal(ui.button('撤销').props.disabled, true, 'prelayout and conversion are one operation');
    ui.button('重做').props.onClick(); ui.render(); assert.deepEqual(ui.document(), arranged);
    const custom = { ...arranged, components: arranged.components.map(component => component.type.startsWith('wire-duct') ? { ...component, position: { x: component.position.x + 13, y: component.position.y + 21 }, size: { width: 384, height: 72 } } : component), wires: before.wires };
    const existing = editor(custom);
    existing.button('导线全部入槽').props.onClick(); existing.render();
    assert.deepEqual(existing.document().components, custom.components, 'existing saved positions and sizes must not be rearranged');
    const count = existing.updates.length;
    existing.button('导线全部入槽').props.onClick(); existing.render();
    assert.equal(existing.updates.length, count, 'repeating the same operation is idempotent');
    existing.button('撤销').props.onClick(); existing.render(); assert.deepEqual(existing.document(), custom);
    assert.equal(existing.button('撤销').props.disabled, true);
    assert.deepEqual(original, before, 'the original object is never rewritten');
  } finally { restore(); }
});

test('automatic and all three manual styles remain distinct and restore preserved waypoints', () => {
  const restore = environment();
  try {
    const base = example(), bends = [{ x: 300, y: 88 }, { x: 450, y: 88 }];
    const original = { ...base, components: [...base.components.filter(component => !component.type.startsWith('wire-duct')), { id: 'custom-duct', type: 'wire-duct', label: 'WD1', position: { x: 80, y: 70 }, size: { width: 600, height: 64 } }], wires: base.wires.map(wire => ({ ...wire, style: 'orthogonal', routing: undefined, waypoints: bends })) };
    const ui = editor(original), targetId = original.wires[0].id;
    const flow = () => ui.find(node => Array.isArray(node.props?.edges));
    flow().props.onEdgesChange([{ type: 'select', id: targetId, selected: true }]); ui.render();
    const select = () => ui.find(node => node.type === 'select' && node.props['aria-label'] === '线条样式');
    select().props.onChange({ target: { value: 'duct' } }); ui.render();
    assert.equal(select().props.value, 'duct');
    const automatic = structuredClone(ui.document());
    assert.equal(automatic.wires[0].style, 'orthogonal'); assert.equal(automatic.wires[0].routing, 'duct');
    assert.deepEqual(automatic.wires[0].waypoints, bends);
    for (const style of ['straight', 'curve', 'orthogonal']) {
      select().props.onChange({ target: { value: style } }); ui.render();
      const wire = ui.document().wires[0];
      assert.equal(select().props.value, style); assert.equal(wire.style, style); assert.equal(wire.routing, undefined);
      assert.deepEqual(wire.waypoints, bends, `${style} retains the manual path`);
    }
    const count = ui.updates.length;
    select().props.onChange({ target: { value: 'orthogonal' } }); ui.render(); assert.equal(ui.updates.length, count);
    flow().props.onEdgesChange([{ type: 'select', id: targetId, selected: false }]); ui.render();
    select().props.onChange({ target: { value: 'duct' } }); ui.render();
    flow().props.onConnect({ source: 'source', sourceHandle: 'L1', target: 'source', targetHandle: 'L2' }); ui.render();
    assert.equal(ui.document().wires.at(-1).style, 'orthogonal'); assert.equal(ui.document().wires.at(-1).routing, 'duct');
    assert.equal(validateDocument(ui.document()).valid, true);
    ui.button('撤销').props.onClick(); ui.render(); assert.equal(ui.document().wires.length, original.wires.length);
  } finally { restore(); }
});

test('explicit straight connections stay manual with or without ducts', () => {
  const restore = environment();
  try {
    const base = example();
    const original = { ...base, wires: base.wires.map(wire => ({ ...wire, style: 'straight', routing: undefined })) };
    const ui = editor(original);
    ui.find(node => node.type === 'select' && node.props['aria-label'] === '线条样式').props.onChange({ target: { value: 'straight' } }); ui.render();
    ui.find(node => Array.isArray(node.props?.nodes)).props.onConnect({ source: 'source', sourceHandle: 'L1', target: 'source', targetHandle: 'L2' }); ui.render();
    assert.deepEqual(ui.document().wires.slice(0, -1), original.wires);
    assert.equal(ui.document().wires.at(-1).style, 'straight'); assert.equal(ui.document().wires.at(-1).routing, undefined);
    assert.equal(validateDocument(ui.document()).valid, true);
    const free = editor({ ...original, components: original.components.filter(component => !component.type.startsWith('wire-duct')) });
    free.find(node => node.type === 'select' && node.props['aria-label'] === '线条样式').props.onChange({ target: { value: 'straight' } }); free.render();
    free.find(node => Array.isArray(node.props?.nodes)).props.onConnect({ source: 'source', sourceHandle: 'L1', target: 'source', targetHandle: 'L2' }); free.render();
    assert.equal(free.document().wires.at(-1).style, 'straight'); assert.equal(free.document().wires.at(-1).routing, undefined);
  } finally { restore(); }
});

test('missing duct feedback persists after connection and reload, without misleading manual-wire notices', () => {
  const restore = environment();
  try {
    const base = example();
    const saved = { ...base, components: base.components.filter(component => !component.type.startsWith('wire-duct')), wires: base.wires.map(wire => ({ ...wire, style: 'orthogonal', routing: 'duct' })) };
    const ui = editor(saved);
    const notice = () => ui.find(node => node.props?.['aria-label'] === '自动走线提示');
    assert.ok(notice(), 'a saved failed route immediately exposes persistent feedback');
    ui.find(node => Array.isArray(node.props?.nodes)).props.onConnect({ source: 'source', sourceHandle: 'L1', target: 'source', targetHandle: 'L2' }); ui.render();
    assert.equal(ui.document().wires.at(-1).style, 'orthogonal'); assert.equal(ui.document().wires.at(-1).routing, 'duct');
    assert.ok(notice());
    const manual = editor({ ...saved, wires: saved.wires.map(wire => ({ ...wire, routing: undefined })) });
    assert.equal(manual.find(node => node.props?.['aria-label'] === '自动走线提示'), undefined);
    const loaded = editor(structuredClone(ui.document()));
    assert.ok(loaded.find(node => node.props?.['aria-label'] === '自动走线提示'), 'feedback is derived from saved geometry on reload');
    assert.deepEqual(saved.components, base.components.filter(component => !component.type.startsWith('wire-duct')), 'opening a legacy graph does not rearrange it');
  } finally { restore(); }
});

test('prelayout, style changes and new connections refuse running and read-only callbacks', () => {
  const restore = environment();
  try {
    const base = example();
    for (const state of ['read-only', 'running']) {
      const ui = editor(base, { readOnly: state === 'read-only' });
      if (state === 'running') { ui.find(node => node.type === 'button' && node.props.children?.some?.(child => child === '开始仿真')).props.onClick(); ui.render(); }
      const count = ui.updates.length;
      const layout = ui.button('导线全部入槽') ?? ui.button('预布线槽');
      assert.equal(layout.props.disabled, true); layout.props.onClick();
      const select = ui.find(node => node.type === 'select' && node.props['aria-label'] === '线条样式');
      assert.equal(select.props.disabled, true); select.props.onChange({ target: { value: 'duct' } });
      ui.find(node => Array.isArray(node.props?.nodes)).props.onConnect({ source: 'source', sourceHandle: 'L1', target: 'source', targetHandle: 'L2' });
      assert.equal(ui.updates.length, count);
      assert.deepEqual(ui.document(), base);
    }
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
