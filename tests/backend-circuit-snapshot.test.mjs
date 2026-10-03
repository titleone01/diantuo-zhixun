import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: ['app/server/content.ts'], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { getCircuit } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const migration = await readFile(new URL('../db/migrations/0001_members.sql', import.meta.url), 'utf8');

function fixture(afterFirstRead) {
  const db = new DatabaseSync(':memory:');
  db.exec(migration);
  db.exec("INSERT INTO user(id,name,email,username,createdAt,updatedAt) VALUES('a','A','a@test.invalid','member_a',1,1),('b','B','b@test.invalid','member_b',1,1)");
  db.exec("INSERT INTO media(id,ownerId,objectKey,name,type,size,createdAt) VALUES('old','a','old','old.png','image/png',42,1),('new','a','new','new.png','image/png',43,1)");
  db.prepare('INSERT INTO circuits(id,ownerId,title,document,revision,createdAt,updatedAt) VALUES(?,?,?,?,1,1,1)').run('c', 'a', 'version one', JSON.stringify({ drawingMediaId: 'old' }));
  db.exec("INSERT INTO circuit_media(circuitId,mediaId) VALUES('c','old')");
  let firstRead = true;
  const env = { DB: { prepare(sql) {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first() {
        const row = db.prepare(sql).get(...values) ?? null;
        if (firstRead) { firstRead = false; afterFirstRead?.(db); }
        return row;
      },
      async all() { return { results: db.prepare(sql).all(...values) }; },
    };
  } } };
  return { db, env };
}

test('a save between awaited reads cannot mix document/revision with newer attachments', async () => {
  const { db, env } = fixture(database => {
    database.exec('BEGIN');
    database.prepare("UPDATE circuits SET title='version two',document=?,revision=2 WHERE id='c'").run(JSON.stringify({ drawingMediaId: 'new' }));
    database.exec("DELETE FROM circuit_media WHERE circuitId='c'; INSERT INTO circuit_media(circuitId,mediaId) VALUES('c','new'); COMMIT");
  });
  try {
    const earlier = await getCircuit(env, { id: 'a' }, 'c');
    assert.equal(earlier.revision, 1);
    assert.equal(earlier.title, 'version one');
    assert.equal(earlier.document.drawingMediaId, 'old');
    assert.deepEqual(earlier.mediaIds, ['old']);
    const latest = await getCircuit(env, { id: 'a' }, 'c');
    assert.equal(latest.revision, 2);
    assert.equal(latest.document.drawingMediaId, 'new');
    assert.deepEqual(latest.mediaIds, ['new']);
  } finally { db.close(); }
});

test('a concurrent delete does not strip attachments from the draft already read', async () => {
  const { db, env } = fixture(database => database.exec("DELETE FROM circuits WHERE id='c'"));
  try {
    const snapshot = await getCircuit(env, { id: 'a' }, 'c');
    assert.equal(snapshot.document.drawingMediaId, 'old');
    assert.deepEqual(snapshot.mediaIds, ['old']);
    await assert.rejects(() => getCircuit(env, { id: 'a' }, 'c'), error => error.status === 404);
  } finally { db.close(); }
});

test('draft reads preserve owner isolation, explicit extra attachments and empty lists', async () => {
  const { db, env } = fixture();
  try {
    await assert.rejects(() => getCircuit(env, { id: 'b' }, 'c'), error => error.status === 404);
    await assert.rejects(() => getCircuit(env, { id: 'a' }, 'missing'), error => error.status === 404);
    db.exec("INSERT INTO circuit_media(circuitId,mediaId) VALUES('c','new')");
    assert.deepEqual((await getCircuit(env, { id: 'a' }, 'c')).mediaIds.sort(), ['new', 'old']);
    db.exec("DELETE FROM circuit_media WHERE circuitId='c'");
    assert.deepEqual((await getCircuit(env, { id: 'a' }, 'c')).mediaIds, []);
  } finally { db.close(); }
});
