import { readWorkspaceDocument } from './workspace-fixtures.mjs';
import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const fixture = JSON.parse(await readFile(process.env.DIANTUO_BROWSER_FIXTURE, 'utf8'));

async function evidence(page, name) {
  const directory = process.env.DIANTUO_FINAL_REVIEW_EVIDENCE;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.locator('.sim-editor').screenshot({ path: path.join(directory, `${name}.png`) });
}

async function login(page) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(fixture.accounts[0].username);
  await page.getByLabel('密码', { exact: true }).fill(fixture.accounts[0].password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始仿真', exact: true })).toBeVisible();
}
const terminal = (page, key) => page.locator(`[data-terminal-key="${key}"]`);
const ref = (componentId, terminalId) => ({ componentId, terminalId });
function circuit(title) {
  return { schemaVersion: 1, title, components: [
    { id: 'source', type: 'supply', label: '电源', position: { x: 40, y: 380 } },
    { id: 'a', type: 'terminal', label: 'A', position: { x: 380, y: 130 } },
    { id: 'b', type: 'terminal', label: 'B', position: { x: 630, y: 130 } },
    { id: 'sq', type: 'limit-switch', label: 'SQ1', position: { x: 620, y: 360 } },
  ], wires: [] };
}
async function open(page, document) {
  const response = await page.request.post('/api/circuits', { headers: { origin: new URL(page.url()).origin }, data: { title: document.title, document } });
  expect(response.status()).toBe(201);
  const draft = (await response.json()).circuit;
  await page.getByRole('link', { name: '个人中心', exact: true }).click();
  await page.getByRole('button', { name: '草稿箱', exact: true }).click();
  await page.getByLabel('每页草稿数量').selectOption('50');
  await page.getByRole('row').filter({ has: page.getByText(document.title, { exact: true }) }).getByRole('button', { name: '编辑', exact: true }).click();
  const collapse = page.getByRole('button', { name: '收起图纸', exact: true });
  if (await collapse.isVisible()) await collapse.click();
  await page.locator('.react-flow__controls-fitview').click();
  await page.getByLabel('线条样式', { exact: true }).selectOption('straight');
  return draft;
}
async function exported(page) { return readWorkspaceDocument(page); }
async function drag(page, from, to) {
  const first = terminal(page, from), last = terminal(page, to);
  await first.hover(); await last.hover();
  const a = await first.boundingBox(), b = await last.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 18 }); await page.mouse.up();
}
async function endpoints(page) {
  const wires = await page.locator('.sim-wire').evaluateAll(elements => elements.map(element => ({ from: element.dataset.fromTerminal, to: element.dataset.toTerminal, fromWorld: JSON.parse(element.dataset.fromWorld), toWorld: JSON.parse(element.dataset.toWorld) })));
  for (const wire of wires) for (const [key, point] of [[wire.from, wire.fromWorld], [wire.to, wire.toWorld]]) {
    expect(await terminal(page, key).evaluate(element => ({ x: Number(element.dataset.worldX), y: Number(element.dataset.worldY) }))).toEqual(point);
  }
  return wires;
}
async function selectWire(page, id) {
  const position = await page.locator(`[data-wire-id="${id}"] > .react-flow__edge-path`).evaluate(path => {
    const point = path.getPointAtLength(path.getTotalLength() * .5);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(position.x, position.y);
  await expect(page.locator(`[data-wire-id="${id}"]`)).toHaveClass(/is-selected/);
}

test('click wiring keeps the first terminal visible, supports cancel, and preserves real drag wiring', async ({ page }) => {
  await login(page); await open(page, circuit('Click and drag wiring 20261010'));
  const start = terminal(page, 'source::L1');
  await start.click();
  await expect(start).toHaveAttribute('data-connection-start', 'true');
  await expect(start.locator('.sim-terminal-focus-label')).toHaveText('起点 · 电源 · L1');
  await page.mouse.move(100, 100);
  await expect(start).toHaveCSS('outline-style', 'solid');
  await expect(page.locator('.sim-editor-footer')).toContainText('接线起点：电源 · L1');
  await evidence(page, 'wire-click-start');
  await terminal(page, 'a::A').click();
  await expect(page.locator('.sim-wire')).toHaveCount(1);
  await expect(page.locator('[data-connection-start="true"]')).toHaveCount(0);
  await terminal(page, 'source::L2').click(); await page.keyboard.press('Escape');
  await expect(page.locator('[data-connection-start="true"]')).toHaveCount(0);
  await terminal(page, 'source::L2').click();
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 120 } });
  await expect(page.locator('[data-connection-start="true"]')).toHaveCount(0);
  await terminal(page, 'a::A').click(); await terminal(page, 'source::L1').click();
  await expect(page.locator('.sim-wire')).toHaveCount(1);
  await expect(page.locator('[data-connection-start="true"]')).toHaveCount(0);
  await drag(page, 'source::L2', 'b::A');
  await expect(page.locator('.sim-wire')).toHaveCount(2); await endpoints(page);
  const firstWire = (await exported(page)).wires[0].id;
  await terminal(page, 'source::L3').click();
  await selectWire(page, firstWire);
  await expect(page.locator('[data-connection-start="true"]')).toHaveCount(0);
  await terminal(page, 'a::A').click();
  await expect(terminal(page, 'a::A')).toHaveAttribute('data-connection-start', 'true');
  await expect(page.locator('.sim-wire')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await terminal(page, 'source::L3').click();
  await page.getByRole('button', { name: '开始仿真', exact: true }).click();
  await expect(page.locator('[data-connection-start="true"]')).toHaveCount(0);
  await page.getByRole('button', { name: '结束仿真', exact: true }).click();
  await terminal(page, 'sq::11').click();
  await expect(terminal(page, 'sq::11')).toHaveAttribute('data-connection-start', 'true');
  await terminal(page, 'a::B').click();
  await expect(page.locator('.sim-wire')).toHaveCount(3);
  expect((await exported(page)).wires.at(-1)).toMatchObject({ from: ref('sq', '11'), to: ref('a', 'B') });
});

