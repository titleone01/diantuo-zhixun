import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const bundled = await build({
  stdin: { contents: `export * from './app/simulator/core/engine';export * from './app/simulator/core/catalog';export * from './app/simulator/core/validation';export * from './app/simulator/editor/library-presentation';export * from './app/simulator/editor/knife-switch-shape';export * from './app/simulator/editor/KnifeSwitchArtwork';export * from './app/simulator/editor/switch-motion-shapes';export {default as DeviceNode} from './app/simulator/editor/DeviceNode';export {default as DeviceArtwork} from './app/simulator/editor/DeviceArtwork';`, resolveDir: process.cwd() },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' },
  plugins: [{ name: 'component-ui', setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: 'hooks', namespace: 'component-test' }));
    build.onLoad({ filter: /^hooks$/, namespace: 'component-test' }, () => ({ contents: 'export const useRef=value=>({current:value}),useCallback=value=>value,useLayoutEffect=commit=>commit();' }));
    build.onResolve({ filter: /^@xyflow\/react$/ }, () => ({ path: 'flow', namespace: 'component-test' }));
    build.onLoad({ filter: /^flow$/, namespace: 'component-test' }, () => ({ contents: 'export const Handle="terminal-handle",NodeResizer="node-resizer";export const Position={Top:"top",Bottom:"bottom",Left:"left",Right:"right"};' }));
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'jsx', namespace: 'component-test' }));
    build.onLoad({ filter: /^jsx$/, namespace: 'component-test' }, () => ({ contents: 'export const Fragment=Symbol.for("react.fragment");export const jsx=(type,props,key)=>({type,props,key});export const jsxs=jsx;' }));
  } }],
});
const { simulate, initialRuntime, buildCircuitNetwork, getDefinition, resolveTerminal, validateDocument, poolGroups, knifeSwitchShape, knifeSwitchMotionCss, switchMotionShapes, DeviceNode, DeviceArtwork } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const device = (id, type) => ({ id, type, label: id.toUpperCase(), position: { x: 180, y: 200 } });
const small = (...components) => ({ schemaVersion: 1, title: '新增教学器件回归', components: [device('source', 'supply'), ...components], wires: [] });
const connect = (doc, a, at, b, bt) => doc.wires.push({ id: `wire-${doc.wires.length}`, from: { componentId: a, terminalId: at }, to: { componentId: b, terminalId: bt }, color: '#3377ff' });
const step = (doc, result, type, componentId) => simulate(doc, result.runtime, { type, componentId });
const pairIds = [['1', '2'], ['3', '4'], ['5', '6']];
function motorCircuit() {
  const doc = small(device('qs', 'knife-switch3'), device('fu', 'fuse3'), device('m', 'motor'));
  pairIds.forEach(([input, output], index) => {
    connect(doc, 'source', `L${index + 1}`, 'qs', input); connect(doc, 'qs', output, 'fu', input); connect(doc, 'fu', output, 'm', ['U', 'V', 'W'][index]);
  });
  connect(doc, 'source', 'PE', 'm', 'PE');
  return doc;
}
function buttonCircuit(type) {
  const doc = small(device('sb', type), device('ncLamp', 'lamp'), device('noLamp', 'lamp'));
  connect(doc, 'source', 'L1', 'sb', '11'); connect(doc, 'source', 'L1', 'sb', '23');
  connect(doc, 'sb', '12', 'ncLamp', 'L'); connect(doc, 'sb', '24', 'noLamp', 'L');
  connect(doc, 'source', 'N', 'ncLamp', 'N'); connect(doc, 'source', 'N', 'noLamp', 'N');
  return doc;
}
function expectButton(result, active) {
  assert.equal(result.components.noLamp.active, active); assert.equal(result.components.ncLamp.active, !active);
  assert.equal(result.runtime.faultLatched, false);
}
function all(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate));
  return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
}
function renderNode(type, closed, action) {
  const component = device('sb', type), doc = small(component), runtime = initialRuntime(doc); runtime.switches.sb = closed;
  return DeviceNode({ selected: false, data: { component, running: true, runtime, terminalStates: {}, diagnostics: [], action, readOnly: false, linkedComponents: [], configure() {} } });
}
function renderArtwork(type, closed) {
  let node = DeviceArtwork({ type, closed }); while (typeof node.type === 'function') node = node.type(node.props); return node;
}

