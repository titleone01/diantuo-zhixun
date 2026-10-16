import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadWorkspaceFixture, readWorkspaceDocument } from './workspace-fixtures.mjs';

const fixture = JSON.parse(await readFile(process.env.DIANTUO_BROWSER_FIXTURE, 'utf8'));
const legacy = JSON.parse(await readFile(new URL('../tests/fixtures/course06-single-strip.json', import.meta.url), 'utf8'));

async function login(page) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(fixture.accounts[0].username);
  await page.getByLabel('密码', { exact: true }).fill(fixture.accounts[0].password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始仿真', exact: true })).toBeVisible();
}

async function disclosure(page, open) {
  const details = page.locator('.dt-document-disclosure');
  if ((await details.getAttribute('open') !== null) !== open) await details.locator('summary').click();
}

async function course(page, wired = false) {
  await disclosure(page, true);
  await page.getByLabel('选择训练课程', { exact: true }).selectOption('motor-course-06');
  await page.getByRole('button', { name: '创建练习', exact: true }).click();
  if (wired) {
    await disclosure(page, true);
    await page.getByRole('button', { name: '载入示范接线', exact: true }).click();
  }
  await disclosure(page, false);
  const collapse = page.getByRole('button', { name: '收起图纸', exact: true });
  if (await collapse.isVisible()) await collapse.click();
  await page.locator('.react-flow__controls-fitview').click();
}

function checkLayout(document) {
  const byRole = role => document.components.find(component => component.id === document.roles[role]);
  expect(byRole('xt2')).toMatchObject({ type: 'terminal-strip16', rotation: 270 });
  expect(byRole('xt16')).toMatchObject({ pePositions: [5] });
  for (const role of ['sq1', 'sq2', 'sq3', 'sq4']) expect(byRole(role)).toMatchObject({ rotation: 90 });
  expect(['sq1', 'sq2', 'sq3', 'sq4', 'sb1', 'sb2', 'sb3'].map(role => byRole(role).position.y)).toEqual(
    ['sq1', 'sq2', 'sq3', 'sq4', 'sb1', 'sb2', 'sb3'].map(role => byRole(role).position.y).sort((a, b) => a - b));
  const buttons = ['sb1', 'sb2', 'sb3'].map(role => byRole(role));
  expect(new Set(buttons.map(button => button.position.y)).size).toBe(1);
  expect(buttons[0].position.x).toBeLessThan(buttons[1].position.x);
  expect(buttons[1].position.x).toBeLessThan(buttons[2].position.x);
  expect(byRole('xt16').position.y).toBeLessThan(1000);
}

async function endpoints(page) {
  const wires = await page.locator('.sim-wire').evaluateAll(elements => elements.map(element => ({
    from: element.dataset.fromTerminal, to: element.dataset.toTerminal,
    a: JSON.parse(element.dataset.fromWorld), b: JSON.parse(element.dataset.toWorld),
  })));
  for (const wire of wires) for (const [key, point] of [[wire.from, wire.a], [wire.to, wire.b]]) {
    expect(await page.locator(`[data-terminal-key="${key}"]`).evaluate(element => ({ x: Number(element.dataset.worldX), y: Number(element.dataset.worldY) }))).toEqual(point);
  }
  return wires;
}

async function drag(page, from, to) {
  const first = page.locator(`[data-terminal-key="${from}"]`), last = page.locator(`[data-terminal-key="${to}"]`);
  await first.hover(); await last.hover();
  const a = await first.boundingBox(), b = await last.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 }); await page.mouse.up();
}

