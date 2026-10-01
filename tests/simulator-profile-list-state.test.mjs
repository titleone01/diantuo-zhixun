import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundled = await build({ stdin: { contents: `export * from './app/simulator/profile/list-state';`, resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
const { profileListPath, ProfileListRequests, readProfileRoute, profileHref, emptyProfileRoute, PROFILE_DRAFT_PAGE_SIZES } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const scope = (overrides = {}) => ({ ownerId: 'member-a', session: 1, tab: 'drafts', query: '', page: 1, ...overrides });
function fixture() {
  const guard = new ProfileListRequests(); let current = scope(); const visible = { items: [], error: '', loading: false };
  return {
    guard, visible, select(next, invalidate = true) { if (invalidate) guard.invalidate(); current = next; },
    request() {
      const token = guard.begin(current); visible.loading = true; visible.error = '';
      let resolve, reject;
      const pending = new Promise((yes, no) => { resolve = yes; reject = no; }).then(items => { if (guard.accepts(token, current)) visible.items = items; }).catch(error => { if (guard.accepts(token, current)) visible.error = error.message; }).finally(() => { if (guard.accepts(token, current)) visible.loading = false; });
      return { resolve, reject, pending };
    },
  };
}

test('profile paths request bounded server pages, title searches and full snapshot cards without detail fan-out', () => {
  for (const tab of ['drafts', 'publications', 'favorites']) {
    const url = new URL(profileListPath(tab, ' 电机 & 100%_? ', 3), 'http://localhost');
    assert.equal(url.pathname, tab === 'drafts' ? '/circuits' : '/publications');
    assert.equal(url.searchParams.get('page'), '3'); assert.equal(url.searchParams.get('pageSize'), tab === 'drafts' ? '10' : '12');
    assert.equal(url.searchParams.get('q'), '电机 & 100%_?');
    assert.equal(url.searchParams.get('filter'), tab === 'drafts' ? null : tab === 'favorites' ? 'favorites' : 'mine');
    assert.equal(url.searchParams.get('includeDocument'), tab === 'drafts' ? null : '1');
  }
  for (const page of [0, -1, 1.5, NaN, Infinity, 100001]) assert.equal(new URL(profileListPath('drafts', '', page), 'http://localhost').searchParams.get('page'), '1');
  for (const size of PROFILE_DRAFT_PAGE_SIZES) assert.equal(new URL(profileListPath('drafts', '', 2, size), 'http://localhost').searchParams.get('pageSize'), String(size));
  assert.equal(new URL(profileListPath('publications', '', 2, 50), 'http://localhost').searchParams.get('pageSize'), '12');
});

test('profile routes preserve deep links and admin, with public lists using request batches rather than page URLs', () => {
  assert.deepEqual(emptyProfileRoute(), { tab: 'publications', query: '', page: 1 });
  assert.equal(profileHref(emptyProfileRoute()), '/profile');
  for (const tab of ['publications', 'favorites', 'drafts', 'admin']) {
    const route = { tab, query: '电机 & 100%_?', page: 3 };
    const href = profileHref(route); const actual = readProfileRoute(new URL(href, 'http://localhost').search);
    assert.deepEqual(actual, { ...route, page: tab === 'drafts' ? 3 : 1 });
  }
  for (const value of ['0', '-1', '1.5', '01', '1e2', 'Infinity', '100001']) assert.equal(readProfileRoute(`?tab=drafts&page=${value}`).page, 1);
  assert.equal(readProfileRoute('?tab=unknown').tab, 'publications');
  assert.equal(readProfileRoute('?tab=favorites&page=9').page, 1);
});

test('late successful reads cannot replace another tab, search, page, or account even before a replacement request starts', async () => {
  for (const next of [scope({ tab: 'favorites' }), scope({ query: 'new search' }), scope({ page: 2 }), scope({ pageSize: 50 }), scope({ ownerId: 'member-b', session: 2 }), null]) {
    const ui = fixture(), old = ui.request();
    ui.select(next, false); old.resolve(['private old page']); await old.pending;
    assert.deepEqual(ui.visible.items, []); assert.equal(ui.visible.loading, true, 'old finally cannot finish another view’s loading state');
  }
});

test('refresh of the same page rejects older success/error/finally after the new read wins', async () => {
  for (const fails of [false, true]) {
    const ui = fixture(), older = ui.request(), current = ui.request();
    current.resolve(['latest snapshot']); await current.pending;
    if (fails) older.reject(new Error('obsolete failure')); else older.resolve(['obsolete snapshot']);
    await older.pending;
    assert.deepEqual(ui.visible, { items: ['latest snapshot'], error: '', loading: false });
  }
});

test('navigation and unmount invalidation survive returning to the same list and A→B→A logins', async () => {
  const ui = fixture(), abandoned = ui.request();
  ui.select(scope({ tab: 'favorites' })); ui.select(scope());
  abandoned.resolve(['old draft list']); await abandoned.pending; assert.deepEqual(ui.visible.items, []);
  const fromA = ui.request(); ui.select(scope({ ownerId: 'member-b', session: 2 })); ui.select(scope({ session: 3 }));
  const newA = ui.request(); newA.resolve(['new session']); await newA.pending;
  fromA.resolve(['old session']); await fromA.pending; assert.deepEqual(ui.visible.items, ['new session']);
  const atUnmount = ui.request(); ui.guard.invalidate(); atUnmount.reject(new Error('unmounted failure')); await atUnmount.pending;
  assert.equal(ui.visible.error, ''); assert.equal(ui.visible.loading, true);
});

test('current errors remain visible and retry can succeed without retaining old list state', async () => {
  const ui = fixture(), failure = ui.request(); failure.reject(new Error('暂时无法读取草稿')); await failure.pending;
  assert.equal(ui.visible.error, '暂时无法读取草稿'); assert.equal(ui.visible.loading, false);
  const retry = ui.request(); assert.equal(ui.visible.error, ''); retry.resolve(['restored page']); await retry.pending;
  assert.deepEqual(ui.visible, { items: ['restored page'], error: '', loading: false });
});