test('selected wire traces both ends without altering electrical color or energized state', async ({ page }) => {
  await login(page);
  const document = circuit('Wire trace interaction 20261010');
  document.wires = [{ id: 'traced', from: ref('source', 'L1'), to: ref('a', 'A'), color: '#20262e', style: 'straight' }];
  await open(page, document); await selectWire(page, 'traced');
  const wire = page.locator('[data-wire-id="traced"]');
  await expect(wire.locator('.sim-wire-trace-flow')).toHaveCSS('animation-name', 'sim-wire-trace');
  await expect(page.locator('[data-wire-traced="true"].sim-terminal')).toHaveCount(2);
  await expect(terminal(page, 'source::L1')).toHaveAttribute('data-terminal-energized', 'false');
  await expect(terminal(page, 'a::A').locator('.sim-terminal-focus-label')).toHaveText('A · 1上');
  await expect(page.locator('.sim-editor-footer')).toContainText('蓝色流动用于巡线');
  await evidence(page, 'wire-selected-trace');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(wire.locator('.sim-wire-trace-flow')).toHaveCSS('animation-name', 'none');
  await expect(wire.locator('.sim-wire-outline')).toBeVisible();
  expect((await exported(page)).wires).toEqual(document.wires);
  await page.getByRole('button', { name: '开始仿真', exact: true }).click();
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 120 } });
  await selectWire(page, 'traced');
  await expect(terminal(page, 'source::L1')).toHaveAttribute('data-terminal-energized', 'true');
  await expect(terminal(page, 'source::L1')).toHaveAttribute('data-wire-traced', 'true');
  await expect(wire.locator('.react-flow__edge-path')).toHaveCSS('stroke', 'rgb(32, 38, 46)');
  await page.getByRole('button', { name: '结束仿真', exact: true }).click();
  await endpoints(page);
});

test('clicking control branches before FU2 makes automatic wires black and preserves an explicit color choice', async ({ page }) => {
  await login(page);
  const document = { schemaVersion: 1, title: 'Reverse control color 20261010', components: [
    { id: 'fu2', type: 'fuse2', label: 'FU2', position: { x: 40, y: 100 } },
    { id: 'sb', type: 'push-no', label: 'SB1', position: { x: 300, y: 100 } },
    { id: 'a', type: 'terminal', label: 'A', position: { x: 570, y: 100 } },
    { id: 'b', type: 'terminal', label: 'B', position: { x: 570, y: 350 } },
  ], wires: [] };
  await open(page, document);
  await terminal(page, 'a::A').click(); await terminal(page, 'sb::24').click();
  await expect(page.locator('.sim-wire')).toHaveCount(1);
  expect((await exported(page)).wires[0].color).not.toBe('#20252b');
  // The last link runs from the button back to the FU2 output, not vice versa.
  await terminal(page, 'sb::23').click(); await terminal(page, 'fu2::2').click();
  await expect(page.locator('.sim-wire')).toHaveCount(2);
  let current = await exported(page);
  expect(current.wires.map(wire => wire.color)).toEqual(['#20252b', '#20252b']);
  expect(current.wires.every(wire => wire.colorMode === 'auto')).toBe(true);
  const branch = current.wires.find(wire => wire.from.componentId === 'a');
  await selectWire(page, branch.id);
  await page.getByRole('button', { name: '设置导线颜色', exact: true }).click();
  await page.getByRole('button', { name: '选择导线颜色 #3478f6', exact: true }).click();
  current = await exported(page);
  expect(current.wires.find(wire => wire.id === branch.id)).toMatchObject({ color: '#3478f6', colorMode: 'manual' });
  await page.getByRole('button', { name: '设置导线颜色', exact: true }).click();
  await page.getByRole('button', { name: '新导线跟随起点端子颜色', exact: true }).click();
  await terminal(page, 'b::A').click(); await terminal(page, 'a::B').click();
  await expect(page.locator('.sim-wire')).toHaveCount(3);
  current = await exported(page);
  expect(current.wires.find(wire => wire.id === branch.id)).toMatchObject({ color: '#3478f6', colorMode: 'manual' });
  expect(current.wires.at(-1)).toMatchObject({ color: '#3478f6', colorMode: 'auto' });
  expect(current.wires.find(wire => wire.to.componentId === 'fu2').color).toBe('#20252b');
  await endpoints(page);
});

