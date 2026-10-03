import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  stdin: { contents: 'export * from "./app/simulator/core/validation";export * from "./app/simulator/core/engine";export * from "./app/simulator/core/lessons";', resolveDir: process.cwd() },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
});
const { validateDocument, simulate, createLessonDocument } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const malformedObject = () => JSON.parse('{"toString":null,"valueOf":null}');
const mutations = [
  ['null component', document => document.components.push(null)],
  ['null wire', document => document.wires.push(null)],
  ['prototype component ID', document => { document.components[0].id = '__proto__'; }],
  ['constructor component ID', document => { document.components[0].id = 'constructor'; }],
  ['prototype role key', document => { document.roles = JSON.parse('{"__proto__":"km"}'); }],
  ['NaN coordinate', document => { document.components[0].position.x = NaN; }],
  ['infinite waypoint', document => { document.wires[0].waypoints = [{ x: Infinity, y: 1 }]; }],
  ['object component type', document => { document.components[0].type = malformedObject(); }],
  ['array component type', document => { document.components[0].type = [malformedObject()]; }],
  ['object type with size', document => { document.components[0].type = malformedObject(); document.components[0].size = { width: 80, height: 80 }; }],
  ['object auxiliary ID', document => { document.components.push({ id: malformedObject(), type: 'auxiliary-no', label: 'NO', position: { x: 0, y: 0 }, linkedTo: 'missing' }); }],
  ['object auxiliary owner type', document => { document.components.find(component => component.id === 'km').type = malformedObject(); document.components.push({ id: 'aux', type: 'auxiliary-no', label: 'NO', position: { x: 0, y: 0 }, linkedTo: 'km' }); }],
];

for (const [name, mutate] of mutations) test(`validation returns bounded errors instead of throwing for ${name}`, () => {
  const document = createLessonDocument('motor-jog', { wired: true }); mutate(document);
  const original = structuredClone(document);
  const checked = validateDocument(document);
  assert.equal(checked.valid, false); assert.ok(checked.errors.length > 0);
  assert.ok(checked.errors.every(error => typeof error === 'string' && error.length < 300));
  for (const action of [undefined, { type: 'advance-time', ms: 1 }, { type: 'press', componentId: 'start' }]) {
    const result = simulate(document, undefined, action);
    assert.equal(result.supported, false);
    assert.ok(result.diagnostics.every(item => item.code === 'INVALID_DOCUMENT'));
  }
  assert.deepEqual(document, original, 'validation and simulation must preserve the rejected input for recovery');
});
