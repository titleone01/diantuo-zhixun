import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

const bundled = await build({
  stdin: { contents: 'export * from "./app/server/publication-list";export * from "./app/server/api";export * from "./app/simulator/gallery/route";', resolveDir: process.cwd() },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  plugins: [{ name: 'gallery-member-gate', setup(build) {
    // Authentication itself is covered by the live two-account integration
    // suite. These tests retain the real API router and all publication SQL.
    build.onResolve({ filter: /^\.\/auth$/ }, args => args.importer.replaceAll('\\', '/').endsWith('/app/server/api.ts') ? { path: 'auth', namespace: 'gallery-test' } : null);
    build.onLoad({ filter: /.*/, namespace: 'gallery-test' }, () => ({ contents: 'export const createAuth=()=>{throw new Error("Unexpected auth route")};export const readMember=async(env,request)=>env.members[request.headers.get("x-test-member")]??null;' }));
  } }],
});
const { listPublications, publicationListOptions, handleApi, galleryHref, galleryRouteFromSearch, galleryListPath } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const migrations = await Promise.all(['0001_members.sql', '0002_member_status.sql', '0003_training_drawings.sql', '0004_training_drawing_kinds.sql'].map(name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8')));

function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const migration of migrations) db.exec(migration);
  db.exec("INSERT INTO user(id,name,email,username,createdAt,updatedAt) VALUES('a','接线教师','a@test.invalid','teacher_a',1,1),('b','实训成员','b@test.invalid','member_b',1,1)");
  const document = { schemaVersion: 1, title: 'Snapshot', components: [], wires: [] };
  const insert = db.prepare('INSERT INTO publications(id,circuitId,ownerId,title,description,document,sourceRevision,createdAt) VALUES(?,?,?,?,?,?,1,1000)');
  for (let index = 1; index <= 61; index++) {
    const id = `p${String(index).padStart(3, '0')}`;
    insert.run(id, `c${index}`, index % 2 ? 'a' : 'b', index === 2 ? '100%_实际接线' : `作品 ${index}`, index === 3 ? 'older-needle-only' : '成员分享', JSON.stringify({ ...document, title: `快照 ${index}` }));
  }
  db.exec("INSERT INTO circuits(id,ownerId,title,document,revision,writeId,createdAt,updatedAt) VALUES('private','a','private-only-needle','{}',1,'receipt',1,1)");
  db.exec("INSERT INTO reactions(userId,publicationId,kind,createdAt) VALUES('a','p061','like',1),('b','p061','like',1),('a','p003','favorite',1),('b','p002','favorite',1)");
  let queries = 0;
  const env = { members: { a: { id: 'a', role: 'member' }, b: { id: 'b', role: 'member' } }, DB: { prepare(sql) {
    queries++; let values = [];
    return { bind(...args) { values = args; return this; }, async first() { return db.prepare(sql).get(...values) ?? null; }, async all() { return { results: db.prepare(sql).all(...values) }; }, async run() { return { meta: db.prepare(sql).run(...values) }; } };
  } } };
  return { db, env, queries: () => queries };
}
const options = value => new URLSearchParams(value);

test('gallery queries a stable complete pagination sequence beyond the former 48-item cutoff', async () => {
  const { db, env, queries } = fixture();
  try {
    const seen = [];
    for (let page = 1; page <= 6; page++) {
      const result = await listPublications(env, { id: 'b' }, options({ page, pageSize: 12, includeDocument: 1 }));
      assert.equal(result.total, 61); assert.equal(result.totalPages, 6); assert.equal(result.page, page);
      seen.push(...result.items.map(item => item.id));
      assert.ok(result.items.every(item => item.document?.schemaVersion === 1));
    }
    assert.equal(new Set(seen).size, 61); assert.equal(seen[0], 'p061'); assert.equal(seen.at(-1), 'p001');
    assert.equal(queries(), 12, 'two statements per list page; no per-item detail queries');
  } finally { db.close(); }
});

test('gallery searches all persisted snapshots, descriptions and authors, with literal LIKE metacharacters', async () => {
  const { db, env } = fixture();
  try {
    const search = async query => listPublications(env, { id: 'a' }, options({ q: query, includeDocument: 1 }));
    assert.deepEqual((await search('older-needle-only')).items.map(item => item.id), ['p003']);
    assert.equal((await search('接线教师')).total, 31); assert.equal((await search('member_b')).total, 30);
    assert.deepEqual((await search('%_')).items.map(item => item.id), ['p002']);
    assert.equal((await search("' OR 1=1 --")).total, 0);
    assert.equal((await search('private-only-needle')).total, 0, 'private drafts are never part of gallery search');
  } finally { db.close(); }
});