test('integrated PE terminal starts with its displayed color and still accepts an explicit manual wire color', async ({ page }) => {
  await login(page);
  await open(page, { schemaVersion: 1, title: 'PE instance wire color 20261010', components: [
    { id: 'source', type: 'supply', label: '电源', position: { x: 60, y: 450 }, mirrored: true },
    { id: 'xt', type: 'terminal-strip20', label: 'XT1', position: { x: 60, y: 180 }, pePositions: [5] },
    { id: 'm', type: 'motor', label: 'M1', position: { x: 970, y: 360 } },
  ], wires: [] });
  const pe = terminal(page, 'xt::B5');
  await expect(pe).toHaveCSS('border-color', 'rgb(226, 188, 32)');
  await pe.click(); await terminal(page, 'm::PE').click();
  await expect(page.locator('.sim-wire')).toHaveCount(1);
  expect((await exported(page)).wires[0]).toMatchObject({ color: '#e2bc20', colorMode: 'auto' });
  await page.getByRole('button', { name: '设置导线颜色', exact: true }).click();
  await page.getByRole('button', { name: '选择导线颜色 #659f2f', exact: true }).click();
  await pe.click(); await terminal(page, 'source::PE').click();
  await expect(page.locator('.sim-wire')).toHaveCount(2);
  const current = await exported(page);
  expect(current.wires[0]).toMatchObject({ color: '#e2bc20', colorMode: 'auto' });
  expect(current.wires[1]).toMatchObject({ color: '#659f2f', colorMode: 'manual' });
  await endpoints(page);
});

test('supply mirrors and proximity switch rotates with connected world endpoints preserved after save and reload', async ({ page }) => {
  await login(page);
  const draft = await open(page, circuit('Mirror and proximity rotation 20261010'));
  await drag(page, 'source::L1', 'sq::11');
  await expect(page.locator('.sim-wire')).toHaveCount(1);
  await page.locator('[data-device-id="source"]').click({ position: { x: 90, y: 20 } });
  await expect(page.getByRole('button', { name: '旋转90°', exact: true })).toHaveCount(0);
  const before = await endpoints(page);
  await page.getByRole('button', { name: '上下镜像', exact: true }).click();
  expect((await exported(page)).components.find(component => component.id === 'source').mirrored).toBe(true);
  expect(await endpoints(page)).not.toEqual(before);

  await page.locator('[data-device-id="sq"]').click({ position: { x: 30, y: 35 } });
  await page.getByRole('button', { name: '旋转90°', exact: true }).click();
  expect((await exported(page)).components.find(component => component.id === 'sq').rotation).toBe(90);
  await page.locator('.react-flow__controls-fitview').click();
  const box = await page.locator('[data-device-id="sq"]').boundingBox();
  await page.mouse.move(box.x + 25, box.y + 25); await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 50, { steps: 14 }); await page.mouse.up();
  const moved = await endpoints(page);
  await page.locator('.react-flow__controls-zoomout').click(); expect(await endpoints(page)).toEqual(moved);
  const save = page.waitForResponse(response => response.url().endsWith(`/api/circuits/${draft.id}`) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click(); expect((await save).status()).toBe(200);
  await page.reload(); await expect(page.locator('.sim-wire')).toHaveCount(1); expect(await endpoints(page)).toEqual(moved);
  const restored = await exported(page);
  expect(restored.components.find(component => component.id === 'source').mirrored).toBe(true);
  expect(restored.components.find(component => component.id === 'sq').rotation).toBe(90);
  await evidence(page, 'supply-mirror-proximity-rotation');
  await page.getByRole('button', { name: '开始仿真', exact: true }).click();
  const actuator = page.getByRole('button', { name: 'SQ1 限位开关', exact: true });
  await actuator.hover(); const hit = await actuator.boundingBox();
  await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2); await page.mouse.down();
  await expect(page.locator('[data-device-id="sq"]')).toHaveClass(/is-pressed/);
  await page.mouse.up(); await expect(page.locator('[data-device-id="sq"]')).not.toHaveClass(/is-pressed/);
});
