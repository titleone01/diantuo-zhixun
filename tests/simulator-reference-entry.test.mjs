import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({
  stdin: { contents: `export * from './app/simulator/core/reference-entry';export * from './app/simulator/core/reference-drawings';`, resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
});
const { parseReferenceEntry, resolveReferenceEntry, REFERENCE_DRAWINGS } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

const existingWire = { id: 'existing-wire', from: { componentId: 'source', terminalId: 'L1' }, to: { componentId: 'qf', terminalId: 'L1' }, color: '#ff0000' };
const context = overrides => ({ requestedId: 32, currentDocument: { referenceDiagramId: 13, wires: [] }, hasRecovery: false, dirty: false, saved: null, ...overrides });

test('reference entry accepts the 18 public IDs only on the simulator entry paths', () => {
  for (const { id } of REFERENCE_DRAWINGS) {
    for (const path of ['/', '/circuit', '/circuit/']) assert.deepEqual(parseReferenceEntry(path, `?diagram=${id}`), { kind: 'reference', id });
  }
  assert.deepEqual(parseReferenceEntry('/circuit', '?diagram=%31%33&unrelated=ignored'), { kind: 'reference', id: 13 });
  for (const path of ['/gallery', '/drawings', '/invite', '/circuit/private', '//circuit', 'https://other.invalid/circuit']) assert.deepEqual(parseReferenceEntry(path, '?diagram=13'), { kind: 'none' });
  for (const search of ['', '?q=test', '?diagramId=13']) assert.deepEqual(parseReferenceEntry('/circuit', search), { kind: 'none' });
});

test('duplicate, empty, unknown and non-canonical diagram IDs never silently select a different circuit', () => {
  for (const search of ['?diagram', '?diagram=', '?diagram=13&diagram=14', '?diagram=13&diagram=13', '?diagram=999', '?diagram=0', '?diagram=-13', '?diagram=13.0', '?diagram=1e1', '?diagram=013', '?diagram=%2013', '?diagram=13%20', '?diagram=0xd', '?diagram=NaN', '?diagram=Infinity', '?diagram=9007199254740993', '?diagram=../13', '?diagram=https://other.invalid']) {
    assert.deepEqual(parseReferenceEntry('/circuit', search), { kind: 'invalid' }, search);
  }
});

test('refreshing the same reference preserves restored wires and every document field without mutation', () => {
  const currentDocument = { referenceDiagramId: 32, title: '已接到一半', wires: [existingWire], components: [{ id: 'source', position: { x: 143, y: 219 } }], roles: { source: 'source' } };
  const snapshot = structuredClone(currentDocument);
  for (const dirty of [false, true]) for (const saved of [null, { id: 'server-draft' }]) {
    assert.equal(resolveReferenceEntry(context({ currentDocument, hasRecovery: true, dirty, saved })), 'preserve');
    assert.deepEqual(currentDocument, snapshot);
  }
});

test('a different entry requires confirmation for dirty work or the only recovered wired copy', () => {
  assert.equal(resolveReferenceEntry(context({ dirty: true })), 'confirm');
  assert.equal(resolveReferenceEntry(context({ dirty: true, saved: { id: 'server-draft' } })), 'confirm');
  assert.equal(resolveReferenceEntry(context({ hasRecovery: true, currentDocument: { wires: [existingWire] } })), 'confirm');
  assert.equal(resolveReferenceEntry(context({ hasRecovery: true, currentDocument: { referenceDiagramId: 13, wires: [existingWire] } })), 'confirm');
});

test('an entry applies to a fresh workspace, an empty recovery, or clean already-saved work', () => {
  assert.equal(resolveReferenceEntry(context()), 'apply');
  assert.equal(resolveReferenceEntry(context({ hasRecovery: true })), 'apply');
  assert.equal(resolveReferenceEntry(context({ currentDocument: { wires: [existingWire] } })), 'apply', 'the app starter is not a restored user draft');
  assert.equal(resolveReferenceEntry(context({ hasRecovery: true, currentDocument: { wires: [existingWire] }, saved: { id: 'server-draft' } })), 'apply');
});
