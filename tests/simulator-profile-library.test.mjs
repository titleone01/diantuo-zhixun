import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

// Render/effect primitives are replaced; ProfileLibrary's real callbacks,
// request guards, pagination and merge logic run against deferred responses.
const hooks = `export const useLayoutEffect=(effect,deps)=>useEffect(effect,deps);
let slots=[],cursor=0,effects=[],dirty=false;
export function unmount(){for(const slot of slots){slot?.cleanup?.();if(slot)slot.cleanup=null;}}
export function reset(){unmount();slots=[];cursor=0;effects=[];dirty=false;}
export function begin(){cursor=0;dirty=false;}
export function flush(){for(const run of effects.splice(0))run();return dirty;}
export function useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];}
export function useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});}
export function useEffect(effect,deps){const i=cursor++;const old=slots[i];if(!old||deps.some((value,index)=>value!==old.deps[index])){slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=effect();});}}`;
const bundle = await build({
  stdin: { contents: `export {default as Library} from './app/simulator/profile/ProfileLibrary';export {reset,begin,flush,unmount} from 'react';`, resolveDir: process.cwd() },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', loader: { '.css': 'empty' }, define: { __STATIC_DEMO__: 'false' },
  plugins: [{ name: 'profile-component-effects', setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: 'hooks', namespace: 'profile-test' }));
    build.onLoad({ filter: /^hooks$/, namespace: 'profile-test' }, () => ({ contents: hooks }));
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'jsx', namespace: 'profile-test' }));
    build.onLoad({ filter: /^jsx$/, namespace: 'profile-test' }, () => ({ contents: 'export const Fragment=Symbol.for("react.fragment");export const jsx=(type,props,key)=>({type,props,key});export const jsxs=jsx;' }));
    build.onResolve({ filter: /^lucide-react$/ }, () => ({ path: 'icons', namespace: 'profile-test' }));
    build.onLoad({ filter: /^icons$/, namespace: 'profile-test' }, () => ({ contents: 'export const ChevronLeft=()=>null,ChevronRight=()=>null,CircuitBoard=()=>null,FolderOpen=()=>null,Heart=()=>null,Search=()=>null,Star=()=>null;' }));
    build.onResolve({ filter: /DocumentPreview$/ }, () => ({ path: 'preview', namespace: 'profile-test' }));
    build.onLoad({ filter: /^preview$/, namespace: 'profile-test' }, () => ({ contents: 'export default ()=>null;' }));
  } }],
});
const { Library, reset, begin, flush, unmount } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
function all(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate));
  return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
}
function text(node) { return Array.isArray(node) ? node.map(text).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props ? text(node.props.children) : ''; }
function mount(overrides = {}) {
  reset(); let tree; const requests = [], opened = [], observers = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
  Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: class {
    constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; }
    fire() { this.callback([{ isIntersecting: true }]); }
  } });
  let instanceKey;
  let props = { ownerId: 'a', tab: 'publications', refresh: 0, busy: false, request: (path, init) => new Promise((resolve, reject) => requests.push({ path, init, resolve, reject })), onOpenDraft: item => opened.push(item.id), onDeleteDraft() {}, onOpenPublication: id => opened.push(id), onNew() {}, ...overrides };
  function render() { for (let i = 0; i < 15; i++) { const boundary = Library(props); if (boundary.key !== instanceKey) { reset(); instanceKey = boundary.key; } begin(); tree = boundary.type(boundary.props); for (const node of all(tree, node => !!node.props?.ref)) node.props.ref.current = {}; if (!flush()) return; } throw new Error('render did not settle'); }
  render();
  return { requests, opened, observers, render, tree: () => tree, find: predicate => all(tree, predicate)[0], findAll: predicate => all(tree, predicate), button: label => all(tree, node => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label))[0],
    // Mirror SimulatorApp's key={`${user.id}:${profileTab}`} boundary.
    update(next) { if (next.ownerId && next.ownerId !== props.ownerId || next.tab && next.tab !== props.tab) reset(); props = { ...props, ...next }; render(); },
    close() { unmount(); if (previous) Object.defineProperty(globalThis, 'IntersectionObserver', previous); else delete globalThis.IntersectionObserver; },
  };
}
const item = (id, extras = {}) => ({ id, title: `电路 ${id}`, createdAt: '2026-09-30', updatedAt: '2026-09-30', revision: 1, author: { id: 'a', name: 'A', username: 'a' }, document: { schemaVersion: 1, title: id, components: [], wires: [] }, likes: 0, favorites: 0, ...extras });
const page = (ids, number = 1, totalPages = 1, pageSize = 12) => ({ items: ids.map(id => typeof id === 'string' ? item(id) : id), page: number, totalPages, pageSize, total: totalPages * pageSize });
async function settle(ui) { for (let i = 0; i < 5; i++) await Promise.resolve(); ui.render(); }
const count = ui => ui.tree().props['data-loaded-count'];
function submit(ui, query) { ui.find(node => node.type === 'input').props.onChange({ target: { value: query } }); ui.render(); ui.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); ui.render(); }

