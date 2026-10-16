import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { parse } from 'acorn';

const bundle = await build({ stdin: { contents: `export * from './app/simulator/browser-runtime';export {default as Editor} from './app/simulator/editor/SimulatorEditor';export {createLessonDocument,DEFAULT_LESSON_ID} from './app/simulator/core/lessons';export {renderToStaticMarkup} from 'react-dom/server';export {createElement} from 'react';`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent', loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' }, banner: { js: 'import {createRequire} from "node:module";const require=createRequire(process.cwd()+"/package.json");' } });
const { installBrowserRuntime, cloneCircuitDocument, Editor, createLessonDocument, DEFAULT_LESSON_ID, renderToStaticMarkup, createElement } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('the startup guidance parses as ES5 for IE and old Edge', async () => {
  const source = await readFile('public/sim-assets/startup.js', 'utf8');
  assert.doesNotThrow(() => parse(source, { ecmaVersion: 5 }));
});

test('the real editor renders when Array.at is absent, retaining native behavior when available', () => {
  const original = Object.getOwnPropertyDescriptor(Array.prototype, 'at');
  const document = createLessonDocument(DEFAULT_LESSON_ID, { wired: true });
  const render = () => renderToStaticMarkup(createElement(Editor, { document, documentKey: 'compatibility', onDocumentChange() {} }));
  try {
    delete Array.prototype.at;
    assert.throws(render, /\.at is not a function/);
    installBrowserRuntime();
    assert.match(render(), /电路接线画布/);
    assert.equal([1, 2, 3].at(-1), 3);
    assert.equal([1, 2, 3].at(-2), 2);
    assert.equal([1, 2, 3].at(-4), undefined);
    assert.equal([1].at(Infinity), undefined);
  } finally { Object.defineProperty(Array.prototype, 'at', original); }
  installBrowserRuntime(); assert.equal(Array.prototype.at, original.value);
});

test('older clients use secure random UUIDs without Math.random', () => {
  const source = globalThis.crypto, original = Object.getOwnPropertyDescriptor(source, 'randomUUID');
  const random = Math.random;
  try {
    Object.defineProperty(source, 'randomUUID', { configurable: true, value: undefined });
    Math.random = () => { throw Error('Weak random source used'); };
    installBrowserRuntime();
    const ids = Array.from({ length: 20 }, () => source.randomUUID());
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally { Math.random = random; if (original) Object.defineProperty(source, 'randomUUID', original); else delete source.randomUUID; }
});

test('document clone fallback preserves manual labels, routing and independent snapshots', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone');
  const document = createLessonDocument(DEFAULT_LESSON_ID, { wired: true });
  const strip = document.components.find(component => component.type === 'terminal-strip16');
  strip.terminalLabels = { 1: 'U1', 5: 'PE' }; document.wires[0].wireNumber = '0';
  try {
    Object.defineProperty(globalThis, 'structuredClone', { configurable: true, value: undefined });
    const clone = cloneCircuitDocument(document);
    assert.deepEqual(clone, JSON.parse(JSON.stringify(document)));
    clone.components.find(component => component.id === strip.id).terminalLabels[1] = 'changed';
    clone.wires[0].wireNumber = '9';
    assert.equal(strip.terminalLabels[1], 'U1'); assert.equal(document.wires[0].wireNumber, '0');
    assert.equal(globalThis.structuredClone, undefined);
  } finally { Object.defineProperty(globalThis, 'structuredClone', original); }
});