test('contactor state artwork preserves every original label and electrical circle while replacing only the four state-window colors and decorative slots',()=>{
  for(const type of ['contactor220','contactor380']) {
    const original=readFileSync(new URL(`../public/sim-assets/${type}.svg`,import.meta.url),'utf8');
    const artwork=renderArtwork(type,false),body=artwork.props.children[0].props.dangerouslySetInnerHTML.__html;
    // SVG/XML line endings can differ between the original bytes and generated TS.
    const labels=svg=>svg.replace(/\r\n?/g,'\n').match(/<text\b[\s\S]*?<\/text>/g);
    for (const lineEnding of ['\n', '\r\n']) {
      assert.deepEqual(labels(body),labels(original.replace(/\r\n?/g,'\n').replaceAll('\n',lineEnding)));
    }
    const paths=text=>[...text.matchAll(/<path\b[^>]*>/g)].map(([path])=>path.match(/\bd="([^"]+)"/)[1]);
    const before=paths(original),after=paths(body);assert.equal(after.length,before.length);
    for(let i=0;i<before.length;i++)if(i!==2)assert.equal(after[i],before[i],`electrical shape ${type}/${i}`);
    assert.equal(before[2].split(/(?=M)/).length,8);assert.equal(after[2].split(/(?=M)/).length,4);
    assert.equal((body.match(/class="sim-contactor-state-region"/g)||[]).length,4);
  }
});

test('knife switch conducts three isolated poles together and opens a running three-phase motor', () => {
  const doc = motorCircuit(), before = JSON.stringify(doc); assert.equal(validateDocument(doc).valid, true);
  let result = simulate(doc, initialRuntime(doc)); assert.equal(result.components.m.active, false);
  let net = buildCircuitNetwork(doc, result.runtime);
  for (const [a, b] of pairIds) assert.equal(net.connected(`qs::${a}`, `qs::${b}`), false);
  result = step(doc, result, 'toggle', 'qs'); assert.equal(result.components.m.active, true); assert.equal(result.components.m.direction, 'forward');
  net = buildCircuitNetwork(doc, result.runtime);
  for (const [a, b] of pairIds) assert.equal(net.connected(`qs::${a}`, `qs::${b}`), true);
  for (const other of ['3', '5']) assert.equal(net.connected('qs::1', `qs::${other}`), false);
  result = step(doc, result, 'toggle', 'qs'); assert.equal(result.components.m.active, false);
  assert.equal(JSON.stringify(doc), before, 'operating artwork must not alter component positions, terminal coordinates or wires');
});

test('knife closes onto a downstream short with evidence and a latched fault', () => {
  const doc = motorCircuit(); connect(doc, 'fu', '2', 'fu', '4');
  let result = simulate(doc, initialRuntime(doc)); assert.equal(result.runtime.faultLatched, false);
  result = step(doc, result, 'toggle', 'qs'); assert.equal(result.runtime.faultLatched, true); assert.equal(result.components.m.active, false);
  assert.ok(result.diagnostics.some(item => item.code === 'PHASE_SHORT' && item.wireIds.includes(doc.wires.at(-1).id)));
});

test('three fuses remain separate and excluding any single fuse leaves the other two conducting', () => {
  const doc = small(device('fu', 'fuse3')), runtime = initialRuntime(doc);
  for (let excluded = 0; excluded < 3; excluded++) {
    const net = buildCircuitNetwork(doc, runtime, { excludeFixedConnection: { componentId: 'fu', terminals: pairIds[excluded] } });
    pairIds.forEach(([a, b], index) => assert.equal(net.connected(`fu::${a}`, `fu::${b}`), index !== excluded));
    for (const other of ['3', '5']) assert.equal(net.connected('fu::1', `fu::${other}`), false);
  }
});

test('a missing fuse phase stops the motor and a fuse cannot provide the permanent PE path', () => {
  for (const output of ['2', '4', '6']) {
    const doc = motorCircuit(); doc.wires = doc.wires.filter(wire => !(wire.from.componentId === 'fu' && wire.from.terminalId === output));
    let result = simulate(doc, initialRuntime(doc)); result = step(doc, result, 'toggle', 'qs');
    assert.equal(result.components.m.active, false); assert.ok(result.diagnostics.some(item => item.code === 'MOTOR_PHASE_MISSING'));
  }
  const doc = small(device('fu', 'fuse3'), device('m', 'motor'));
  for (let index = 0; index < 3; index++) connect(doc, 'source', `L${index + 1}`, 'm', ['U', 'V', 'W'][index]);
  connect(doc, 'source', 'PE', 'fu', '1'); connect(doc, 'fu', '2', 'm', 'PE');
  const result = simulate(doc, initialRuntime(doc)); assert.ok(result.diagnostics.some(item => item.code === 'PE_MISSING'));
});

for (const type of ['push-latching-red', 'push-latching-green']) test(`${type}: maintained NC/NO state persists until the second click, including supply loss`, () => {
  const doc = buttonCircuit(type); assert.equal(validateDocument(doc).valid, true);
  let result = simulate(doc, initialRuntime(doc)); expectButton(result, false);
  result = step(doc, result, 'toggle', 'sb'); expectButton(result, true);
  result = simulate(doc, result.runtime); expectButton(result, true);
  result = simulate(doc, result.runtime, { type: 'power', enabled: false }); assert.equal(result.runtime.switches.sb, true);
  result = simulate(doc, result.runtime, { type: 'power', enabled: true }); expectButton(result, true);
  result = step(doc, result, 'toggle', 'sb'); expectButton(result, false);
});

