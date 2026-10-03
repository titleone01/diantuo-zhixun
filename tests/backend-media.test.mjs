import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: ['app/server/media.ts'], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
const { uploadMedia, downloadMedia } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlFQAAAAASUVORK5CYII=', 'base64');
const member = { id: 'media-test-member' };

function uploadRequest(payload, type = 'image/png') {
  const form = new FormData();
  form.set('file', new File([payload], 'test.png', { type }));
  return new Request('http://localhost/api/media', { method: 'POST', body: form });
}

function uploadEnv(databaseError) {
  const writes = [];
  const env = {
    MEDIA: {
      async put(key, payload) { writes.push({ operation: 'put', key, payload }); },
      async delete(key) { writes.push({ operation: 'delete', key }); },
    },
    DB: { prepare() { return { bind(...values) { this.values = values; return this; }, async run() {
      writes.push({ operation: 'insert', values: this.values });
      if (databaseError) throw databaseError;
      return { meta: { changes: 1 } };
    } }; } },
  };
  return { env, writes };
}

test('malformed multipart returns a client error and never writes storage', async () => {
  for (const contentType of ['multipart/form-data', 'multipart/form-data; boundary=missing']) {
    const { env, writes } = uploadEnv();
    await assert.rejects(() => uploadMedia(env, member, new Request('http://localhost/api/media', {
      method: 'POST', headers: { 'content-type': contentType }, body: 'not a multipart body',
    })), error => error.status === 400 && error.code === 'INVALID_MULTIPART');
    assert.deepEqual(writes, []);
  }
});

test('PNG uploads require all eight signature bytes before storage', async () => {
  for (const invalid of [png.subarray(0, 4), png.subarray(0, 7), Buffer.from([137, 80, 78, 71, 0, 0, 0, 0])]) {
    const { env, writes } = uploadEnv();
    await assert.rejects(() => uploadMedia(env, member, uploadRequest(invalid)), error => error.status === 415 && error.code === 'UNSUPPORTED_FILE');
    assert.deepEqual(writes, []);
  }
  const { env, writes } = uploadEnv();
  const response = await uploadMedia(env, member, uploadRequest(png));
  assert.equal(response.status, 201);
  assert.deepEqual(writes.map(item => item.operation), ['put', 'insert']);
  assert.deepEqual(Buffer.from(writes[0].payload), png);
  assert.equal((await response.json()).media.size, png.length);
});

test('failed media metadata insert compensates by deleting only the newly uploaded object', async () => {
  const databaseError = new Error('test database unavailable');
  const { env, writes } = uploadEnv(databaseError);
  await assert.rejects(() => uploadMedia(env, member, uploadRequest(png)), error => error === databaseError);
  assert.deepEqual(writes.map(item => item.operation), ['put', 'insert', 'delete']);
  assert.equal(writes[2].key, writes[0].key);
  assert.ok(writes[0].key.startsWith(`${member.id}/`));
});

test('media authorization precedes object access, and missing objects return 404', async () => {
  let objectReads = 0;
  let row = null;
  const env = {
    DB: { prepare() { return { bind() { return this; }, async first() { return row; } }; } },
    MEDIA: { async get() { objectReads++; return null; } },
  };
  const request = new Request('http://localhost/api/media/test');
  await assert.rejects(() => downloadMedia(env, member, 'test', request), error => error.status === 404);
  assert.equal(objectReads, 0);
  row = { objectKey: 'missing', type: 'image/png', name: 'test.png', size: png.length };
  await assert.rejects(() => downloadMedia(env, member, 'test', request), error => error.status === 404);
  assert.equal(objectReads, 1);
});

test('media ranges preserve exact bytes and reject invalid ranges before object access', async () => {
  let objectReads = 0;
  const env = {
    DB: { prepare() { return { bind() { return this; }, async first() { return { objectKey: 'test', type: 'image/png', name: 'test.png', size: png.length }; } }; } },
    MEDIA: { async get(_key, options) {
      objectReads++;
      const range = options?.range;
      const payload = range ? png.subarray(range.offset, range.offset + range.length) : png;
      return { size: png.length, body: new Blob([payload]).stream() };
    } },
  };
  for (const value of ['bytes=0-7', 'bytes=-8', 'bytes=8-', 'bytes=0-999']) {
    const response = await downloadMedia(env, member, 'test', new Request('http://localhost/api/media/test', { headers: { range: value } }));
    assert.equal(response.status, 206);
    const expected = value === 'bytes=0-7' ? png.subarray(0, 8) : value === 'bytes=-8' ? png.subarray(-8) : value === 'bytes=8-' ? png.subarray(8) : png;
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
    assert.equal(Number(response.headers.get('content-length')), expected.length);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  const beforeInvalid = objectReads;
  for (const value of ['bytes=-0', 'bytes=9-2', 'bytes=999-', 'bytes=0-1,4-5', 'bytes=-', 'bytes=9007199254740992-']) {
    const response = await downloadMedia(env, member, 'test', new Request('http://localhost/api/media/test', { headers: { range: value } }));
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), `bytes */${png.length}`);
  }
  assert.equal(objectReads, beforeInvalid);
});