test('course 06 layout: new blank supports real XT2-SQ dragging, movement, zoom, save and reload', async ({ page }) => {
  test.setTimeout(120000);
  await login(page); await course(page);
  const blank = await readWorkspaceDocument(page); checkLayout(blank); expect(blank.wires).toEqual([]);
  await expect(page.locator('[data-device-id="sq1"] .sim-rotated-artwork')).toHaveCSS('transform', 'matrix(0, 1, -1, 0, 226.5, 0)');
  await drag(page, 'xt2::B16', 'sq1::11'); await expect(page.locator('.sim-wire')).toHaveCount(1);
  const before = await endpoints(page);
  const box = await page.locator('[data-device-id="sq1"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 20, { steps: 15 }); await page.mouse.up();
  const moved = await endpoints(page); expect(moved).not.toEqual(before);
  await page.locator('.react-flow__controls-zoomout').click(); expect(await endpoints(page)).toEqual(moved);
  const saved = page.waitForResponse(response => /\/api\/circuits(?:\/[^/]+)?$/.test(response.url()) && ['POST', 'PUT'].includes(response.request().method()));
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  const response = await saved; expect([200, 201]).toContain(response.status());
  const circuit = (await response.json()).circuit;
  await page.reload(); await expect(page.locator('.sim-wire')).toHaveCount(1); expect(await endpoints(page)).toEqual(moved);
  const readback = await page.request.get(`/api/circuits/${circuit.id}`); expect((await readback.json()).circuit.document).toEqual(circuit.document);
});

test('course 06 layout: demonstration routes all wires and rotated switches control reversal and limits', async ({ page }) => {
  test.setTimeout(120000);
  await login(page); await course(page, true);
  const document = await readWorkspaceDocument(page); checkLayout(document);
  await expect(page.locator('.sim-wire')).toHaveCount(document.wires.length);
  await expect(page.locator('.sim-wire:not([data-routing-status="routed"])')).toHaveCount(0);
  await endpoints(page);
  await page.screenshot({ path: path.join(process.env.DIANTUO_BROWSER_PRIVATE_OUTPUT, 'course06-dual-strip-layout.png'), fullPage: true });
  const assessed = await page.request.post('/api/assess', { headers: { origin: new URL(page.url()).origin }, data: { document, lessonId: document.lessonId } });
  expect(assessed.status()).toBe(200);
  const result = await assessed.json(); expect(result.assessment.status).toBe('passed'); expect(result.workmanship.status).toBe('passed');
  const motor = page.locator('[data-device-id="m"]');
  const tap = async id => page.locator(`[data-device-id="${id}"] .sim-actuator`).click();
  const hold = async (id, expected) => {
    const actuator = page.locator(`[data-device-id="${id}"] .sim-actuator`);
    await actuator.hover(); const box = await actuator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    try {
      await expect(page.locator(`[data-device-id="${id}"]`)).toHaveClass(/is-pressed/);
      if (expected) await expect(motor).toHaveAttribute('data-runtime-direction', expected);
      else await expect(motor).not.toHaveClass(/sim-motor-running/);
    } finally { await page.mouse.up(); }
  };
  await page.getByRole('button', { name: '开始仿真', exact: true }).click();
  await page.locator('[data-device-id="qf"] .sim-toggle-actuator').click();
  await tap('sb1'); await expect(motor).toHaveAttribute('data-runtime-direction', 'forward');
  await hold('sq1', 'reverse'); await expect(motor).toHaveAttribute('data-runtime-direction', 'reverse');
  await hold('sq2', 'forward'); await expect(motor).toHaveAttribute('data-runtime-direction', 'forward');
  await hold('sq3'); await expect(motor).not.toHaveClass(/sim-motor-running/);
  await tap('sb2'); await expect(motor).toHaveAttribute('data-runtime-direction', 'reverse');
  await hold('sq4'); await expect(motor).not.toHaveClass(/sim-motor-running/);
  await tap('sb1'); await tap('sb3'); await expect(motor).not.toHaveClass(/sim-motor-running/);
  await tap('sb1'); await page.getByRole('button', { name: 'FR 过载 TEST', exact: true }).click(); await expect(motor).not.toHaveClass(/sim-motor-running/);
  await page.getByRole('button', { name: '结束仿真', exact: true }).click();
});

test('course 06 layout: saved single-strip draft remains exact and retains both assessments', async ({ page }) => {
  await login(page); await loadWorkspaceFixture(page, legacy);
  expect(await readWorkspaceDocument(page)).toEqual(legacy);
  await expect(page.locator('[data-device-id="xt2"]')).toHaveCount(0);
  const response = await page.request.post('/api/assess', { headers: { origin: new URL(page.url()).origin }, data: { document: legacy, lessonId: legacy.lessonId } });
  expect(response.status()).toBe(200);
  const result = await response.json(); expect(result.assessment.status).toBe('passed'); expect(result.workmanship.status).toBe('passed');
});

test('course 06 layout: built Pages uses the same blank and demonstration templates', async ({ page }) => {
  test.skip(!process.env.DIANTUO_STATIC_URL, 'No built Pages fixture');
  await page.goto(process.env.DIANTUO_STATIC_URL);
  await expect(page.getByRole('button', { name: '开始仿真', exact: true })).toBeVisible();
  await course(page); const blank = await readWorkspaceDocument(page); checkLayout(blank); expect(blank.wires).toEqual([]);
  await disclosure(page, true); await page.getByRole('button', { name: '载入示范接线', exact: true }).click();
  const demo = await readWorkspaceDocument(page); checkLayout(demo); expect(demo.components).toEqual(blank.components); expect(demo.wires.length).toBeGreaterThan(0);
});
