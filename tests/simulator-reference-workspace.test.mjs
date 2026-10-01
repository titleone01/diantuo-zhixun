import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `export * from './app/simulator/core/reference-workspace'; export * from './app/simulator/core/reference-drawings'; export * from './app/simulator/core/validation'; export * from './app/simulator/core/lessons';`, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
const { selectReferenceDrawing, createReferenceDocument, REFERENCE_DRAWINGS, validateDocument, createLessonDocument } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('all reference drawings open the same seven unconnected objects without inheriting course claims', () => {
  for (const { id, title } of REFERENCE_DRAWINGS) {
    const document = createReferenceDocument(id);
    assert.equal(document.title, title);
    assert.equal(document.referenceDiagramId, id);
    assert.deepEqual(document.components.map(item => item.type), ['supply', 'knife-switch3', 'fuse3', 'contactor380', 'motor', 'fuse', 'push-nc']);
    assert.equal(document.wires.length, 0);
    assert.equal(document.lessonId, undefined);
    assert.equal(document.roles, undefined);
    const check = validateDocument(document);
    assert.equal(check.valid, true, check.errors.join(';'));
  }
  const first = createReferenceDocument(32), second = createReferenceDocument(32);
  first.components[0].position.x = 999;
  assert.equal(second.components[0].position.x, 0, 'new workspaces must not share mutable instances');
});

test('selecting a new reference preserves every wire and component and strips stale lesson and private media context', () => {
  const document = { ...createLessonDocument('motor-self-hold', { wired: true }), drawingMediaId: 'private-image', drawingMediaType: 'image/png', projectDrawings: { schematic: { mediaId: 'private-image', type: 'image/png' } }, drawingKind: 'schematic', trainingProjectId: 'formal-project' };
  const before = JSON.stringify(document);
  const next = selectReferenceDrawing(document, 32);
  assert.equal(JSON.stringify(document), before, 'the prior version stays available to undo');
  assert.equal(next.components, document.components);
  assert.equal(next.wires, document.wires);
  assert.equal(next.title, document.title);
  for (const key of ['lessonId', 'roles', 'drawingMediaId', 'drawingMediaType', 'projectDrawings', 'drawingKind', 'trainingProjectId']) assert.equal(key in next, false);
  assert.equal(next.referenceDiagramId, 32);
  assert.equal(validateDocument(next).valid, true);
  assert.equal(selectReferenceDrawing(next, 32), next, 'selecting the same reference is an electrical no-op');
  assert.throws(() => selectReferenceDrawing(document, 99999));
});
