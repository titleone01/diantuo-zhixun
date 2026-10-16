import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
  stdin: { contents: `export * from './app/simulator/core/wire-nets'; export * from './app/simulator/core/engine'; export * from './app/simulator/core/lessons'; export * from './app/simulator/core/validation'; export * from './app/simulator/editor/diagnostic-presentation'; export * from './app/simulator/editor/selection-clipboard'; export * from './app/simulator/workspace-session';`, resolveDir: process.cwd() },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
});
const { getWiringNets, setWiringNetNumber, connectionWireNumber, wireNumberNotices, validWireNumber, presentDiagnostics, simulate, initialRuntime, createLessonDocument, assessLesson, validateDocument, copySelection, pasteSelection, readRecovery } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const ref = (componentId, terminalId) => ({ componentId, terminalId });
const device = (id, type = 'terminal') => ({ id, type, label: id, position: { x: 0, y: 0 } });
const wire = (id, a, at, b, bt, wireNumber) => ({ id, from: ref(a, at), to: ref(b, bt), color: '#3478f6', ...(wireNumber ? { wireNumber } : {}) });
const graph = () => ({
  schemaVersion: 1, title: 'Owned wiring fixture',
  components: [device('a'), device('b'), device('c'), device('d'), device('xt', 'terminal-strip16'), device('km', 'contactor380'), device('fu', 'fuse'), device('fr', 'overload'), device('sb', 'push-no'), device('m', 'motor')],
  wires: [wire('ab', 'a', 'A', 'b', 'A'), wire('bc', 'b', 'B', 'c', 'A'), wire('cx', 'c', 'B', 'xt', 'T1'), wire('xk', 'xt', 'B1', 'km', 'A2_top'), wire('kd', 'km', 'A2', 'd', 'A')],
});
const netAt = (document, key) => getWiringNets(document).find(net => net.terminalIds.includes(key));

test('static nets cross branches, terminal-strip bridges and aliases, but keep insulated poles separate', () => {
  const doc = graph(), net = netAt(doc, 'a::A');
  assert.deepEqual(net.wireIds, ['ab', 'bc', 'cx', 'kd', 'xk']);
  for (const key of ['b::B', 'xt::T1', 'xt::B1', 'km::A2_top', 'km::A2', 'd::B']) assert.ok(net.terminalIds.includes(key), key);
  for (const key of ['a::A2', 'xt::T2', 'km::A1', 'km::1']) assert.ok(!net.terminalIds.includes(key), key);
});

test('fuses, protective channels, switches, coils and motor windings split physical wire sections', () => {
  const doc = graph();
  for (const [a, b] of [['fu::1', 'fu::2'], ['fr::1', 'fr::2'], ['fr::95', 'fr::96'], ['sb::11', 'sb::12'], ['km::1', 'km::2'], ['km::A1', 'km::A2'], ['m::U', 'm::V']]) assert.notEqual(netAt(doc, a)?.id, netAt(doc, b)?.id, a);
  assert.equal(validateDocument(doc).valid, true);
});

test('wire crossings, position, color and route never create an electrical junction', () => {
  const doc = graph();
  doc.wires.push({ ...wire('isolated', 'a', 'A2', 'd', 'A2'), waypoints: [{ x: 40, y: 50 }] });
  const before = getWiringNets(doc);
  const moved = { ...doc, components: doc.components.map(c => ({ ...c, position: { x: 40, y: 50 } })), wires: doc.wires.map(w => ({ ...w, color: '#ff0000', style: 'straight', waypoints: [{ x: 0, y: 0 }] })) };
  assert.deepEqual(getWiringNets(moved), before);
  assert.notEqual(netAt(doc, 'a::A').id, netAt(doc, 'a::A2').id);
});

