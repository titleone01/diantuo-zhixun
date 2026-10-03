import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  stdin: { contents: 'export { default as DocumentPreview } from "./app/simulator/editor/DocumentPreview";export * from "./app/simulator/core/validation";export * from "./app/simulator/editor/geometry";', resolveDir: process.cwd() },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  define: { 'import.meta.env.BASE_URL': '"/"' }, loader: { '.css': 'empty' },
});
const { DocumentPreview, validateDocument, curveControlPoints } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const blank = () => ({ schemaVersion: 1, title: 'Preview fixture', components: [], wires: [] });
const terminal = (id, x = 0, y = 0) => ({ id, type: 'terminal', label: id, position: { x, y } });
const ref = (componentId, terminalId) => ({ componentId, terminalId });
const viewBox = document => DocumentPreview({ document }).props.viewBox.split(' ').map(Number);

test('preview retains empty framing and includes resized ducts, routed bends and curve controls', () => {
  assert.deepEqual(viewBox(blank()), [0, 0, 500, 300]);
  const document = { ...blank(), components: [terminal('a'), terminal('b', 100, 50), { id: 'duct', type: 'wire-duct', label: 'WD1', position: { x: -100, y: -200 }, size: { width: 900, height: 400 } }], wires: [
    { id: 'bent', from: ref('a', 'A'), to: ref('b', 'A'), color: '#000000', waypoints: [{ x: -150, y: -300 }, { x: 1000, y: 700 }] },
    { id: 'curve', from: ref('a', 'B'), to: ref('b', 'B'), color: '#000000', style: 'curve' },
  ] };
  assert.equal(validateDocument(document).valid, true);
  assert.deepEqual(viewBox(document), [-178, -328, 1206, 1071]);
  document.wires = [document.wires[1]]; document.components = document.components.slice(0, 2);
  const [x, y, width, height] = viewBox(document);
  for (const point of curveControlPoints(document, document.wires[0])) {
    assert.ok(point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height);
  }
});

test('preview renders a valid 1000-wire document with maximum waypoint counts without argument overflow', () => {
  const document = { ...blank(), components: Array.from({ length: 12 }, (_, i) => terminal(`xt${i}`, i * 150)), wires: [] };
  const terminals = document.components.flatMap(component => ['A', 'B', 'A2', 'B2'].map(port => ref(component.id, port)));
  const waypoints = Array.from({ length: 256 }, (_, i) => ({ x: i % 2, y: i % 3 }));
  for (let i = 0; i < terminals.length; i++) for (let j = i + 1; j < terminals.length && document.wires.length < 1000; j++) {
    document.wires.push({ id: `w${document.wires.length}`, from: terminals[i], to: terminals[j], color: '#000000', waypoints });
  }
  assert.equal(document.wires.length, 1000);
  assert.equal(validateDocument(document).valid, true);
  assert.ok(Buffer.byteLength(JSON.stringify(document)) < 5 * 1024 * 1024, 'fixture fits the import size limit');
  assert.deepEqual(viewBox(document), [-28, -28, 1797.125, 147.125]);
});
