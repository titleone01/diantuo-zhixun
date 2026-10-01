import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Exercise Gallery's actual event/effect callbacks with controlled promise
// completion. Only rendering primitives, icons and previews are replaced.
const hooks = `let slots=[],cursor=0,effects=[],dirty=false;
export function reset(){unmount();slots=[];cursor=0;effects=[];dirty=false;}
export function begin(){cursor=0;dirty=false;}
export function flush(){for(const run of effects.splice(0))run();return dirty;}
export function unmount(){for(const slot of slots)slot?.cleanup?.();}
export function useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];}
export function useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});}
export function useEffect(effect,deps){const i=cursor++;const old=slots[i];if(!old||deps.some((value,index)=>value!==old.deps[index])){slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=effect();});}}`;
const bundled = await build({
  stdin: { contents: 'export {default as Gallery} from "./Gallery";export * from "./route";export * from "./request-state";export {reset,begin,flush,unmount} from "react";', resolveDir: fileURLToPath(new URL('../app/simulator/gallery/', import.meta.url)) },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', loader: { '.css': 'empty' },
  plugins: [{ name: 'gallery-effects', setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: 'hooks', namespace: 'gallery-state-test' }));
    build.onLoad({ filter: /^hooks$/, namespace: 'gallery-state-test' }, () => ({ contents: hooks }));
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'jsx', namespace: 'gallery-state-test' }));
    build.onLoad({ filter: /^jsx$/, namespace: 'gallery-state-test' }, () => ({ contents: 'export const Fragment=Symbol.for("react.fragment");export const jsx=(type,props)=>({type,props});export const jsxs=jsx;' }));
    build.onResolve({ filter: /^lucide-react$/ }, () => ({ path: 'icons', namespace: 'gallery-state-test' }));
    build.onLoad({ filter: /^icons$/, namespace: 'gallery-state-test' }, () => ({ contents: 'export const ArrowLeft=()=>null,ArrowRight=()=>null,CircuitBoard=()=>null,Copy=()=>null,Heart=()=>null,Link=()=>null,Search=()=>null,ShieldCheck=()=>null,Star=()=>null,X=()=>null;' }));
    build.onResolve({ filter: /DocumentPreview$/ }, () => ({ path: 'preview', namespace: 'gallery-state-test' }));
    build.onLoad({ filter: /^preview$/, namespace: 'gallery-state-test' }, () => ({ contents: 'export default ()=>null;' }));
  } }],
});
const { Gallery, GalleryRequestState, navigateAppLocation, reset, begin, flush, unmount } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

function all(element, predicate) {
  if (!element || typeof element !== 'object') return [];
  if (Array.isArray(element)) return element.flatMap(child => all(child, predicate));
  return [...(predicate(element) ? [element] : []), ...all(element.props?.children, predicate)];
}
function browser(initial = '/gallery') {
  const target = new EventTarget(), entries = [{ url: new URL(initial, 'http://localhost'), state: {} }];
  let index = 0;
  const values = {
    location: { get search() { return entries[index].url.search; }, get pathname() { return entries[index].url.pathname; }, get origin() { return entries[index].url.origin; } },
    history: {
      get state() { return entries[index].state; },
      pushState(state, _title, url) { entries.splice(index + 1); entries.push({ url: new URL(url, entries[index].url), state }); index++; },
      replaceState(state, _title, url) { entries[index] = { url: new URL(url, entries[index].url), state }; },
      back() { if (index) { index--; target.dispatchEvent(new Event('popstate')); } },
      forward() { if (index + 1 < entries.length) { index++; target.dispatchEvent(new Event('popstate')); } },
    },
    addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target),
  };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
  return () => { unmount(); for (const key of Object.keys(values)) { if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else delete globalThis[key]; } };
}
function mount() {
  reset(); let tree; const requests = [];
  const request = (path, init) => new Promise((resolve, reject) => { requests.push({ path, init, resolve, reject }); });
  function render() {
    for (let iteration = 0; iteration < 15; iteration++) { begin(); tree = Gallery({ request, onFork() {}, onPractice() {} }); if (!flush()) return; }
    throw new Error('Gallery rendering did not settle');
  }
  render();
  return { render, requests, find: predicate => all(tree, predicate)[0], findAll: predicate => all(tree, predicate), tree: () => tree };
}
const snapshot = (overrides = {}) => ({ id: 'p', title: '测试作品', author: { id: 'a', name: '成员', username: 'member' }, createdAt: 1000, document: { schemaVersion: 1, title: 'snapshot', components: [], wires: [] }, likes: 0, favorites: 0, liked: false, favorited: false, ...overrides });
const page = (item, overrides = {}) => ({ items: [item], total: 1, totalPages: 1, page: 1, pageSize: 12, ...overrides });
const pointer = () => ({ button: 0, preventDefault() {} });
async function settle(ui) { for (let index = 0; index < 4; index++) await Promise.resolve(); ui.render(); }
const reaction = (ui, label) => ui.find(node => node.type === 'button' && node.props['aria-label'] === `${label} 测试作品`);