test('setting a net label trims input, changes its wires only and clear removes the optional field', () => {
  const doc = graph(); doc.wires.push(wire('other', 'a', 'A2', 'd', 'A2', 'other'));
  const before = JSON.stringify(doc), next = setWiringNetNumber(doc, 'bc', '  控制 01  ');
  assert.equal(JSON.stringify(doc), before);
  assert.equal(next.schemaVersion, 1);
  assert.ok(next.wires.slice(0, 5).every(w => w.wireNumber === '控制 01'));
  assert.equal(next.wires.at(-1).wireNumber, 'other');
  assert.equal(setWiringNetNumber(next, 'ab', '控制 01'), next, 'same label is a no-op');
  const cleared = setWiringNetNumber(next, 'ab', '   ');
  assert.ok(cleared.wires.slice(0, 5).every(w => !Object.hasOwn(w, 'wireNumber')));
  assert.equal(cleared.wires.at(-1).wireNumber, 'other');
});

test('labels accept 1–24 printable Unicode characters and reject controls or noncanonical imports', () => {
  for (const value of ['1', 'U1', '控制回路 4', '😀'.repeat(24)]) assert.equal(validWireNumber(value), true, value);
  for (const value of ['', 'x'.repeat(25), ' 1', '1 ', 'a\nb', 'a\tb', 'a\u0000b', 'a\u2028b', 'a\u200bb', 3, null]) {
    assert.equal(validWireNumber(value), false);
    const doc = graph(); doc.wires[0].wireNumber = value;
    assert.equal(validateDocument(doc).valid, false);
  }
  assert.throws(() => setWiringNetNumber(graph(), 'ab', '1\n2'), /可打印/);
});

test('new connections inherit exactly one existing number; conflicting labels remain untouched', () => {
  const doc = setWiringNetNumber(graph(), 'ab', '4');
  assert.deepEqual(connectionWireNumber(doc, ref('a', 'A'), ref('fu', '1')), { wireNumber: '4', conflict: false });
  doc.wires.push(wire('other', 'a', 'A2', 'fu', '2', '9'));
  const before = JSON.stringify(doc), choice = connectionWireNumber(doc, ref('a', 'A'), ref('a', 'A2'));
  assert.deepEqual(choice, { wireNumber: undefined, conflict: true });
  assert.equal(JSON.stringify(doc), before);
  const merged = { ...doc, wires: [...doc.wires, wire('merge', 'a', 'A', 'a', 'A2')] };
  assert.deepEqual(netAt(merged, 'a::A').numbers, ['4', '9']);
  assert.match(wireNumberNotices(getWiringNets(merged))[0].message, /多个线号/);
});

test('equal labels on disconnected nets are annotation notices, independent of safety', () => {
  const doc = setWiringNetNumber(graph(), 'ab', '4');
  doc.wires.push(wire('other', 'a', 'A2', 'fu', '2', '4'));
  const notices = wireNumberNotices(getWiringNets(doc));
  assert.equal(notices.length, 1); assert.equal(notices[0].netIds.length, 2);
  assert.match(notices[0].message, /不相连/);
});

test('schema 1 labels survive JSON, recovery and clipboard; unnumbered legacy documents stay untouched', () => {
  const legacy = graph(), before = JSON.stringify(legacy);
  assert.deepEqual(validateDocument(legacy).document, legacy);
  assert.equal(JSON.stringify(legacy), before);
  const labeled = setWiringNetNumber(legacy, 'ab', '24');
  const reloaded = validateDocument(JSON.parse(JSON.stringify(labeled)));
  assert.equal(reloaded.valid, true); assert.deepEqual(reloaded.document, labeled);
  assert.deepEqual(readRecovery(JSON.stringify({ document: labeled, saved: null, dirty: true })).document, labeled);
  let id = 0;
  const clipboard = copySelection(labeled, ['a', 'b', 'c']);
  const pasted = pasteSelection(labeled, clipboard, 32, () => String(++id)).document;
  assert.deepEqual(pasted.wires.slice(labeled.wires.length).map(w => w.wireNumber), ['24', '24']);
  assert.match(wireNumberNotices(getWiringNets(pasted))[0].message, /不相连/);
});