test('draft controls request true pages and supported sizes, and pass the actual selected draft to edit', async () => {
  const ui = mount({ tab: 'drafts' });
  try {
    assert.equal(new URL(ui.requests[0].path, 'http://localhost').searchParams.get('pageSize'), '10');
    ui.requests[0].resolve(page(['d1'], 1, 3, 10)); await settle(ui);
    ui.button('下一页草稿').props.onClick(); ui.render();
    assert.equal(new URL(ui.requests.at(-1).path, 'http://localhost').searchParams.get('page'), '2');
    ui.requests.at(-1).resolve(page(['d2'], 2, 3, 10)); await settle(ui);
    ui.button('编辑').props.onClick(); assert.deepEqual(ui.opened, ['d2']);
    ui.find(node => node.type === 'select').props.onChange({ target: { value: '50' } }); ui.render();
    const url = new URL(ui.requests.at(-1).path, 'http://localhost'); assert.equal(url.searchParams.get('page'), '1'); assert.equal(url.searchParams.get('pageSize'), '50');
    ui.requests.at(-1).resolve(page(['d1', 'd2'], 1, 1, 50)); await settle(ui);
    assert.equal(count(ui), 2); assert.equal(ui.button('下一页草稿').props.disabled, true);
  } finally { ui.close(); }
});

test('scroll batches deduplicate snapshots and a repeated queued observer notification cannot strand loading', async () => {
  const ui = mount();
  try {
    ui.requests[0].resolve(page(['a', 'b'], 1, 3)); await settle(ui);
    const observer = ui.observers.at(-1); observer.fire(); ui.render(); observer.fire();
    ui.requests.at(-1).resolve(page([item('b', { likes: 7 }), 'c'], 2, 3)); await settle(ui);
    assert.equal(count(ui), 3); assert.equal(ui.find(node => node.props?.role === 'status'), undefined);
    ui.observers.at(-1).fire(); ui.render(); ui.requests.at(-1).resolve(page(['d'], 3, 3)); await settle(ui);
    assert.equal(count(ui), 4); assert.equal(ui.requests.length, 3);
    assert.ok(ui.requests.every(request => request.path.startsWith('/publications?') && request.path.includes('includeDocument=1')), 'cards do not fetch a detail per item');
    ui.button('查看 电路 c').props.onClick(); assert.deepEqual(ui.opened, ['c']); assert.equal(ui.requests.length, 3);
  } finally { ui.close(); }
});

test('tab and account remounts reject old success/errors, including returning to the original member', async () => {
  const ui = mount();
  try {
    const oldTab = ui.requests[0]; ui.update({ tab: 'favorites' });
    const oldA = ui.requests.at(-1); ui.update({ ownerId: 'b' }); const oldB = ui.requests.at(-1); ui.update({ ownerId: 'a' });
    ui.requests.at(-1).resolve(page(['new-A'])); await settle(ui);
    oldTab.resolve(page(['wrong-tab'])); oldA.resolve(page(['old-A'])); oldB.reject(new Error('B private error')); await settle(ui);
    assert.equal(count(ui), 1); assert.ok(ui.button('查看 电路 new-A')); assert.equal(ui.find(node => node.props?.role === 'alert'), undefined);
  } finally { ui.close(); }
});

test('search replaces earlier query results and refresh resets all accumulated batches to page one', async () => {
  const ui = mount();
  try {
    const initial = ui.requests[0]; submit(ui, 'old'); const older = ui.requests.at(-1); submit(ui, 'new');
    ui.requests.at(-1).resolve(page(['new1'], 1, 3)); await settle(ui);
    initial.resolve(page(['initial'])); older.resolve(page(['old'])); await settle(ui); assert.equal(count(ui), 1); assert.ok(ui.button('查看 电路 new1'));
    ui.observers.at(-1).fire(); ui.render(); const pendingPage2 = ui.requests.at(-1);
    ui.update({ refresh: 1 }); assert.equal(count(ui), 0);
    const newest = ui.requests.at(-1); assert.equal(new URL(newest.path, 'http://localhost').searchParams.get('page'), '1');
    newest.resolve(page(['refreshed'])); await settle(ui); pendingPage2.resolve(page(['stale2'], 2, 3)); await settle(ui);
    assert.equal(count(ui), 1); assert.ok(ui.button('查看 电路 refreshed'));
  } finally { ui.close(); }
});

test('a failed later batch keeps all read cards and retry appends that batch successfully', async () => {
  const ui = mount();
  try {
    ui.requests[0].resolve(page(['a', 'b'], 1, 2)); await settle(ui);
    ui.observers.at(-1).fire(); ui.render(); ui.requests.at(-1).reject(new Error('网络暂时中断')); await settle(ui);
    assert.equal(count(ui), 2); assert.ok(ui.button('查看 电路 a')); assert.ok(ui.find(node => node.props?.role === 'alert'));
    ui.button('重试').props.onClick(); ui.render(); assert.equal(count(ui), 2);
    assert.equal(new URL(ui.requests.at(-1).path, 'http://localhost').searchParams.get('page'), '2');
    ui.requests.at(-1).resolve(page(['c'], 2, 2)); await settle(ui);
    assert.equal(count(ui), 3); assert.equal(ui.find(node => node.props?.role === 'alert'), undefined);
  } finally { ui.close(); }
});

test('server-clamped later batch restarts from current data instead of claiming deleted cards are still present', async () => {
  const ui = mount({ tab: 'favorites' });
  try {
    ui.requests[0].resolve(page(['a', 'removed'], 1, 2)); await settle(ui);
    ui.observers.at(-1).fire(); ui.render(); ui.requests.at(-1).resolve(page(['a'], 1, 1)); await settle(ui);
    assert.equal(new URL(ui.requests.at(-1).path, 'http://localhost').searchParams.get('page'), '1');
    ui.requests.at(-1).resolve({ ...page(['a']), total: 1 }); await settle(ui);
    assert.equal(count(ui), 1); assert.equal(ui.button('查看 电路 removed'), undefined); assert.equal(ui.find(node => node.props?.role === 'status'), undefined);
  } finally { ui.close(); }
});