test('mounted gallery observes top-nav pushState reset and browser back/forward for query and detail', async () => {
  const restore = browser('/gallery?q=old&page=2&publication=p');
  try {
    const ui = mount();
    ui.requests.find(value => value.path.startsWith('/publications?')).resolve(page(snapshot(), { page: 2, total: 20, totalPages: 2 }));
    ui.requests.find(value => value.path === '/publications/p').resolve({ publication: snapshot() }); await settle(ui);
    assert.equal(ui.find(node => node.type === 'input').props.value, 'old'); assert.ok(ui.find(node => node.props?.role === 'dialog'));
    // This is the shared operation used by SimulatorApp's top navigation.
    navigateAppLocation('/gallery'); ui.render();
    assert.equal(location.search, ''); assert.equal(ui.find(node => node.type === 'input').props.value, '');
    assert.equal(ui.find(node => node.props?.role === 'dialog'), undefined);
    history.back(); ui.render(); assert.equal(ui.find(node => node.type === 'input').props.value, 'old'); assert.ok(ui.find(node => node.props?.role === 'dialog'));
    history.forward(); ui.render(); assert.equal(ui.find(node => node.type === 'input').props.value, ''); assert.equal(ui.find(node => node.props?.role === 'dialog'), undefined);
  } finally { restore(); }
});

for (const [kind, label, state, count] of [['like', '点赞', 'liked', 'likes'], ['favorite', '收藏', 'favorited', 'favorites']]) {
  test(`successful ${kind} survives a detail GET that started during POST and returns an older snapshot`, async () => {
    const restore = browser();
    try {
      const ui = mount(); ui.requests[0].resolve(page(snapshot())); await settle(ui);
      reaction(ui, label).props.onClick();
      const mutation = ui.requests.find(value => value.path.endsWith(`/${kind}`)); assert.ok(mutation);
      ui.find(node => node.type === 'a' && node.props['aria-label'] === '查看 测试作品').props.onClick(pointer()); ui.render();
      const oldDetail = ui.requests.find(value => value.path === '/publications/p'); assert.ok(oldDetail);
      mutation.resolve({ publication: snapshot({ [state]: true, [count]: 1 }) }); await settle(ui);
      oldDetail.resolve({ publication: snapshot() }); await settle(ui);
      const controls = ui.findAll(node => node.type === 'button' && node.props['aria-label'] === `${label} 测试作品`);
      assert.equal(controls.length, 2); assert.ok(controls.every(node => node.props['aria-pressed'] === true));
      assert.ok(controls.every(node => node.props.children.at(-1) === 1));
    } finally { restore(); }
  });
}

test('delayed list GET cannot overwrite detail mutation or a newer post-mutation observation', async () => {
  const restore = browser('/gallery?publication=p');
  try {
    const ui = mount(), oldList = ui.requests.find(value => value.path.startsWith('/publications?'));
    ui.requests.find(value => value.path === '/publications/p').resolve({ publication: snapshot() }); await settle(ui);
    reaction(ui, '点赞').props.onClick();
    ui.requests.find(value => value.path.endsWith('/like')).resolve({ publication: snapshot({ liked: true, likes: 1 }) }); await settle(ui);
    navigateAppLocation('/gallery'); ui.render(); navigateAppLocation('/gallery?publication=p'); ui.render();
    const newDetail = ui.requests.filter(value => value.path === '/publications/p').at(-1);
    newDetail.resolve({ publication: snapshot({ liked: true, likes: 7 }) }); await settle(ui);
    oldList.resolve(page(snapshot())); await settle(ui);
    const controls = ui.findAll(node => node.type === 'button' && node.props['aria-label'] === '点赞 测试作品');
    assert.equal(controls.length, 2); assert.ok(controls.every(node => node.props['aria-pressed'] && node.props.children.at(-1) === 7));
  } finally { restore(); }
});

