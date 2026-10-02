import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

// Exercise real component callbacks against controlled media properties. This
// verifies lifecycle/selection logic; decoding and native controls need browser QA.
const hooks = `let slots=[],cursor=0,effects=[],dirty=false;
export function unmount(){for(const slot of slots){slot?.cleanup?.();if(slot)slot.cleanup=null;}}
export function reset(){unmount();slots=[];cursor=0;effects=[];dirty=false;}
export function begin(){cursor=0;dirty=false;}
export function flush(){for(const run of effects.splice(0))run();return dirty;}
export function replayEffects(){for(const slot of slots)if(slot?.effect){slot.cleanup?.();slot.cleanup=slot.effect();}}
export function useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];}
export function useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});}
export function useId(){return 'video-test-id';}
export function useCallback(callback,deps){const i=cursor++;const old=slots[i];if(!old||deps.some((value,index)=>value!==old.deps[index]))slots[i]={deps,callback};return slots[i].callback;}
export function useEffect(effect,deps){const i=cursor++;const old=slots[i];if(!old||deps.some((value,index)=>value!==old.deps[index])){slots[i]={deps,effect};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=effect();});}}`;
const bundle = await build({
  stdin: { contents: `export * from './app/simulator/reference-video/catalog';export * from './app/simulator/reference-video/controls';export {default as ReferenceVideoPlayer} from './app/simulator/reference-video/ReferenceVideoPlayer';export {default as FloatingSchematic} from './app/simulator/editor/FloatingSchematic';export {default as ReferenceDrawings} from './app/simulator/ReferenceDrawings';export {default as TrainingProjects} from './app/simulator/TrainingProjects';export {reset,begin,flush,unmount,replayEffects} from 'react';`, resolveDir: process.cwd() },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' },
  plugins: [{ name: 'reference-video-media', setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: 'hooks', namespace: 'video-test' }));
    build.onLoad({ filter: /^hooks$/, namespace: 'video-test' }, () => ({ contents: hooks }));
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'jsx', namespace: 'video-test' }));
    build.onLoad({ filter: /^jsx$/, namespace: 'video-test' }, () => ({ contents: 'export const Fragment=Symbol.for("react.fragment");export const jsx=(type,props,key)=>({type,props,key});export const jsxs=jsx;' }));
    build.onResolve({ filter: /^lucide-react$/ }, () => ({ path: 'icons', namespace: 'video-test' }));
    build.onLoad({ filter: /^icons$/, namespace: 'video-test' }, () => ({ contents: 'export const RotateCcw=()=>null,RotateCw=()=>null,Video=()=>null,BookOpen=()=>null,GripHorizontal=()=>null,Maximize2=()=>null,Minimize2=()=>null,Minus=()=>null,Plus=()=>null,ZoomIn=()=>null,ZoomOut=()=>null,ChevronLeft=()=>null,ChevronRight=()=>null,Search=()=>null,X=()=>null,FileUp=()=>null,ExternalLink=()=>null,RefreshCw=()=>null;' }));
    build.onResolve({ filter: /\/(CourseLibrary|DrawingViewer|PdfDrawing)$/ }, () => ({ path: 'placeholder', namespace: 'video-test' }));
    build.onLoad({ filter: /^placeholder$/, namespace: 'video-test' }, () => ({ contents: 'export default ()=>null;' }));
    build.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'video-test' }));
    build.onLoad({ filter: /^portal$/, namespace: 'video-test' }, () => ({ contents: 'export const createPortal=value=>value;' }));
    build.onResolve({ filter: /^\.\/api$/ }, args => args.importer.endsWith('TrainingProjects.tsx') ? { path: 'project-api', namespace: 'video-test' } : null);
    build.onLoad({ filter: /^project-api$/, namespace: 'video-test' }, () => ({ contents: 'export const STATIC_DEMO=false;export class ApiError extends Error{};export const jsonBody=value=>value;export const api=async()=>({items:[{id:"formal-course",name:"正式课题",title:"正式课题",lessonId:"motor-course-01",drawingStatus:"pending",media:null}]});' }));
  } }],
});
const { REFERENCE_VIDEOS, referenceVideoForDiagram, referenceVideoForLesson, referenceLessonForDocument, videoSeekTarget, ReferenceVideoPlayer, FloatingSchematic, ReferenceDrawings, TrainingProjects, reset, begin, flush, unmount, replayEffects } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
function all(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate));
  return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
}
function mount(Component, props, media) {
  reset(); let tree;
  function render() {
    for (let index = 0; index < 10; index++) {
      begin(); tree = Component(props);
      for (const node of all(tree, node => node.type === 'video')) if (media) node.props.ref.current = media;
      if (!flush()) return;
    }
    throw new Error('Video rendering did not settle');
  }
  render();
  return { render, find: predicate => all(tree, predicate)[0], tree: () => tree };
}
function mediaFixture() {
  const attributes = new Map();
  return { currentTime: 3, duration: 25, playbackRate: 1, pauses: 0, loads: 0,
    getAttribute: key => attributes.get(key) ?? null, setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key),
    pause() { this.pauses++; }, load() { this.loads++; },
  };
}

