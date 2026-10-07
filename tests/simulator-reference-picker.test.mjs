import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Keep real picker/library callbacks and effects; replace only rendering
// primitives and child viewers. No browser, network, or circuit mutation.
const hooks = `let slots=[],cursor=0,effects=[],dirty=false;
export function reset(){unmount();slots=[];cursor=0;effects=[];dirty=false;}
export function begin(){cursor=0;dirty=false;}
export function flush(){for(const run of effects.splice(0))run();return dirty;}
export function unmount(){for(const slot of slots)slot?.cleanup?.();}
export function useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];}
export function useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});}
export function useId(){return useRef('reference-picker-test').current;}
export function useEffect(effect,deps){const i=cursor++;const old=slots[i];if(!old||deps.some((value,index)=>value!==old.deps[index])){slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=effect();});}}
export const useLayoutEffect=useEffect;`;
const bundle = await build({
  stdin: { contents: 'export {default as Picker} from "./ReferenceDrawingPicker";export {default as Library} from "./ReferenceDrawings";export * from "./core/reference-drawings";export {reset,begin,flush,unmount} from "react";', resolveDir: fileURLToPath(new URL('../app/simulator/', import.meta.url)) },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/static-demo/"', '__STATIC_DEMO__': 'false' },
  plugins: [{ name: 'reference-ui-effects', setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: 'hooks', namespace: 'reference-ui-test' }));
    build.onLoad({ filter: /^hooks$/, namespace: 'reference-ui-test' }, () => ({ contents: hooks }));
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'jsx', namespace: 'reference-ui-test' }));
    build.onLoad({ filter: /^jsx$/, namespace: 'reference-ui-test' }, () => ({ contents: 'export const Fragment=Symbol.for("react.fragment");export const jsx=(type,props,key)=>({type,props,key});export const jsxs=jsx;' }));
    build.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'reference-ui-test' }));
    build.onLoad({ filter: /^portal$/, namespace: 'reference-ui-test' }, () => ({ contents: 'export const createPortal=children=>children;' }));
    build.onResolve({ filter: /^lucide-react$/ }, () => ({ path: 'icons', namespace: 'reference-ui-test' }));
    build.onLoad({ filter: /^icons$/, namespace: 'reference-ui-test' }, () => ({ contents: 'export const ChevronLeft=()=>null,ChevronRight=()=>null,Search=()=>null,X=()=>null;' }));
    build.onResolve({ filter: /(CourseLibrary|DrawingViewer|ReferenceVideoPlayer)$/ }, () => ({ path: 'viewer', namespace: 'reference-ui-test' }));
    build.onLoad({ filter: /^viewer$/, namespace: 'reference-ui-test' }, () => ({ contents: 'export default ()=>null;' }));
  } }],
});
const { Picker, Library, REFERENCE_DRAWINGS, reset, begin, flush, unmount } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function all(element, predicate) {
  if (!element || typeof element !== 'object') return [];
  if (Array.isArray(element)) return element.flatMap(child => all(child, predicate));
  return [...(predicate(element) ? [element] : []), ...all(element.props?.children, predicate)];
}
function text(element) { return Array.isArray(element) ? element.map(text).join('') : typeof element === 'string' || typeof element === 'number' ? String(element) : element?.props ? text(element.props.children) : ''; }
function environment() {
  const previous = Object.fromEntries(['document', 'setTimeout', 'clearTimeout'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const timers = new Map(); let id = 0;
  const listeners = new Map();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { body: {}, activeElement: null, addEventListener: (type, listener) => listeners.set(type, listener), removeEventListener: (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); } } });
  Object.defineProperty(globalThis, 'setTimeout', { configurable: true, value: (run, delay) => { assert.equal(delay, 300); timers.set(++id, run); return id; } });
  Object.defineProperty(globalThis, 'clearTimeout', { configurable: true, value: key => timers.delete(key) });
  return { listeners, tick: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(run => run()); }, restore: () => { unmount(); for (const key of Object.keys(previous)) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key]; } } };
}
function mount(Component, initialProps, attachRefs = () => {}) {
  reset(); let props = initialProps, tree, boundaryKey;
  function render() { for (let index = 0; index < 15; index++) {
    begin(); tree = Component(props);
    if (Component === Picker) {
      const nextKey = tree?.key;
      if (!tree || boundaryKey !== nextKey) { reset(); begin(); }
      boundaryKey = nextKey;
      if (tree) tree = tree.type(tree.props);
      for (const node of all(tree, node => node.props?.role === 'dialog')) node.props.ref.current = {
        addEventListener: (type, listener) => document.addEventListener(type, listener), removeEventListener: (type, listener) => document.removeEventListener(type, listener), querySelectorAll: () => [], focus() {}, contains: () => true,
      };
    }
    attachRefs(tree); if (!flush()) return;
  } throw new Error('render did not settle'); }
  render();
  return { render, update: next => { props = { ...props, ...next }; render(); }, tree: () => tree, find: predicate => all(tree, predicate)[0], findAll: predicate => all(tree, predicate), button: title => all(tree, node => node.type === 'button' && text(node) === title)[0] };
}
const radios = ui => ui.findAll(node => node.type === 'input' && node.props.type === 'radio');
const choose = (ui, id) => { ui.find(node => node.type === 'input' && node.props.type === 'radio' && node.props.value === id).props.onChange(); ui.render(); };