test('member-scoped filters and reactions stay accurate while metadata-only callers remain supported', async () => {
  const { db, env } = fixture();
  try {
    const mine = await listPublications(env, { id: 'b' }, options({ filter: 'mine' }));
    assert.equal(mine.total, 30); assert.ok(mine.items.every(item => item.author.id === 'b' && !('document' in item)));
    assert.deepEqual((await listPublications(env, { id: 'a' }, options({ filter: 'favorites' }))).items.map(item => item.id), ['p003']);
    assert.deepEqual((await listPublications(env, { id: 'b' }, options({ filter: 'favorites' }))).items.map(item => item.id), ['p002']);
    const liked = (await listPublications(env, { id: 'a' }, options({ filter: 'liked' }))).items[0];
    assert.equal(liked.id, 'p061'); assert.equal(liked.likes, 2); assert.equal(liked.liked, true); assert.equal(liked.favorited, false);
  } finally { db.close(); }
});

test('pagination and query bounds reject malformed input and clamp now-missing pages', async () => {
  for (const value of [{ page: '0' }, { page: '-1' }, { page: '1.2' }, { page: '100001' }, { pageSize: '0' }, { pageSize: '101' }, { includeDocument: '1', pageSize: '25' }, { filter: 'invalid' }, { q: 'x'.repeat(101) }]) assert.throws(() => publicationListOptions(options(value)), error => error.status === 400);
  const { db, env } = fixture();
  try {
    const result = await listPublications(env, { id: 'a' }, options({ page: '99', includeDocument: '1' }));
    assert.equal(result.page, 6); assert.equal(result.items.length, 1);
    const empty = await listPublications(env, { id: 'a' }, options({ page: '99', q: 'nothing-matches' }));
    assert.equal(empty.page, 1); assert.equal(empty.totalPages, 1); assert.deepEqual(empty.items, []);
  } finally { db.close(); }
});

test('real publication routes still require membership and return searchable snapshots with private cache headers', async () => {
  const { db, env, queries } = fixture();
  try {
    for (const suffix of ['/api/publications?q=older', '/api/publications/p003']) {
      const response = await handleApi(new Request(`http://localhost${suffix}`), env);
      assert.equal(response.status, 401);
    }
    assert.equal(queries(), 0, 'authentication precedes publication lookup');
    const response = await handleApi(new Request('http://localhost/api/publications?q=older-needle-only&includeDocument=1&pageSize=12', { headers: { 'x-test-member': 'b' } }), env);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const result = await response.json(); assert.equal(result.items.length, 1); assert.equal(result.items[0].document.title, '快照 3');
    const detail = await handleApi(new Request('http://localhost/api/publications/p003', { headers: { 'x-test-member': 'b' } }), env);
    assert.equal(detail.status, 200); assert.equal((await detail.json()).publication.document.title, '快照 3');
    const invalid = await handleApi(new Request('http://localhost/api/publications?page=0', { headers: { 'x-test-member': 'b' } }), env);
    assert.equal(invalid.status, 400);
  } finally { db.close(); }
});

test('gallery URL round-trips search, page and details for refresh/back/forward and encodes all parameters', () => {
  const route = { query: '正反转 & KM1+KM2', page: 4, publicationId: 'published-snapshot' };
  const href = galleryHref(route), url = new URL(href, 'http://localhost');
  assert.equal(url.pathname, '/gallery'); assert.deepEqual(galleryRouteFromSearch(url.search), route);
  const listing = { ...route, publicationId: undefined };
  assert.deepEqual(galleryRouteFromSearch(new URL(galleryHref(listing), url.origin).search), listing);
  const api = new URL(galleryListPath(route), url.origin);
  assert.equal(api.searchParams.get('q'), route.query); assert.equal(api.searchParams.get('page'), '4');
  assert.equal(api.searchParams.get('includeDocument'), '1'); assert.equal(api.searchParams.get('pageSize'), '12');
  for (const invalid of ['-1', 'NaN', '1.5', '100001']) assert.equal(galleryRouteFromSearch(`?page=${invalid}`).page, 1);
  assert.equal(galleryHref({ query: '', page: 1 }), '/gallery');
});
