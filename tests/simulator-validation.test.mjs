import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  stdin: { contents: 'export * from "./app/simulator/core/validation";export * from "./app/simulator/core/engine";export * from "./app/simulator/core/lessons";export { validatedDocument } from "./app/server/content";', resolveDir: process.cwd() },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
});
const { validateDocument, validatedDocument, simulate, createLessonDocument } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const malformedObject = () => JSON.parse('{"toString":null,"valueOf":null}');
const mutations = [
  ['null component', document => document.components.push(null)],
  ['null wire', document => document.wires.push(null)],
  ['prototype component ID', document => { document.components[0].id = '__proto__'; }],
  ['constructor component ID', document => { document.components[0].id = 'constructor'; }],
  ['prototype role key', document => { document.roles = JSON.parse('{"__proto__":"km"}'); }],
  ['NaN coordinate', document => { document.components[0].position.x = NaN; }],
  ['unknown position key', document => { document.components[0].position.z = 0; }],
  ['infinite waypoint', document => { document.wires[0].waypoints = [{ x: Infinity, y: 1 }]; }],
  ['unknown waypoint key', document => { document.wires[0].waypoints = [{ x: 1, y: 2, z: 0 }]; }],
  ['unknown from reference key', document => { document.wires[0].from.alias = 'future-terminal'; }],
  ['unknown to reference key', document => { document.wires[0].to.alias = 'future-terminal'; }],
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
  assert.throws(() => validatedDocument(document), error => error.status === 400 && error.code === 'INVALID_DOCUMENT');
  for (const action of [undefined, { type: 'advance-time', ms: 1 }, { type: 'press', componentId: 'start' }]) {
    const result = simulate(document, undefined, action);
    assert.equal(result.supported, false);
    assert.ok(result.diagnostics.every(item => item.code === 'INVALID_DOCUMENT'));
  }
  assert.deepEqual(document, original, 'validation and simulation must preserve the rejected input for recovery');
});

function freezeDocument(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDocument(child);
    Object.freeze(value);
  }
  return value;
}

for (const routing of [undefined, 'duct']) test(`legacy duct style normalizes without changing frozen input (routing ${routing})`, () => {
  const document = createLessonDocument('motor-jog', { wired: true });
  document.extension = { ownerHint: 'preserved' };
  document.components[0].extension = { revision: 2 };
  document.wires[0] = {
    ...document.wires[0], style: 'duct', ...(routing === undefined ? {} : { routing }),
    waypoints: [{ x: -12, y: 0 }, { x: 120, y: 240 }], extension: { source: 'legacy' },
  };
  document.wires[1] = { ...document.wires[1], style: 'curve' };
  const original = structuredClone(document);
  freezeDocument(document);
  const checked = validateDocument(document);
  assert.equal(checked.valid, true);
  assert.deepEqual(checked.errors, []);
  assert.notEqual(checked.document, document);
  assert.notEqual(checked.document.wires, document.wires);
  assert.notEqual(checked.document.wires[0], document.wires[0]);
  assert.deepEqual(checked.document, {
    ...original, wires: original.wires.map((wire, index) => index === 0 ? { ...wire, style: 'orthogonal', routing: 'duct' } : wire),
  }, 'the returned document must contain the normalized wire and retain all other data');
  assert.equal(checked.document.wires[1], document.wires[1], 'ordinary wires need no rewrite');
  assert.deepEqual(document, original, 'legacy normalization must never alter the source document');
  const rechecked = validateDocument(checked.document);
  assert.equal(rechecked.valid, true);
  assert.equal(rechecked.document, checked.document, 'normalized documents remain stable across reloads');
  const saved = validatedDocument(document);
  assert.deepEqual(saved.document, checked.document, 'server saves use the canonical boundary output');
  assert.deepEqual(JSON.parse(saved.serialized), checked.document, 'serialized persistence excludes the legacy style');
  assert.deepEqual(document, original, 'server validation must preserve the original imported input');
});

for (const style of [undefined, 'orthogonal', 'straight', 'curve']) {
  for (const routing of [undefined, 'duct']) test(`ordinary style ${style} and routing ${routing} remain unchanged`, () => {
    const document = createLessonDocument('motor-jog', { wired: true });
    delete document.wires[0].style;
    if (style !== undefined) document.wires[0].style = style;
    if (routing !== undefined) document.wires[0].routing = routing;
    document.extension = { version: 2 };
    document.components[0].extension = { future: true };
    document.wires[0].extension = { future: true };
    const original = structuredClone(document);
    freezeDocument(document);
    const checked = validateDocument(document);
    assert.equal(checked.valid, true);
    assert.equal(checked.document, document);
    assert.deepEqual(checked.document, original);
  });
}

for (const style of [undefined, 'orthogonal', 'straight', 'curve', 'duct']) test(`unknown routing is rejected even with style ${style}`, () => {
  const document = createLessonDocument('motor-jog', { wired: true });
  document.wires[0].style = style;
  document.wires[0].routing = 'future-routing';
  const original = structuredClone(document);
  const checked = validateDocument(freezeDocument(document));
  assert.equal(checked.valid, false);
  assert.equal(checked.document, undefined, 'rejected routing must never return a persistence candidate');
  assert.ok(checked.errors.some(error => error.includes('自动走线模式无效')));
  assert.throws(() => validatedDocument(document), error => error.status === 400 && error.code === 'INVALID_DOCUMENT');
  assert.deepEqual(document, original);
});

test('legacy style does not bypass endpoint, waypoint or ordinary style validation', () => {
  for (const mutate of [
    document => { document.wires[0].from.terminalId = 'missing'; },
    document => { document.wires[0].to.alias = 'future-terminal'; },
    document => { document.wires[0].waypoints = [{ x: 1, y: 2, z: 3 }]; },
    document => { document.wires[1].style = 'future-style'; },
  ]) {
    const document = createLessonDocument('motor-jog', { wired: true });
    document.wires[0].style = 'duct';
    mutate(document);
    const original = structuredClone(document);
    const checked = validateDocument(freezeDocument(document));
    assert.equal(checked.valid, false);
    assert.equal(checked.document, undefined);
    assert.ok(checked.errors.length > 0);
    assert.throws(() => validatedDocument(document), error => error.status === 400 && error.code === 'INVALID_DOCUMENT');
    assert.deepEqual(document, original);
  }
});
