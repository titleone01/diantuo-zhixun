import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { loadWorkspaceFixture, readWorkspaceDocument } from './workspace-fixtures.mjs';

const fixture = JSON.parse(await readFile(process.env.DIANTUO_BROWSER_FIXTURE, 'utf8'));
async function login(page, index = 0) {
  await page.goto('/'); await page.getByLabel('账号', { exact: true }).fill(fixture.accounts[index].username); await page.getByLabel('密码', { exact: true }).fill(fixture.accounts[index].password);
  await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page.getByRole('button', { name: '开始仿真', exact: true })).toBeVisible();
}
async function collapse(page) { const button = page.getByRole('button', { name: '收起图纸', exact: true }); if (await button.isVisible()) await button.click(); await page.locator('.react-flow__controls-fitview').click(); }
async function drag(page, from, to) {
  const a = page.locator(`[data-terminal-key="${from}"]`), b = page.locator(`[data-terminal-key="${to}"]`); await a.hover(); await b.hover();
  const first = await a.boundingBox(), last = await b.boundingBox(); await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2); await page.mouse.down(); await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 18 }); await page.mouse.up();
}
async function endpoints(page) {
  const wires = await page.locator('.sim-wire').evaluateAll(items => items.map(item => ({ from: item.dataset.fromTerminal, to: item.dataset.toTerminal, a: JSON.parse(item.dataset.fromWorld), b: JSON.parse(item.dataset.toWorld) })));
  for (const wire of wires) for (const [key, point] of [[wire.from, wire.a], [wire.to, wire.b]]) expect(await page.locator(`[data-terminal-key="${key}"]`).evaluate(item => ({ x: Number(item.dataset.worldX), y: Number(item.dataset.worldY) }))).toEqual(point);
  return wires;
}
async function save(page) {
  const waiting = page.waitForResponse(response => /\/api\/circuits(?:\/[^/]+)?$/.test(response.url()) && ['POST', 'PUT'].includes(response.request().method()));
  await page.getByRole('button', { name: '保存草稿', exact: true }).click(); const response = await waiting; expect([200, 201]).toContain(response.status()); return (await response.json()).circuit;
}

test('component labels: library, removed commands, 2P motion and dark KM states', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await login(page);
  await expect(page.getByRole('tab', { name: '家庭电路组件', exact: true })).toHaveCount(0);
  for (const name of ['添加单开单控', '添加单开双控', '添加照明灯（220V）']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  for (const name of ['导出图纸到本地', '导入本地保存的图纸', '复制选中对象', '粘贴对象', '撤销', '重做']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.locator('input[accept="application/json,.json"]')).toHaveCount(0);
  await loadWorkspaceFixture(page, { schemaVersion: 1, title: '2P与KM配色验收', components: [
    { id: 's', type: 'supply', label: '电源', position: { x: 80, y: 20 } }, { id: 'km', type: 'contactor380', label: 'KM1', position: { x: 380, y: 160 } },
  ], wires: [{ id: 'l1', from: { componentId: 's', terminalId: 'L1' }, to: { componentId: 'km', terminalId: 'A1' }, color: '#e7b000', style: 'straight' }, { id: 'l2', from: { componentId: 's', terminalId: 'L2' }, to: { componentId: 'km', terminalId: 'A2' }, color: '#20b963', style: 'straight' }] });
  await page.getByRole('button', { name: '添加两极断路器', exact: true }).click(); await page.getByRole('button', { name: '添加10位端子排（教学）', exact: true }).click(); await collapse(page);
  await expect(page.locator('[data-component-type="breaker2"] .sim-terminal')).toHaveCount(4); await expect(page.locator('[data-component-type="terminal-strip10"] .sim-terminal')).toHaveCount(20);
  await expect(page.locator('[data-component-type="terminal-strip10"] [data-terminal-position]')).toHaveCount(0);
  const arranged = await readWorkspaceDocument(page); for(const item of arranged.components){if(item.type==='breaker2')item.position={x:80,y:160};if(item.type==='terminal-strip10')item.position={x:80,y:430};} await loadWorkspaceFixture(page, arranged); await collapse(page); await mkdir('.local/acceptance-public',{recursive:true}); await page.screenshot({path:'.local/acceptance-public/component-library-20261015.png',fullPage:true});
  const before = await readWorkspaceDocument(page); await page.locator('.sim-canvas').focus(); for (const key of ['Control+c', 'Control+v', 'Control+z', 'Control+y']) await page.keyboard.press(key); expect(await readWorkspaceDocument(page)).toEqual(before);
  await expect(page.locator('[data-device-id="km"] .sim-contactor-state-region').first()).toHaveAttribute('fill', '#595ba4');
  await page.getByRole('button', { name: '开始仿真', exact: true }).click(); await expect(page.locator('[data-device-id="km"] .sim-contactor-artwork')).toHaveAttribute('data-contactor-engaged', 'true');
  const q = page.locator('[data-component-type="breaker2"]'); await q.locator('.sim-toggle-actuator').click(); await expect(q.locator('.sim-switch-motion')).toHaveAttribute('data-mechanism-state', 'closed'); await q.locator('.sim-toggle-actuator').click(); await expect(q.locator('.sim-switch-motion')).toHaveAttribute('data-mechanism-state', 'open');
  await expect(page.getByRole('button', { name: '标注线号 1', exact: true })).toBeDisabled(); await page.getByRole('button', { name: '结束仿真', exact: true }).click();
  await expect(page.locator('[data-device-id="km"] .sim-contactor-artwork')).toHaveAttribute('data-contactor-engaged', 'false');
});