test('reference video records retain explicit source IDs and never infer the ten new motor course mappings', () => {
  assert.equal(REFERENCE_VIDEOS.length, 18); assert.equal(new Set(REFERENCE_VIDEOS.map(item => item.diagramId)).size, 18);
  const videos = REFERENCE_VIDEOS.filter(item => item.url); assert.equal(videos.length, 15); assert.equal(new Set(videos.map(item => item.url)).size, 14);
  for (const video of videos) { const url = new URL(video.url); assert.equal(url.protocol, 'https:'); assert.equal(url.host, 'dpv.videocc.net'); assert.equal(url.username, ''); assert.equal(url.password, ''); assert.deepEqual([...url.searchParams.keys()], ['pid']); }
  assert.equal(referenceVideoForLesson('motor-jog').diagramId, 13); assert.equal(referenceVideoForLesson('motor-self-hold').diagramId, 14);
  for (const [lesson, id] of [['lighting-single', 11], ['lighting-two-way', 12]]) { assert.equal(referenceVideoForLesson(lesson).diagramId, id); assert.equal(referenceVideoForLesson(lesson).url, null); }
  assert.equal(referenceVideoForDiagram(15).url, null);
  for (let index = 1; index <= 10; index++) assert.equal(referenceVideoForLesson(`motor-course-${String(index).padStart(2, '0')}`), undefined);
  assert.equal(referenceVideoForLesson(undefined), undefined);
});

test('private uploaded drawings and course-project attachments cannot inherit the previous lesson video', () => {
  const document = { lessonId: 'motor-jog' };
  assert.equal(referenceLessonForDocument(document), 'motor-jog');
  assert.equal(referenceLessonForDocument(document, true), undefined);
  assert.equal(referenceLessonForDocument({ ...document, drawingMediaId: 'private-media' }), undefined);
  assert.equal(referenceLessonForDocument({ ...document, trainingProjectId: 'user-course' }), undefined);
  assert.equal(referenceLessonForDocument({ ...document, projectDrawings: { layout: { mediaId: 'private-layout', type: 'image/png' } } }), undefined);
});

test('video seeking clamps both ends and refuses unavailable media duration', () => {
  assert.equal(videoSeekTarget(3, 25, -10), 0); assert.equal(videoSeekTarget(22, 25, 10), 25); assert.equal(videoSeekTarget(10, 25, 10), 20);
  for (const duration of [0, NaN, Infinity, -1]) assert.equal(videoSeekTarget(3, duration, 10), null);
});

