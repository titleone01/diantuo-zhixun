import { expect } from '@playwright/test';

async function recoveryKey(page) {
  if (new URL(page.url()).origin !== new URL(process.env.DIANTUO_TEST_URL).origin) return 'diantuo:simulator:recovery:v1:demo';
  const response = await page.request.get('/api/session'); expect(response.status()).toBe(200);
  return `diantuo:simulator:recovery:v1:${(await response.json()).user.id}`;
}

/** Read the actual recovery contract, including edits still awaiting its debounce. */
export async function readWorkspaceDocument(page) {
  const key = await recoveryKey(page);
  let state = await page.evaluate(key => { window.dispatchEvent(new Event('beforeunload', { cancelable: true })); return JSON.parse(localStorage.getItem(key) || 'null'); }, key);
  if (!state) {
    // A pristine default has never needed a recovery record. Its first ordinary
    // save establishes one through the product's normal persistence path.
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), key)).not.toBeNull();
    state = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  }
  return state.document;
}

/** Fixtures use only the temporary authenticated API and existing recovery format. */
export async function loadWorkspaceFixture(page, document) {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post('/api/circuits', { headers: { origin }, data: { title: document.title, document } }); expect(response.status()).toBe(201);
  const circuit = (await response.json()).circuit;
  const key = await recoveryKey(page), token = `workspace-fixture:${crypto.randomUUID()}`;
  await page.addInitScript(({ key, token, document }) => {
    if (sessionStorage.getItem(token)) return;
    sessionStorage.setItem(token, '1');
    localStorage.setItem(key, JSON.stringify({ document, saved: null, dirty: true }));
  }, { key, token, document: circuit.document });
  const removed = await page.request.delete(`/api/circuits/${circuit.id}`, { headers: { origin }, data: { revision: circuit.revision } }); expect(removed.status()).toBe(200);
  await page.goto('/');
  await expect(page.locator('.sim-canvas-heading b')).toHaveText(circuit.document.title);
  await expect(page.locator('[data-device-id]')).toHaveCount(circuit.document.components.length);
  await expect(page.locator('.sim-wire')).toHaveCount(circuit.document.wires.length);
}