test('component labels: real XT10 drag, manual labels, rotation, save, publication and account boundaries', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await login(page);
  await loadWorkspaceFixture(page, { schemaVersion: 1, title: '端子手动标注与线号验收', components: [
    { id: 'a', type: 'terminal', label: 'A', position: { x: 80, y: 100 } }, { id: 'b', type: 'terminal', label: 'B', position: { x: 720, y: 100 } }, { id: 'xt', type: 'terminal-strip10', label: 'XT1', position: { x: 200, y: 420 }, pePositions: [5] },
  ], wires: [] }); await collapse(page); await page.getByLabel('线条样式', { exact: true }).selectOption('straight');
  await drag(page, 'a::A', 'xt::T1'); await drag(page, 'xt::B1', 'b::A'); await expect(page.locator('.sim-wire')).toHaveCount(2); await endpoints(page);
  await page.locator('[data-device-id="xt"]').click({ position: { x: 35, y: 39 } }); await expect(page.getByLabel('端子标注', { exact: true })).toBeVisible(); const panelBox=await page.getByLabel('端子标注',{exact:true}).boundingBox(),canvasBox=await page.locator('.sim-canvas').boundingBox(); expect(panelBox.x+panelBox.width).toBeLessThanOrEqual(canvasBox.x);
  await page.getByLabel('XT1 第1位标注', { exact: true }).fill('101'); await page.getByLabel('XT1 第10位标注', { exact: true }).fill('N'); await expect(page.locator('[data-terminal-position="1"]')).toHaveText('101');
  await page.getByRole('button', { name: '旋转90°', exact: true }).click(); await page.getByRole('button', { name: '关闭端子标注', exact: true }).click(); await page.locator('.react-flow__controls-fitview').click(); await endpoints(page);
  // A real terminal click and Escape also expose the endpoint's wire for selection.
  await page.getByRole('button', { name: '等电位', exact: true }).click();
  const path = page.locator('.sim-wire > .react-flow__edge-path').first(); await page.locator('[data-device-id="a"]').hover();
  const point = await path.evaluate(item => { for (const fraction of [.5,.35,.65,.2,.8]) { const p=item.getPointAtLength(item.getTotalLength()*fraction),s=new DOMPoint(p.x,p.y).matrixTransform(item.getScreenCTM()); if(document.elementFromPoint(s.x,s.y)?.closest('[data-wire-id]')===item.closest('[data-wire-id]'))return{x:s.x,y:s.y}; } throw new Error('No exposed wire for click'); }); await page.mouse.click(point.x, point.y);
  await page.getByRole('button', { name: '标注线号 7', exact: true }).click();
  for (const key of ['a::A', 'xt::T1', 'xt::B1', 'b::A']) { await expect(page.locator(`[data-terminal-key="${key}"]`)).toHaveAttribute('data-wire-number', '7'); await expect(page.locator(`[data-terminal-key="${key}"] .sim-wire-number`)).toHaveText('7'); }
  const beforeMove = await endpoints(page); const node = page.locator('[data-device-id="b"]'); await node.hover({position:{x:10,y:35}}); const box = await node.boundingBox(); await page.mouse.move(box.x + 10, box.y + 35); await page.mouse.down(); await page.mouse.move(box.x + 58, box.y + 59, { steps: 14 }); await page.mouse.up();
  const moved = await endpoints(page); expect(moved).not.toEqual(beforeMove); await page.locator('.react-flow__controls-zoomout').click(); expect(await endpoints(page)).toEqual(moved);
  const saved = await save(page); expect(saved.document.components.find(item => item.id === 'xt')).toMatchObject({ rotation: 90, terminalLabels: { 1: '101', 10: 'N' }, pePositions: [5] }); expect(saved.document.wires.map(item => item.wireNumber)).toEqual(['7', '7']);
  await page.reload(); await expect(page.locator('.sim-wire')).toHaveCount(2); expect(await endpoints(page)).toEqual(moved); await expect(page.locator('[data-terminal-position="1"]')).toHaveText('101');
  await page.screenshot({path:'.local/acceptance-public/component-labels-20261015.png',fullPage:true});
  const publishing = page.waitForResponse(response => response.url().endsWith(`/api/circuits/${saved.id}/publish`) && response.request().method() === 'POST'); await page.getByRole('button', { name: '发布电路', exact: true }).click(); const published = await publishing; expect(published.status()).toBe(201); const publication = (await published.json()).publication; expect(publication.document).toEqual(saved.document);
  const invalid = structuredClone(saved.document); invalid.components.find(item => item.id === 'xt').terminalLabels[11] = '无效位置';
  const rejected = await page.request.put(`/api/circuits/${saved.id}`, { headers: { origin: new URL(page.url()).origin }, data: { title: invalid.title, document: invalid, revision: saved.revision } }); expect(rejected.status()).toBe(400); expect((await (await page.request.get(`/api/circuits/${saved.id}`)).json()).circuit.document).toEqual(saved.document);
  await mkdir('.local/acceptance-public', { recursive: true }); await page.screenshot({ path: '.local/acceptance-public/component-labels-publication-20261015.png', fullPage: true });
  const context = await browser.newContext(); try { const other = await context.newPage(); await login(other, 1); expect((await other.request.get(`/api/circuits/${saved.id}`)).status()).toBe(404); await other.goto(`/gallery?publication=${publication.id}`); await expect(other.locator('.dt-gallery-detail [data-terminal-position="1"]')).toHaveText('101'); await expect(other.locator('.dt-gallery-detail [data-wire-number="7"]')).toHaveCount(6); await expect(other.getByLabel('端子标注', { exact: true })).toHaveCount(0); } finally { await context.close(); }
});
