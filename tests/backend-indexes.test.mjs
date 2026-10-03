import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

test('publication lookup migration preserves records and indexes actual gallery and authorization predicates', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const name of ['0001_members.sql', '0002_member_status.sql', '0003_training_drawings.sql', '0004_training_drawing_kinds.sql']) {
      db.exec(await readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8'));
    }
    db.exec("INSERT INTO user(id,name,email,username,createdAt,updatedAt) VALUES('a','A','a@test.invalid','member_a',1,1)");
    db.exec("INSERT INTO publications(id,circuitId,ownerId,title,document,sourceRevision,createdAt) VALUES('p','c','a','Saved snapshot','{}',1,1)");
    db.exec("INSERT INTO media(id,ownerId,objectKey,name,type,size,createdAt) VALUES('m','a','object','drawing.png','image/png',42,1)");
    db.exec("INSERT INTO publication_media(publicationId,mediaId) VALUES('p','m'); INSERT INTO reactions(userId,publicationId,kind,createdAt) VALUES('a','p','like',1),('a','p','favorite',1)");
    const snapshot = () => ['user', 'publications', 'media', 'publication_media', 'reactions'].map(table => db.prepare(`SELECT * FROM ${table}`).all());
    const before = snapshot();
    const migration = await readFile(new URL('../db/migrations/0005_publication_lookup_indexes.sql', import.meta.url), 'utf8');
    db.exec(migration);
    db.exec(migration);
    assert.deepEqual(snapshot(), before);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const countQuery = "SELECT count(*) count FROM reactions WHERE publicationId=? AND kind='like'";
    const authorizationQuery = 'SELECT 1 FROM publication_media WHERE mediaId=?';
    const plan = (sql, parameter) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(parameter).map(row => row.detail).join('\n');
    assert.match(plan(countQuery, 'p'), /SEARCH reactions USING COVERING INDEX reactions_publication_kind/);
    assert.match(plan(authorizationQuery, 'm'), /SEARCH publication_media USING COVERING INDEX publication_media_media/);
    assert.equal(db.prepare(countQuery).get('p').count, 1);
    assert.ok(db.prepare(authorizationQuery).get('m'));
    assert.equal(db.prepare(authorizationQuery).get('absent'), undefined);
  } finally { db.close(); }
});