const starts = ['sb', 'sb2', 'sb2', 'sb1', 'sb1', 'sb1', 'sb3', 'sb1', 'sb1', 'sb2'];
const stops = [null, 'sb1', 'sb1', 'sb3', 'sb3', 'sb3', 'sb1', 'sb2', 'sb2', 'sb1'];
for (let number = 1; number <= 10; number++) test(`course ${number}: waiting, running and normal release keep safety clean and static nets stable`, () => {
  const doc = createLessonDocument(`motor-course-${String(number).padStart(2, '0')}`, { wired: true });
  const before = getWiringNets(doc);
  let result = simulate(doc, initialRuntime(doc));
  const check = () => {
    const split = presentDiagnostics(result.diagnostics);
    assert.deepEqual(split.safety, []);
    for (const item of split.runtime) if (item.code === 'OPEN_CONTROL_PATH') assert.match(item.message, /当前未得电，控制回路未导通/);
    assert.deepEqual(getWiringNets(doc), before);
  };
  check(); assert.ok(presentDiagnostics(result.diagnostics).runtime.some(d => d.code === 'OPEN_CONTROL_PATH'));
  const step = action => { result = simulate(doc, result.runtime, action); check(); };
  step({ type: 'toggle', componentId: 'qf' });
  step({ type: 'press', componentId: starts[number - 1] });
  if ([8, 9].includes(number)) step({ type: 'advance-time', ms: 3000 });
  assert.ok(doc.components.filter(c => c.type.startsWith('motor')).some(c => result.components[c.id]?.active));
  step({ type: 'release', componentId: starts[number - 1] });
  if (stops[number - 1]) {
    step({ type: 'press', componentId: stops[number - 1] });
    step({ type: 'release', componentId: stops[number - 1] });
  }
  assert.ok(doc.components.filter(c => c.type.startsWith('motor')).every(c => !result.components[c.id]?.active));
  assert.equal(assessLesson(doc).status, 'passed', 'presentation never changes course grading');
});

for (const [name, mutate, code] of [
  ['missing PE', doc => { doc.wires = doc.wires.filter(w => ![w.from, w.to].some(t => t.componentId === 'm' && t.terminalId === 'PE')); }, 'PE_MISSING'],
  ['short circuit', doc => doc.wires.push(wire('bad', 'km', '2', 'km', '4')), 'PHASE_SHORT'],
  ['wrong coil voltage', doc => { doc.wires = doc.wires.filter(w => ![w.from, w.to].some(t => t.componentId === 'km' && t.terminalId === 'A2')); doc.wires.push(wire('bad', 'km', 'A2', 'source', 'N')); }, 'COIL_VOLTAGE_MISMATCH'],
  ['protection bypass', doc => doc.wires.push(wire('bad', 'fu1', '1', 'fu1', '2')), 'FUSE_BYPASS'],
]) test(`real fault stays in safety with location evidence: ${name}`, () => {
  const doc = createLessonDocument('motor-course-01', { wired: true }); mutate(doc);
  const assessment = assessLesson(doc), fault = presentDiagnostics(assessment.diagnostics).safety.find(d => d.code === code);
  assert.notEqual(assessment.status, 'passed'); assert.ok(fault);
  assert.ok(fault.componentIds.length || fault.terminalIds.length || fault.wireIds.length);
});

test('a missing control wire remains an incomplete course even though an open coil is runtime information', () => {
  const doc = createLessonDocument('motor-course-01', { wired: true });
  doc.wires = doc.wires.filter(w => ![w.from, w.to].some(t => t.componentId === 'km' && t.terminalId === 'A1'));
  let result = simulate(doc, initialRuntime(doc));
  result = simulate(doc, result.runtime, { type: 'toggle', componentId: 'qf' });
  result = simulate(doc, result.runtime, { type: 'press', componentId: 'sb' });
  assert.ok(presentDiagnostics(result.diagnostics).runtime.some(d => d.code === 'OPEN_CONTROL_PATH'));
  assert.notEqual(assessLesson(doc).status, 'passed');
});
