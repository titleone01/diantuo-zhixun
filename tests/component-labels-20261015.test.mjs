import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `export * from './app/simulator/core/catalog';export * from './app/simulator/core/validation';export * from './app/simulator/core/engine';export * from './app/simulator/core/wire-nets';export * from './app/simulator/core/terminal-labels';export * from './app/simulator/editor/library-presentation';export {default as Artwork} from './app/simulator/editor/DeviceArtwork';export {default as Preview} from './app/simulator/editor/DocumentPreview';export {renderToStaticMarkup} from 'react-dom/server';export {createElement} from 'react';`, resolveDir: process.cwd() }, banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(process.cwd() + "/package.json");' }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent', loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' } });
const { getDefinition, resolveTerminal, rotateComponent, validateDocument, initialRuntime, simulate, getWiringNets, setWiringNetNumber, setTerminalLabel, poolGroups, Artwork, Preview, renderToStaticMarkup, createElement } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const component = (id, type) => ({ id, type, label: id.toUpperCase(), position: { x: 100, y: 200 } });
const wire = (id, a, ap, b, bp) => ({ id, from: { componentId: a, terminalId: ap }, to: { componentId: b, terminalId: bp }, color: '#3478f6' });
const document = (components, wires = []) => ({ schemaVersion: 1, title: '器件与标注验收', components, wires });

test('2P opens and closes both isolated poles without joining L1 and N', () => {
  const doc = document([component('s', 'supply'), component('q', 'breaker2')], [wire('l', 's', 'L1', 'q', '1'), wire('n', 's', 'N', 'q', '3')]);
  assert.equal(validateDocument(doc).valid, true);
  let result = simulate(doc, initialRuntime(doc));
  assert.equal(result.terminals['q::2'].potential, 'floating'); assert.equal(result.terminals['q::4'].potential, 'floating');
  result = simulate(doc, result.runtime, { type: 'toggle', componentId: 'q' });
  assert.equal(result.terminals['q::2'].potential, 'L1'); assert.equal(result.terminals['q::4'].potential, 'N');
  assert.notEqual(result.terminals['q::2'].netId, result.terminals['q::4'].netId); assert.equal(result.runtime.faultLatched, false);
  result = simulate(doc, result.runtime, { type: 'toggle', componentId: 'q' });
  assert.equal(result.terminals['q::2'].potential, 'floating'); assert.equal(result.terminals['q::4'].potential, 'floating');
});

for (const count of [10, 16, 20]) test(`${count} slots have independent bridges, blank artwork and stable anchors after rotation`, async () => {
  const type = `terminal-strip${count}`, strip = component('xt', type), definition = getDefinition(type);
  assert.equal(definition.terminals.length, count * 2); assert.equal(definition.fixedConnections.length, count);
  const result = simulate(document([strip]), initialRuntime(document([strip])));
  const nets = new Set();
  for (let position = 1; position <= count; position++) { assert.equal(result.terminals[`xt::T${position}`].netId, result.terminals[`xt::B${position}`].netId); nets.add(result.terminals[`xt::T${position}`].netId); }
  assert.equal(nets.size, count);
  const original = resolveTerminal(document([strip]), { componentId: 'xt', terminalId: 'T1' }).world;
  let rotated = strip; for (let turn = 0; turn < 4; turn++) { rotated = rotateComponent(rotated); assert.equal(validateDocument(document([rotated])).valid, true); }
  assert.deepEqual(resolveTerminal(document([rotated]), { componentId: 'xt', terminalId: 'T1' }).world, original);
  const svg = await readFile(`public/sim-assets/${type}.svg`, 'utf8'); assert.doesNotMatch(svg, /<text\b/);
});

