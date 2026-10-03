import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['app/simulator/api.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { api, ApiError, API_TIMEOUT_MS } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('API rejects malformed success responses instead of acknowledging a save', async t => {
  for (const body of ['<html>proxy unavailable</html>', 'null', '[]', '"ok"']) {
    t.mock.method(globalThis, 'fetch', async () => new Response(body));
    await assert.rejects(api('/circuits'), error => error instanceof ApiError && error.status === 502 && error.code === 'INVALID_RESPONSE');
    t.mock.restoreAll();
  }
});

test('API preserves HTTP status for malformed failures and structured server errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Bad Gateway', { status: 503 }));
  await assert.rejects(api('/session'), { status: 503, code: 'INVALID_RESPONSE' });
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: '草稿已更新', code: 'CONFLICT' }, { status: 409 }));
  await assert.rejects(api('/circuits/draft'), { status: 409, code: 'CONFLICT', message: '草稿已更新' });
});

test('API accepts Headers and tuple headers and leaves multipart boundary to fetch', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push({ url, init }); return Response.json({ ok: true }); });
  assert.deepEqual(await api('/session', { headers: new Headers({ 'X-Check': 'headers' }) }), { ok: true });
  await api('/circuits', { headers: [['X-Check', 'tuples'], ['Content-Type', 'application/custom']] });
  await api('/media', { method: 'POST', body: new FormData() });
  assert.equal(calls[0].init.headers.get('X-Check'), 'headers');
  assert.equal(calls[0].init.headers.get('Content-Type'), 'application/json');
  assert.equal(calls[1].init.headers.get('X-Check'), 'tuples');
  assert.equal(calls[1].init.headers.get('Content-Type'), 'application/custom');
  assert.equal(calls[2].init.headers.has('Content-Type'), false);
  assert.equal(calls[0].init.credentials, 'same-origin');
});

test('API deadline covers stalled response bodies and does not retry mutations', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetchMock = t.mock.method(globalThis, 'fetch', async (_url, { signal }) => ({ ok: true, status: 200, json: () => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) }));
  const request = api('/circuits', { method: 'POST', body: '{}' });
  const rejected = assert.rejects(request, { status: 408, code: 'REQUEST_TIMEOUT' });
  await Promise.resolve();
  t.mock.timers.tick(API_TIMEOUT_MS);
  await rejected;
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('API propagates caller cancellation and cleans the completed request deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requestSignal;
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => { requestSignal = signal; signal.throwIfAborted(); return Response.json({ ok: true }); });
  const cancelled = new AbortController(); cancelled.abort(new Error('caller cancelled'));
  await assert.rejects(api('/session', { signal: cancelled.signal }), /caller cancelled/);
  const completed = new AbortController();
  await api('/session', { signal: completed.signal });
  completed.abort();
  t.mock.timers.tick(API_TIMEOUT_MS);
  assert.equal(requestSignal.aborted, false);
});