test('player uses anonymous native controls and actual media seek/rate callbacks, with retry on failure', () => {
  const wrapper = ReferenceVideoPlayer({ video: referenceVideoForDiagram(13) }); const media = mediaFixture();
  const ui = mount(wrapper.type, wrapper.props, media);
  const video = ui.find(node => node.type === 'video');
  assert.equal(video.props.controls, true); assert.equal(video.props.crossOrigin, 'anonymous'); assert.equal(video.props.autoPlay, undefined);
  assert.equal(ui.find(node => node.type === 'button').props.disabled, true);
  video.props.onLoadedMetadata({ currentTarget: media }); ui.render();
  ui.find(node => node.type === 'button').props.onClick(); assert.equal(media.currentTime, 0);
  ui.find(node => node.type === 'select').props.onChange({ target: { value: '1.5' } }); assert.equal(media.playbackRate, 1.5);
  video.props.onError(); ui.render(); assert.ok(ui.find(node => node.props?.role === 'alert'));
  ui.find(node => node.type === 'button' && node.props.children === '重新加载').props.onClick(); assert.equal(media.loads, 1); ui.render();
  assert.equal(ui.find(node => node.props?.role === 'alert'), undefined); unmount();
});

test('unmount pauses and releases media; effect replay restores src instead of silently breaking playback', () => {
  const wrapper = ReferenceVideoPlayer({ video: referenceVideoForDiagram(14) }); const media = mediaFixture();
  mount(wrapper.type, wrapper.props, media); assert.equal(media.getAttribute('src'), wrapper.props.video.url);
  replayEffects(); assert.equal(media.pauses, 1); assert.equal(media.getAttribute('src'), wrapper.props.video.url);
  unmount(); assert.equal(media.pauses, 2); assert.equal(media.getAttribute('src'), null); assert.equal(media.loads, 2);
});

test('drawing preview selects the exact diagram video, and closing removes the player', () => {
  const ui = mount(ReferenceDrawings, { onPractice() {}, onProjectPractice() {} });
  ui.find(node => node.type === 'button' && node.key === 'industrial').props.onClick(); ui.render();
  // The first industrial page contains source diagram 32.
  ui.find(node => node.type === 'button' && String(node.key) === '32').props.onClick(); ui.render();
  ui.find(node => node.type === 'button' && node.props.children === '教学视频').props.onClick(); ui.render();
  assert.equal(ui.find(node => node.type === ReferenceVideoPlayer).props.video.diagramId, 32);
  ui.find(node => node.type === 'button' && node.props['aria-label'] === '关闭').props.onClick(); ui.render();
  assert.equal(ui.find(node => node.type === ReferenceVideoPlayer), undefined); unmount();
});

test('floating window mounts a player only on its video tab and removes it when collapsed', () => {
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  try {
    const ui = mount(FloatingSchematic, { panelRef: { current: null }, boardRef: { current: null }, children: 'drawing', video: referenceVideoForDiagram(13) });
    assert.equal(ui.find(node => node.type === ReferenceVideoPlayer), undefined);
    ui.find(node => node.type === 'button' && node.props.children === '教学视频').props.onClick(); ui.render();
    assert.equal(ui.find(node => node.type === ReferenceVideoPlayer).props.video.diagramId, 13);
    ui.find(node => node.type === 'button' && node.props['aria-label'] === '收起图纸').props.onClick(); ui.render();
    assert.equal(ui.find(node => node.type === ReferenceVideoPlayer), undefined); unmount();
  } finally { globalThis.ResizeObserver = previous; }
});

test('browsing another formal project immediately disallows the old lesson video without adopting its drawing', async () => {
  const eligibility = [];
  const ui = mount(TrainingProjects, { user: { id: 'member', role: 'member' }, fallback: 'old lesson drawing', onPreviewContextChange: allowed => eligibility.push(allowed) });
  await Promise.resolve(); ui.render();
  assert.equal(eligibility.at(-1), true);
  const select = () => ui.find(node => node.type === 'select' && node.props['aria-label'] === '选择训练项目图纸');
  select().props.onChange({ target: { value: 'formal-course' } }); ui.render();
  assert.equal(eligibility.at(-1), false, 'even an unuploaded formal project must not inherit the legacy video');
  select().props.onChange({ target: { value: '' } }); ui.render(); assert.equal(eligibility.at(-1), true);
  unmount();
});