for (const type of ['push-no', 'push-nc']) test(`${type}: existing red/green buttons stay momentary with both contact polarities`, () => {
  const doc = buttonCircuit(type); let result = simulate(doc, initialRuntime(doc)); expectButton(result, false);
  result = step(doc, result, 'press', 'sb'); expectButton(result, true);
  result = step(doc, result, 'release', 'sb'); expectButton(result, false);
});

test('button UI clicks maintain and release without momentary pointer handlers or color-based start/stop labels', () => {
  for (const type of ['push-latching-red', 'push-latching-green']) {
    const calls = [];
    for (const closed of [false, true]) {
      const button = all(renderNode(type, closed, action => calls.push(action)), node => node.type === 'button')[0];
      assert.equal(button.props['aria-pressed'], closed); assert.match(button.props['aria-label'], closed ? /弹起/ : /按下/);
      assert.doesNotMatch(button.props.title, /合闸|分闸/); assert.equal(button.props.onPointerDown, undefined); assert.equal(button.props.onPointerUp, undefined);
      button.props.onClick(); assert.deepEqual(calls.at(-1), { type: 'toggle', componentId: 'sb' });
      const badge = all(renderNode(type, closed, () => {}), node => node.type === 'span' && node.props.className?.includes('sim-node-runtime'))[0];
      assert.equal(badge.props.children[0], closed ? '已按下' : '已弹起');
    }
  }
  for (const type of ['push-no', 'push-nc']) {
    const button = all(renderNode(type, false, () => {}), node => node.type === 'button')[0];
    assert.match(button.props['aria-label'], /复位按钮/); assert.doesNotMatch(button.props['aria-label'], /启动|停止/);
    assert.equal(typeof button.props.onPointerDown, 'function'); assert.equal(typeof button.props.onPointerUp, 'function');
  }
});

test('source artwork keeps every original path; knife movements and maintained button caps use source parts', () => {
  const original = readFileSync('public/sim-assets/knife-switch3.svg', 'utf8');
  const paths = text => [...text.matchAll(/\sd="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(paths(knifeSwitchShape.body), paths(original));
  assert.equal((knifeSwitchShape.body.match(/data-motion-part=/g) ?? []).length, 5);
  assert.match(knifeSwitchMotionCss, /translateY\(-40px\)/);
  for (const transform of ['rotate(15deg) translate(17px,18px)', 'rotate(15deg) translate(15px,0)', 'rotate(15deg) translate(12.5px,-18px)']) assert.ok(knifeSwitchMotionCss.includes(transform));
  assert.equal(renderArtwork('knife-switch3', false).props['data-mechanism-state'], 'open');
  assert.equal(renderArtwork('knife-switch3', true).props['data-mechanism-state'], 'closed');
  for (const type of ['push-latching-red', 'push-latching-green']) {
    const original = readFileSync(`public/sim-assets/${type}.svg`, 'utf8'); assert.deepEqual(paths(switchMotionShapes[type].body), paths(original));
    assert.match(switchMotionShapes[type].body, /自\s*锁/);
    assert.equal(renderArtwork(type, false).props['data-mechanism-state'], 'released');
    assert.equal(renderArtwork(type, true).props['data-mechanism-state'], 'pressed');
    assert.match(renderArtwork(type, true).props['aria-label'], /自锁按钮/);
  }
});

test('original pin-circle centers, assets and industrial pool entries exist for all four new types', () => {
  const expected = { 'knife-switch3': [[30.499, 21.999], [106.499, 21.999], [182.499, 21.999], [30.499, 280.999], [106.499, 280.999], [182.499, 280.999]], fuse3: [[25.499, 20.499], [74.499, 20.499], [123.499, 20.499], [25.499, 166.499], [74.499, 166.499], [123.499, 166.499]] };
  for (const [type, centers] of Object.entries(expected)) {
    assert.deepEqual(getDefinition(type).terminals.map(pin => [pin.x, pin.y]), centers);
    const doc = small(device('part', type));
    getDefinition(type).terminals.forEach((pin, index) => assert.deepEqual(resolveTerminal(doc, { componentId: 'part', terminalId: pin.id }).world, { x: 180 + centers[index][0], y: 200 + centers[index][1] }));
  }
  const entries = poolGroups('industrial', '').flatMap(group => group.items.map(item => item.type));
  for (const type of ['knife-switch3', 'fuse3', 'push-latching-red', 'push-latching-green']) {
    assert.equal(entries.filter(entry => entry === type).length, 1); assert.match(readFileSync(`public/sim-assets/${type}.svg`, 'utf8'), /^<svg/);
  }
});
