import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, access } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const bundled = await build({
  stdin: { contents: `export * from './app/simulator/core/reference-drawings';export * from './app/simulator/core/types';export * from './app/simulator/core/validation';export * from './app/simulator/core/engine';export * from './app/simulator/reference-video/catalog';export * from './app/server/api';`, resolveDir: process.cwd() },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  plugins: [{ name: 'reference-member-gate', setup(build) {
    // Keep the actual router, validation, SQL and revision checks. Authentication
    // itself is exercised separately by the live two-account integration suite.
    build.onResolve({ filter: /^\.\/auth$/ }, args => args.importer.replaceAll('\\', '/').includes('/app/server/') ? { path: 'auth', namespace: 'reference-test' } : null);
    build.onLoad({ filter: /.*/, namespace: 'reference-test' }, () => ({ contents: 'export const createAuth=()=>{throw new Error("Unexpected auth route")};export const readMember=async(env,request)=>env.members[request.headers.get("x-test-member")]??null;' }));
  } }],
});
const { REFERENCE_DRAWINGS, getReferenceDrawing, referenceDrawingImageUrl, documentMediaIds, validateDocument, assessLesson, referenceVideoForDocument, referenceLessonForDocument, handleApi } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const migrations = await Promise.all(['0001_members.sql', '0002_member_status.sql', '0003_training_drawings.sql', '0004_training_drawing_kinds.sql'].map(name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8')));
const document = id => ({ schemaVersion: 1, title: '参考图接线练习', components: [], wires: [], ...(id === undefined ? {} : { referenceDiagramId: id }) });

function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const migration of migrations) db.exec(migration);
  db.exec("INSERT INTO user(id,name,email,username,createdAt,updatedAt) VALUES('a','A','a@test.invalid','member_a',1,1),('b','B','b@test.invalid','member_b',1,1)");
  db.exec("INSERT INTO media(id,ownerId,objectKey,name,type,size,createdAt) VALUES('private-a','a','private-a','a.png','image/png',42,1),('private-b','b','private-b','b.png','image/png',42,1)");
  const env = { members: { a: { id: 'a', role: 'member' }, b: { id: 'b', role: 'member' } }, DB: {
    prepare(sql) {
      let args = [];
      const execute = () => { const results = db.prepare(sql).all(...args); return { results, meta: { changes: db.prepare('SELECT changes() AS n').get().n } }; };
      return { bind(...values) { args = values; return this; }, async first() { return db.prepare(sql).get(...args) ?? null; }, async all() { return { results: db.prepare(sql).all(...args) }; }, async run() { return execute(); }, execute };
    },
    async batch(statements) {
      db.exec('BEGIN');
      try { const results = statements.map(statement => statement.execute()); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  } };
  const call = async (path, method = 'GET', body, member = 'a') => {
    const headers = { origin: 'http://localhost', 'content-type': 'application/json', ...(member ? { 'x-test-member': member } : {}) };
    const response = await handleApi(new Request(`http://localhost/api${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
    return { status: response.status, data: await response.json() };
  };
  return { db, call };
}

test('all 18 catalog images exist and use explicit base paths without a browser environment', async () => {
  assert.equal(REFERENCE_DRAWINGS.length, 18);
  assert.equal(new Set(REFERENCE_DRAWINGS.map(item => item.id)).size, 18);
  assert.equal(REFERENCE_DRAWINGS.filter(item => item.category === 'industrial').length, 16);
  for (const item of REFERENCE_DRAWINGS) {
    await access(new URL(`../public/sim-assets/${item.imageFilename}`, import.meta.url));
    assert.equal(referenceDrawingImageUrl(item.id), `/sim-assets/${item.imageFilename}`);
    assert.equal(referenceDrawingImageUrl(item.id, '/diantuo'), `/diantuo/sim-assets/${item.imageFilename}`);
    assert.equal(referenceDrawingImageUrl(item.id, '/diantuo/'), `/diantuo/sim-assets/${item.imageFilename}`);
    assert.equal(referenceVideoForDocument(document(item.id)).diagramId, item.id);
    assert.equal('lessonId' in item, false);
  }
  assert.equal(getReferenceDrawing(999), undefined);
  assert.equal(referenceDrawingImageUrl(999), undefined);
});

test('reference IDs round-trip without assigning a course, while malformed or mixed sources are rejected', () => {
  assert.equal(validateDocument(document()).valid, true, 'legacy documents stay valid');
  for (const item of REFERENCE_DRAWINGS) {
    const imported = JSON.parse(JSON.stringify(document(item.id)));
    assert.equal(validateDocument(imported).valid, true);
    assert.deepEqual(documentMediaIds(imported), []);
    assert.equal(imported.lessonId, undefined);
    assert.equal(assessLesson(imported).status, 'unsupported', 'reference identity never grants a course result');
  }
  for (const invalid of [0, -1, 999, 13.5, '13', null, NaN, Infinity, {}, []]) assert.equal(validateDocument({ ...document(), referenceDiagramId: invalid }).valid, false);
  for (const attachment of [{ drawingMediaId: 'private-a' }, { drawingMediaType: 'image/png' }, { drawingKind: 'schematic' }, { projectDrawings: {} }, { trainingProjectId: 'project-01' }]) assert.equal(validateDocument({ ...document(13), ...attachment }).valid, false);
  assert.equal(validateDocument({ ...document(13), lessonId: 'motor-jog' }).valid, true, 'an explicitly selected supported lesson remains independent');
});

test('exact reference video wins over a legacy lesson but never over private or project previews', () => {
  const value = { ...document(32), lessonId: 'motor-jog' };
  assert.equal(referenceVideoForDocument(value).diagramId, 32);
  assert.equal(referenceLessonForDocument(value), undefined);
  assert.equal(referenceVideoForDocument(value, true), undefined);
  assert.equal(referenceVideoForDocument({ ...value, referenceDiagramId: 999 }), undefined, 'unknown explicit IDs cannot fall back to another video');
  for (const attachment of [{ drawingMediaId: 'private-a' }, { drawingMediaType: 'image/png' }, { drawingKind: 'layout' }, { projectDrawings: {} }, { trainingProjectId: 'project-01' }]) assert.equal(referenceVideoForDocument({ ...value, ...attachment }), undefined);
  for (let index = 1; index <= 10; index++) assert.equal(referenceVideoForDocument({ lessonId: `motor-course-${String(index).padStart(2, '0')}` }), undefined);
  assert.equal(referenceVideoForDocument({ lessonId: 'motor-jog' }).diagramId, 13);
  assert.equal(referenceVideoForDocument(document(11)).url, null);
});

test('real save/read/publish/fork routes preserve reference snapshots and member ownership', async () => {
  const { db, call } = fixture();
  try {
    assert.equal((await call('/circuits', 'POST', { title: '未登录', document: document(32) }, null)).status, 401);
    for (const item of REFERENCE_DRAWINGS) {
      const result = await call('/circuits', 'POST', { title: item.title, document: document(item.id) });
      assert.equal(result.status, 201); assert.equal(result.data.circuit.document.referenceDiagramId, item.id);
    }
    const saved = (await call('/circuits', 'POST', { title: '原图32', document: document(32) })).data.circuit;
    assert.equal((await call(`/circuits/${saved.id}`, 'GET', undefined, 'b')).status, 404);
    const published = await call(`/circuits/${saved.id}/publish`, 'POST', { revision: saved.revision });
    assert.equal(published.status, 201); const publication = published.data.publication;
    assert.equal(publication.document.referenceDiagramId, 32); assert.deepEqual(publication.mediaIds, []);
    const updated = await call(`/circuits/${saved.id}`, 'PUT', { title: '现改为31', document: document(31), revision: saved.revision });
    assert.equal(updated.status, 200); assert.equal(updated.data.circuit.document.referenceDiagramId, 31);
    const publicSnapshot = await call(`/publications/${publication.id}`, 'GET', undefined, 'b');
    assert.equal(publicSnapshot.data.publication.document.referenceDiagramId, 32, 'publishing preserves the original snapshot');
    const copied = await call(`/publications/${publication.id}/fork`, 'POST', {}, 'b');
    assert.equal(copied.status, 201); assert.equal(copied.data.circuit.document.referenceDiagramId, 32);
    assert.equal(copied.data.circuit.forkedFrom, publication.id); assert.deepEqual(copied.data.circuit.mediaIds, []);
    assert.equal((await call(`/circuits/${copied.data.circuit.id}`)).status, 404, 'the original author does not own another member’s copy');
    assert.equal((await call(`/circuits/${saved.id}`, 'PUT', { title: '过期保存', document: document(14), revision: saved.revision })).status, 409);
  } finally { db.close(); }
});

test('switching from a private drawing to a reference drops hidden attachment inheritance before publishing', async () => {
  const { db, call } = fixture();
  try {
    const privateDocument = { ...document(), drawingMediaId: 'private-a', drawingMediaType: 'image/png' };
    const saved = (await call('/circuits', 'POST', { title: '私图草稿', document: privateDocument })).data.circuit;
    assert.deepEqual(saved.mediaIds, ['private-a']);
    const converted = await call(`/circuits/${saved.id}`, 'PUT', { title: '改为参考图', document: document(13), revision: saved.revision });
    assert.equal(converted.status, 200); assert.deepEqual(converted.data.circuit.mediaIds, []);
    assert.equal(db.prepare('SELECT count(*) n FROM circuit_media WHERE circuitId=?').get(saved.id).n, 0);
    const published = await call(`/circuits/${saved.id}/publish`, 'POST', { revision: converted.data.circuit.revision });
    assert.equal(published.status, 201); assert.deepEqual(published.data.publication.mediaIds, []);
    assert.equal(db.prepare('SELECT count(*) n FROM publication_media').get().n, 0);
    const copied = await call(`/publications/${published.data.publication.id}/fork`, 'POST', {}, 'b');
    assert.equal(copied.status, 201); assert.deepEqual(copied.data.circuit.mediaIds, []);
    assert.equal((await call('/media/private-a', 'GET', undefined, 'b')).status, 404, 'reference publication must not make the old private image readable');
    assert.equal(db.prepare('SELECT count(*) n FROM media WHERE id=?').get('private-a').n, 1, 'the old attachment object remains intact');
  } finally { db.close(); }
});

test('malformed references and explicit or stored hidden attachments cannot be saved, published or copied', async () => {
  const { db, call } = fixture();
  try {
    for (const invalid of [{ document: document(999) }, { document: { ...document(13), trainingProjectId: 'project-01' } }, { document: document(13), mediaIds: ['private-a'] }, { document: document(13), mediaIds: ['private-b'] }]) {
      const result = await call('/circuits', 'POST', { title: '拒绝混用', ...invalid });
      assert.equal(result.status, 400);
    }
    assert.equal(db.prepare('SELECT count(*) n FROM circuits').get().n, 0);
    const saved = (await call('/circuits', 'POST', { title: '引用', document: document(32) })).data.circuit;
    db.prepare('INSERT INTO circuit_media(circuitId,mediaId) VALUES(?,?)').run(saved.id, 'private-a');
    const rejected = await call(`/circuits/${saved.id}/publish`, 'POST', { revision: saved.revision });
    assert.equal(rejected.status, 400); assert.equal(rejected.data.code, 'REFERENCE_MEDIA_CONFLICT');
    assert.equal(db.prepare('SELECT count(*) n FROM publications').get().n, 0);
    db.prepare("INSERT INTO publications(id,circuitId,ownerId,title,document,sourceRevision,createdAt) VALUES('legacy-mixed',?,'a','Mixed',?,1,1)").run(saved.id, JSON.stringify(document(32)));
    db.exec("INSERT INTO publication_media(publicationId,mediaId) VALUES('legacy-mixed','private-a')");
    const copied = await call('/publications/legacy-mixed/fork', 'POST', {}, 'b');
    assert.equal(copied.status, 400); assert.equal(copied.data.code, 'REFERENCE_MEDIA_CONFLICT');
    assert.equal(db.prepare("SELECT count(*) n FROM circuits WHERE ownerId='b'").get().n, 0);
  } finally { db.close(); }
});