test('picker covers the shared 18 drawings in two 9-item pages and preserves original asset formats/base URL', () => {
  const env = environment();
  try {
    const ui = mount(Picker, { open: true, onSelect() {}, onClose() {} });
    const first = radios(ui).map(node => node.props.value); assert.equal(first.length, 9);
    assert.equal(ui.button('上一页').props.disabled, true);
    ui.button('下一页').props.onClick(); ui.render();
    const second = radios(ui).map(node => node.props.value); assert.equal(second.length, 9); assert.equal(ui.button('下一页').props.disabled, true);
    assert.deepEqual([...first, ...second], REFERENCE_DRAWINGS.map(drawing => drawing.id));
    const sources = ui.findAll(node => node.type === 'img').map(node => node.props.src);
    assert.ok(sources.every(source => source.startsWith('/static-demo/sim-assets/')));
    assert.ok(sources.includes('/static-demo/sim-assets/reference-1.jpg')); assert.ok(sources.includes('/static-demo/sim-assets/motor-jog.png'));
  } finally { env.restore(); }
});

test('selection is tentative, confirmation emits only one drawing id, and cancel/reopen restores the saved selection', () => {
  const env = environment();
  try {
    const selected = []; let closed = 0;
    const ui = mount(Picker, { open: true, selectedId: 32, onSelect: (...args) => selected.push(args), onClose: () => closed++ });
    choose(ui, 31); assert.deepEqual(selected, []);
    ui.button('取消').props.onClick(); assert.equal(closed, 1); assert.deepEqual(selected, []);
    ui.update({ open: false }); assert.equal(ui.tree(), null); ui.update({ open: true });
    assert.equal(radios(ui).find(node => node.props.value === 32).props.checked, true); assert.equal(radios(ui).find(node => node.props.value === 31).props.checked, false);
    choose(ui, 31); ui.button('确认').props.onClick(); assert.deepEqual(selected, [[31]]); assert.equal(closed, 2);
  } finally { env.restore(); }
});

test('search waits for IME composition completion, resets page, and includes both lighting and industrial drawings', () => {
  const env = environment();
  try {
    const ui = mount(Picker, { open: true, onSelect() {}, onClose() {} });
    env.tick(); ui.render(); ui.button('下一页').props.onClick(); ui.render();
    const search = () => ui.find(node => node.type === 'input' && node.props['aria-label'] === '搜索参考图纸');
    search().props.onCompositionStart(); ui.render(); search().props.onChange({ target: { value: '双' } }); ui.render(); env.tick(); ui.render();
    assert.equal(radios(ui).length, 9, 'in-progress IME text does not filter the grid');
    search().props.onCompositionEnd({ currentTarget: { value: '双' } }); ui.render(); env.tick(); ui.render();
    assert.deepEqual(radios(ui).map(node => node.props.value), [2, 12]); assert.equal(ui.button('上一页').props.disabled, true);
    search().props.onChange({ target: { value: '不存在的参考图纸' } }); ui.render(); env.tick(); ui.render();
    assert.equal(radios(ui).length, 0); assert.equal(text(ui.find(node => node.props?.role === 'status')), '没有找到匹配图纸');
  } finally { env.restore(); }
});