test('manual labels persist independently of electrical IDs, PE and network grouping', () => {
  const before = document([{ ...component('xt', 'terminal-strip10'), pePositions: [5] }]);
  let next = setTerminalLabel(before, 'xt', 1, ' U1 '); next = setTerminalLabel(next, 'xt', 5, '接地');
  assert.equal(before.components[0].terminalLabels, undefined); assert.equal(next.components[0].terminalLabels[1], 'U1');
  assert.equal(validateDocument(JSON.parse(JSON.stringify(next))).valid, true); assert.deepEqual(getWiringNets(next), getWiringNets(before));
  assert.equal(resolveTerminal(next, { componentId: 'xt', terminalId: 'T5' }).terminal.electrical, 'earth');
  assert.equal(resolveTerminal(setTerminalLabel(next, 'xt', 1, 'PE'), { componentId: 'xt', terminalId: 'T1' }).terminal.electrical, 'contact');
  next = setTerminalLabel(setTerminalLabel(next, 'xt', 1, ''), 'xt', 5, ''); assert.equal(next.components[0].terminalLabels, undefined);
});

test('shared validation rejects wrong label type, slot keys, excessive text and control characters', () => {
  for (const labels of [null, [], { 0: 'x' }, { 11: 'x' }, { '01': 'x' }, { '1.5': 'x' }, { 1: '' }, { 1: 'x'.repeat(25) }, { 1: '\n' }, { 1: ' a' }, { 1: 4 }, { constructor: 'x' }]) assert.equal(validateDocument(document([{ ...component('xt', 'terminal-strip10'), terminalLabels: labels }])).valid, false, JSON.stringify(labels));
  assert.equal(validateDocument(document([{ ...component('q', 'breaker2'), terminalLabels: { 1: 'x' } }])).valid, false);
  for (const pePositions of [[0], [11], [5, 5]]) assert.equal(validateDocument(document([{ ...component('xt', 'terminal-strip10'), pePositions }])).valid, false);
  assert.equal(validateDocument(document([{ ...component('xt', 'terminal-strip10'), terminalLabels: { 10: '汉'.repeat(24) } }])).valid, true);
});

test('whole-net numbering crosses XT bridges but stops at each breaker pole', () => {
  const doc = document([component('a', 'terminal'), component('xt', 'terminal-strip10'), component('q', 'breaker2'), component('b', 'terminal')], [wire('a', 'a', 'A', 'xt', 'T1'), wire('b', 'xt', 'B1', 'q', '1'), wire('c', 'q', '2', 'b', 'A')]);
  for (const number of ['1', '10', '0', 'U1']) { const next = setWiringNetNumber(doc, 'b', number); assert.deepEqual(next.wires.map(item => item.wireNumber), [number, number, undefined]); assert.equal(validateDocument(next).valid, true); assert.deepEqual(setWiringNetNumber(next, 'a', '').wires, doc.wires); }
});

test('library hides household entries while preserving 1P/2P/3P and all strip sizes', () => {
  const groups = poolGroups('all', ''); assert.ok(!groups.some(group => group.id === 'lighting'));
  const items = groups.flatMap(group => group.items.map(item => item.type));
  for (const hidden of ['switch1', 'switch2', 'lamp']) assert.ok(!items.includes(hidden));
  assert.deepEqual(items.filter(type => type.startsWith('breaker')), ['breaker1', 'breaker2', 'breaker3']);
  for (const count of [10, 16, 20]) assert.ok(items.includes(`terminal-strip${count}`));
  assert.ok(getDefinition('lamp'), 'historical household graphs retain their definitions');
});

test('artwork and published preview include escaped manual labels and both-end wire numbers', () => {
  const xt = { ...component('xt', 'terminal-strip10'), terminalLabels: { 1: '<U1>' }, pePositions: [5] };
  const doc = setWiringNetNumber(document([xt, component('a', 'terminal')], [wire('w', 'xt', 'T1', 'a', 'A')]), 'w', '7');
  const html = renderToStaticMarkup(createElement(Preview, { document: doc }));
  assert.match(html, /&lt;U1&gt;/); assert.match(html, /data-terminal-key="xt::T1" data-wire-number="7"/); assert.match(html, /data-terminal-key="a::A" data-wire-number="7"/);
  const km = renderToStaticMarkup(createElement(Artwork, { type: 'contactor380' })); assert.match(km, /#343d45/); assert.match(km, /#595ba4/); assert.match(km, /#b8c0c5/);
});
