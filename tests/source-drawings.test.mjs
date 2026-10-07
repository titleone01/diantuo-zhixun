import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SOURCE_DRAWINGS, prepareSourceDrawings, verifySourceDrawings } from '../scripts/prepare-source-drawings.mjs';

test('authoritative drawings bind each of the ten courses to an original schematic and placement PNG', () => {
  assert.equal(SOURCE_DRAWINGS.entries.length, 20);
  assert.equal(new Set(SOURCE_DRAWINGS.entries.map(e => `${e.projectId}:${e.kind}`)).size, 20);
  for (let n = 1; n <= 10; n++) for (const kind of ['schematic', 'layout']) {
    const entry = SOURCE_DRAWINGS.entries.find(e => e.projectId === `project-${String(n).padStart(2,'0')}` && e.kind === kind);
    assert.ok(entry);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.ok(entry.size > 1000);
    assert.equal(path.basename(entry.file), entry.file);
    assert.ok(entry.file.endsWith(`${kind === 'schematic' ? '原理图' : '布局图'}.png`));
  }
});

test('missing or substituted source drawings fail before any collection is created', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'diantuo-source-drawings-'));
  const output = path.join(directory, 'must-not-exist');
  await assert.rejects(prepareSourceDrawings(directory, output), { code: 'ENOENT' });
  const first = SOURCE_DRAWINGS.entries[0];
  await writeFile(path.join(directory, first.file), Buffer.alloc(first.size));
  await assert.rejects(prepareSourceDrawings(directory, output), /original SHA-256 differs/);
  assert.deepEqual(await readdir(directory), [first.file]);
});

if (process.env.DIANTUO_SOURCE_DRAWINGS) test('the supplied complete source collection matches all twenty original byte hashes', async () => {
  const entries = await verifySourceDrawings(process.env.DIANTUO_SOURCE_DRAWINGS);
  assert.equal(entries.length, 20);
  assert.ok(entries.every(e => e.width > 0 && e.height > 0));
});