test('unknown/no selection and disabled state cannot confirm; backdrop does not dismiss', () => {
  const env = environment();
  try {
    const selected = []; let closed = 0;
    const ui = mount(Picker, { open: true, selectedId: 9999, onSelect: id => selected.push(id), onClose: () => closed++ });
    assert.equal(ui.button('确认').props.disabled, true); ui.button('确认').props.onClick(); assert.deepEqual(selected, []);
    choose(ui, 32); ui.update({ disabled: true }); assert.ok(radios(ui).every(node => node.props.disabled));
    ui.button('确认').props.onClick(); assert.deepEqual(selected, []);
    const shade = ui.find(node => node.props?.className === 'dt-reference-picker-backdrop'); let prevented = false;
    shade.props.onPointerDown({ target: shade, currentTarget: shade, preventDefault() { prevented = true; } }); assert.equal(prevented, true); assert.equal(closed, 0);
    env.listeners.get('keydown')({ key: 'Escape', stopPropagation() {}, preventDefault() {} }); assert.equal(closed, 1);
  } finally { env.restore(); }
});

test('modal isolates editor shortcuts, traps keyboard/programmatic focus, and restores its trigger on close', () => {
  const env = environment();
  try {
    const element = () => ({ isConnected: true, focus() { document.activeElement = this; }, getClientRects: () => [{}] });
    const trigger = element(), search = element(), middle = element(), confirm = element();
    const controls = [search, middle, confirm];
    const dialog = { contains: target => controls.includes(target), querySelectorAll: () => controls, addEventListener: (type, listener) => env.listeners.set(type, listener), removeEventListener: type => env.listeners.delete(type) };
    trigger.focus(); let closed = 0;
    const ui = mount(Picker, { open: true, selectedId: 32, onSelect() {}, onClose: () => closed++ }, tree => {
      for (const node of all(tree, node => !!node.props?.ref)) node.props.ref.current = node.props.role === 'dialog' ? dialog : search;
    });
    assert.equal(document.activeElement, search, 'opening focuses the search input');
    const key = (value, shiftKey = false) => {
      let stopped = false, prevented = false;
      env.listeners.get('keydown')({ key: value, shiftKey, currentTarget: dialog, stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
      assert.equal(stopped, true, `${value} must not reach the editor`); return prevented;
    };
    for (const value of ['Delete', 'Backspace', 'z', 'y']) assert.equal(key(value), false);
    confirm.focus(); assert.equal(key('Tab'), true); assert.equal(document.activeElement, search);
    assert.equal(key('Tab', true), true); assert.equal(document.activeElement, confirm);
    middle.focus(); assert.equal(key('Tab'), false, 'normal Tab navigation inside the dialog stays native');
    trigger.focus(); env.listeners.get('focusin')({ target: trigger }); assert.equal(document.activeElement, search);
    assert.equal(key('Escape'), true); assert.equal(closed, 1);
    ui.update({ open: false }); assert.equal(document.activeElement, trigger); assert.equal(env.listeners.has('focusin'), false);
  } finally { env.restore(); }
});

test('the course library has no legacy drawing or practice actions', () => {
  const env = environment();
  try {
    const onProjectPractice = () => {};
    const ui = mount(Library, { onProjectPractice });
    assert.equal(ui.findAll(node => node.type === 'button').length, 0);
    assert.ok(text(ui.tree()).includes('10 个接线课程'));
    const courseLibrary = ui.find(node => node.props?.onPractice);
    assert.equal(courseLibrary.props.onPractice, onProjectPractice);
    assert.equal(courseLibrary.props.onReferencePractice, undefined);
  } finally { env.restore(); }
});
