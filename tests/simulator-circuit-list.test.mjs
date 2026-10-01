import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const bundled = await build({
  stdin: { contents: `export * from './app/server/circuit-list';export * from './app/server/api';`, resolveDir: process.cwd() },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  plugins: [{ name: 'circuit-member-gate', setup(build) {
    // Test the real route and SQL; live authentication has its own integration suite.
    build.onResolve({ filter: /^\.\/auth$/ }, args => args.importer.replaceAll('\\', '/').includes('/app/server/') ? { path: 'auth', namespace: 'circuit-test' } : null);
    build.onLoad({ filter: /.*/, namespace: 'circuit-test' }, () => ({ contents: 'export const createAuth=()=>{throw new Error("Unexpected auth route")};export const readMember=async(env,request)=>env.members[request.headers.get("x-test-member")]??null;' }));
  } }],
});
const { circuitListOptions, listCircuits, handleApi } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const migration = await readFile(new URL('../db/migrations/0001_members.sql', import.meta.url), 'utf8');
const search = values => new URLSearchParams(values);

function fixture() {
  const db = new DatabaseSync(':memory:'); db.exec(migration);
  db.exec("INSERT INTO user(id,name,email,username,createdAt,updatedAt) VALUES('a','A','a@test.invalid','member_a',1,1),('b','B','b@test.invalid','member_b',1,1)");
  const insert = db.prepare('INSERT INTO circuits(id,ownerId,title,document,revision,createdAt,updatedAt) VALUES(?,?,?,?,1,1,?)');
  for (let index = 1; index <= 207; index++) {
    const title = index === 2 ? '100%_字面量' : index === 3 ? '路径\\分支' : index === 4 ? 'older-needle-only' : `草稿 ${index}`;
    insert.run(`a${String(index).padStart(3, '0')}`, 'a', title, JSON.stringify({ title: 'document-only-needle', wires: [1, 2, 3] }), index === 1 ? 2000 : 1000);
  }
  for (let index = 1; index <= 9; index++) insert.run(`b${index}`, 'b', index === 1 ? 'older-needle-only' : '其他成员独占词', '{}', 3000);
  let queries = 0;
  const env = { members: { a: { id: 'a', role: 'member' }, b: { id: 'b', role: 'member' } }, DB: { prepare(sql) {
    queries++; let values = [];
    return { bind(...args) { values = args; return this; }, async first() { return db.prepare(sql).get(...values) ?? null; }, async all() { return { results: db.prepare(sql).all(...values) }; } };
  } } };
  return { db, env, queries: () => queries };
}

test('default private list stays compatible at 200 items and exposes the remaining pages', async () => {
  const { db, env, queries } = fixture();
  try {
    const first = await listCircuits(env, { id: 'a' }, search());
    assert.equal(first.items.length, 200); assert.equal(first.pageSize, 200);
    assert.equal(first.page, 1); assert.equal(first.total, 207); assert.equal(first.totalPages, 2);
    assert.deepEqual(Object.keys(first.items[0]).sort(), ['id', 'title', 'revision', 'forkedFrom', 'createdAt', 'updatedAt'].sort());
    const second = await listCircuits(env, { id: 'a' }, search({ page: 2 }));
    assert.equal(second.items.length, 7); assert.equal(second.total, 207);
    assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 207);
    assert.equal(queries(), 4, 'two statements per page, with no per-document fetches');
  } finally { db.close(); }
});

test('all pages preserve updatedAt then ID order and cannot include another member’s drafts', async () => {
  const { db, env } = fixture();
  try {
    const seen = [];
    for (let page = 1; page <= 26; page++) {
      const result = await listCircuits(env, { id: 'a' }, search({ page, pageSize: 8, ownerId: 'b' }));
      assert.equal(result.page, page); assert.equal(result.total, 207); assert.equal(result.totalPages, 26);
      assert.ok(result.items.every(item => item.id.startsWith('a')));
      seen.push(...result.items.map(item => item.id));
    }
    const expected = ['a001', ...Array.from({ length: 206 }, (_, index) => `a${String(207-index).padStart(3, '0')}`)];
    assert.deepEqual(seen, expected);
    const other = await listCircuits(env, { id: 'b' }, search({ pageSize: 12 }));
    assert.equal(other.total, 9); assert.ok(other.items.every(item => item.id.startsWith('b')));
  } finally { db.close(); }
});

test('title search reaches older drafts, escapes LIKE metacharacters and retains owner isolation', async () => {
  const { db, env } = fixture();
  try {
    const find = query => listCircuits(env, { id: 'a' }, search({ q: query, pageSize: 8 }));
    assert.deepEqual((await find('older-needle-only')).items.map(item => item.id), ['a004']);
    for (const literal of ['%', '_', '%_']) assert.deepEqual((await find(literal)).items.map(item => item.id), ['a002']);
    assert.deepEqual((await find('\\')).items.map(item => item.id), ['a003']);
    for (const query of ['其他成员独占词', 'document-only-needle', "%' OR 1=1 --"]) assert.equal((await find(query)).total, 0);
    const trimmed = await find('  older-needle-only  '); assert.equal(trimmed.query, 'older-needle-only'); assert.equal(trimmed.total, 1);
  } finally { db.close(); }
});

test('invalid pagination and oversized search are rejected before SQL, while legal large pages clamp', async () => {
  for (const values of [{ page: 0 }, { page: -1 }, { page: 1.5 }, { page: '1e2' }, { page: '' }, { page: 100001 }, { pageSize: 0 }, { pageSize: 201 }, { pageSize: 'NaN' }, { pageSize: 'Infinity' }, { q: 'a'.repeat(101) }]) {
    assert.throws(() => circuitListOptions(search(values)), error => error.status === 400);
  }
  const { db, env } = fixture();
  try {
    const last = await listCircuits(env, { id: 'a' }, search({ page: 100000, pageSize: 8 }));
    assert.equal(last.page, 26); assert.equal(last.totalPages, 26); assert.equal(last.items.length, 7);
    db.exec("DELETE FROM circuits WHERE ownerId='a' AND id<>'a001'");
    const afterDelete = await listCircuits(env, { id: 'a' }, search({ page: 26, pageSize: 8 }));
    assert.equal(afterDelete.page, 1); assert.equal(afterDelete.totalPages, 1); assert.equal(afterDelete.total, 1);
    const empty = await listCircuits(env, { id: 'a' }, search({ page: 99, pageSize: 12, q: 'nothing-matches' }));
    assert.equal(empty.page, 1); assert.equal(empty.totalPages, 1); assert.equal(empty.total, 0); assert.deepEqual(empty.items, []);
  } finally { db.close(); }
});

test('actual GET route gates membership and returns private metadata with pagination errors', async () => {
  const { db, env, queries } = fixture();
  try {
    const anonymous = await handleApi(new Request('http://localhost/api/circuits?pageSize=8'), env);
    assert.equal(anonymous.status, 401); assert.equal(queries(), 0);
    const request = suffix => new Request(`http://localhost/api/circuits${suffix}`, { headers: { 'x-test-member': 'b' } });
    const response = await handleApi(request('?ownerId=a&pageSize=8&page=2'), env);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const result = await response.json(); assert.equal(result.total, 9); assert.equal(result.items.length, 1);
    assert.ok(result.items[0].id.startsWith('b')); assert.equal('document' in result.items[0], false); assert.equal('ownerId' in result.items[0], false);
    const invalid = await handleApi(request('?pageSize=201'), env);
    assert.equal(invalid.status, 400); assert.equal((await invalid.json()).code, 'INVALID_PAGINATION');
  } finally { db.close(); }
});