test('failed mutation creates no successful-write barrier and later reads retain server truth', async () => {
  const restore = browser();
  try {
    const ui = mount(); ui.requests[0].resolve(page(snapshot())); await settle(ui);
    reaction(ui, '收藏').props.onClick(); ui.requests.find(value => value.path.endsWith('/favorite')).reject(new Error('操作失败')); await settle(ui);
    assert.equal(reaction(ui, '收藏').props['aria-pressed'], false);
    ui.find(node => node.type === 'a' && node.props['aria-label'] === '查看 测试作品').props.onClick(pointer()); ui.render();
    ui.requests.find(value => value.path === '/publications/p').resolve({ publication: snapshot() }); await settle(ui);
    assert.ok(ui.findAll(node => node.type === 'button' && node.props['aria-label'] === '收藏 测试作品').every(node => node.props['aria-pressed'] === false));
  } finally { restore(); }
});

test('read ordering is per publication, keeps newer counts, and does not freeze subsequent server changes', () => {
  const state = new GalleryRequestState(), old = state.beginRead();
  state.acknowledgeMutation(snapshot({ liked: true, likes: 1 }));
  const fresh = state.beginRead(); state.acceptRead(snapshot({ liked: true, likes: 5 }), fresh);
  assert.equal(state.acceptRead(snapshot(), old).likes, 5);
  assert.equal(state.acceptRead(snapshot({ id: 'other', likes: 9 }), old).likes, 9);
  const latest = state.beginRead();
  assert.equal(state.acceptRead(snapshot({ liked: false, likes: 4 }), latest).liked, false, 'a read begun later can reflect another browser change');
  assert.equal(state.current(snapshot()).likes, 4, 'rapid next actions read the current reaction, not old render props');
});

test('observation retirement stays bounded across pages without deleting an in-flight old GET barrier', () => {
  const state = new GalleryRequestState();
  for (let page = 0; page < 200; page++) {
    const ids = Array.from({ length: 12 }, (_, index) => `page-${page}-${index}`);
    state.retain(ids);
    const read = state.beginRead();
    for (const id of ids) state.acceptRead(snapshot({ id }), read);
    state.finishRead(read);
    assert.equal(state.retainedCount, 12);
  }
  const old = state.beginRead();
  state.acknowledgeMutation(snapshot({ liked: true, likes: 1 }));
  state.retain([]);
  assert.equal(state.retainedCount, 1, 'a mutation out of view remains protected while an older list could contain it');
  assert.equal(state.acceptRead(snapshot(), old).liked, true);
  state.finishRead(old); assert.equal(state.retainedCount, 0);
  const detail = state.beginRead('other');
  state.acknowledgeMutation(snapshot({ liked: true })); state.retain([]);
  assert.equal(state.retainedCount, 0, 'a different in-flight detail cannot pin unrelated observations');
  state.finishRead(detail);
});

test('unmount for another account rejects delayed GET and successful POST and starts with separate reaction state', async () => {
  const restore = browser('/gallery?publication=p');
  try {
    const previous = mount();
    const oldList = previous.requests.find(value => value.path.startsWith('/publications?'));
    previous.requests.find(value => value.path === '/publications/p').resolve({ publication: snapshot() }); await settle(previous);
    reaction(previous, '点赞').props.onClick();
    const oldMutation = previous.requests.find(value => value.path.endsWith('/like'));
    // SimulatorApp keys Gallery by user.id and unmounts it on sign-out.
    const current = mount();
    current.requests.find(value => value.path.startsWith('/publications?')).resolve(page(snapshot()));
    current.requests.find(value => value.path === '/publications/p').resolve({ publication: snapshot() }); await settle(current);
    oldMutation.resolve({ publication: snapshot({ liked: true, likes: 99 }) }); oldList.resolve(page(snapshot({ liked: true, likes: 99 }))); await settle(current);
    const controls = current.findAll(node => node.type === 'button' && node.props['aria-label'] === '点赞 测试作品');
    assert.equal(controls.length, 2); assert.ok(controls.every(node => node.props['aria-pressed'] === false && node.props.children.at(-1) === 0));
  } finally { restore(); }
});
