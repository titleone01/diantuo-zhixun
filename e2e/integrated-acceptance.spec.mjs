import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const fixture = JSON.parse(await readFile(process.env.DIANTUO_BROWSER_FIXTURE, 'utf8'));
const ports = [{ id: 'ia', type: 'terminal', label: 'A', position: { x: 80, y: 220 } }, { id: 'ib', type: 'terminal', label: 'B', position: { x: 600, y: 220 } }];
const channels = [{ id: 'left', type: 'wire-duct', label: 'WD1', position: { x: 0, y: 100 }, size: { width: 350, height: 50 } }, { id: 'right', type: 'wire-duct', label: 'WD2', position: { x: 350, y: 100 }, size: { width: 400, height: 50 } }];
const wire = { id: 'integrated-wire', from: { componentId: 'ia', terminalId: 'A' }, to: { componentId: 'ib', terminalId: 'A' }, color: '#203040', style: 'orthogonal', routing: 'duct' };
const smallDocument = { schemaVersion: 1, title: 'Integrated fixture', components: ports, wires: [] };
const ducts = document => document.components.filter(component => component.type.startsWith('wire-duct'));

async function login(page) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(fixture.accounts[0].username);
  await page.getByLabel('密码', { exact: true }).fill(fixture.accounts[0].password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始仿真', exact: true })).toBeVisible();
}
async function disclosure(page, open = true) {
  const control = page.locator('.dt-document-disclosure');
  if ((await control.getAttribute('open') !== null) !== open) await control.locator('summary').click();
}
async function exportDocument(page) {
  await page.getByRole('button', { name: '导出图纸到本地', exact: true }).click();
  const document = JSON.parse(await page.getByLabel('导出的电路 JSON', { exact: true }).inputValue());
  await page.getByRole('button', { name: '关闭电路文件窗口', exact: true }).click();
  return document;
}
async function importDocument(page, document) {
  await page.getByRole('button', { name: '导入本地保存的图纸', exact: true }).click();
  await page.getByLabel('待导入的电路 JSON', { exact: true }).fill(JSON.stringify(document));
  await page.getByRole('button', { name: '导入粘贴内容', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '导入电路 JSON', exact: true })).not.toBeVisible();
  await expect(page.locator('[data-device-id]')).toHaveCount(document.components.length);
}
async function newDocument(page) {
  await disclosure(page); await page.getByRole('button', { name: '新建电路', exact: true }).click(); await disclosure(page, false);
}
async function collapseDiagram(page) {
  const button = page.getByRole('button', { name: '收起图纸', exact: true }); if (await button.isVisible()) await button.click();
}

test('integrated: ten blank courses share six-duct layouts and FU2/XT16, clear and examples keep one layout', async ({ page }) => {
  test.setTimeout(120000);
  await login(page); await disclosure(page);
  for (let number = 1; number <= 10; number++) {
    const lesson = `motor-course-${String(number).padStart(2, '0')}`;
    await page.getByLabel('选择训练课程', { exact: true }).selectOption(lesson);
    let document = await exportDocument(page);
    expect(document.lessonId).toBe(lesson); expect(document.wires).toHaveLength(0);
    expect(ducts(document)).toHaveLength(6);
    expect(ducts(document).filter(component => component.type === 'wire-duct')).toHaveLength(4);
    expect(ducts(document).filter(component => component.type === 'wire-duct-vertical')).toHaveLength(2);
    expect(document.components.filter(component => component.type === 'fuse2')).toHaveLength(1);
    expect(document.components.filter(component => component.type === 'terminal-strip16')).toHaveLength(1);
    const placement = document.components.map(({ id, type, position, size }) => ({ id, type, position, size }));
    await page.getByRole('button', { name: '载入示范接线', exact: true }).click();
    document = await exportDocument(page); expect(document.wires.length).toBeGreaterThan(0);
    expect(document.wires.every(wire => wire.style === 'orthogonal' && wire.routing === 'duct')).toBe(true);
    expect(document.components.map(({ id, type, position, size }) => ({ id, type, position, size }))).toEqual(placement);
    await page.getByRole('button', { name: '清空接线练习', exact: true }).click();
    document = await exportDocument(page); expect(document.wires).toHaveLength(0);
    expect(document.components.map(({ id, type, position, size }) => ({ id, type, position, size }))).toEqual(placement);
  }
  await newDocument(page); expect((await exportDocument(page)).wires).toHaveLength(0);
  await importDocument(page, { ...smallDocument, wires: [{ ...wire, style: 'curve', routing: undefined, waypoints: [{ x: 350, y: 300 }] }] });
  const before = await exportDocument(page);
  await page.getByRole('button', { name: '预布线槽', exact: true }).click();
  let arranged = await exportDocument(page); expect(ducts(arranged)).toHaveLength(6);
  expect(arranged.wires[0]).toMatchObject({ style: 'orthogonal', routing: 'duct' });
  await page.getByRole('button', { name: '撤销', exact: true }).click(); expect(await exportDocument(page)).toEqual(before);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.getByRole('button', { name: '导线全部入槽', exact: true }).click();
  const existingPlacement = arranged.components;
  arranged = await exportDocument(page); expect(ducts(arranged)).toHaveLength(6);
  expect(arranged.components).toEqual(existingPlacement);
});

test('integrated: legacy duct import and canonical routing save and reload without losing manual paths', async ({ page }) => {
  await login(page); await newDocument(page);
  const legacy = { ...smallDocument, title: 'Legacy duct acceptance', components: [...ports, ...channels], wires: [{ ...wire, style: 'duct', routing: undefined, waypoints: [{ x: 250, y: 290 }] }] };
  const original = structuredClone(legacy);
  await importDocument(page, legacy); expect(legacy).toEqual(original);
  let document = await exportDocument(page); expect(document.wires[0]).toMatchObject({ style: 'orthogonal', routing: 'duct' });
  await collapseDiagram(page); await page.locator('.react-flow__controls-fitview').click();
  await expect(page.locator('.sim-wire')).toHaveAttribute('data-routing', 'duct');
  await expect(page.locator('.sim-wire')).toHaveAttribute('data-routing-status', 'routed');
  const saving = page.waitForResponse(response => response.url().endsWith('/api/circuits') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click(); const response = await saving; expect(response.status()).toBe(201);
  const saved = (await response.json()).circuit; expect(saved.document.wires[0]).toMatchObject({ style: 'orthogonal', routing: 'duct' });
  await page.reload(); await expect(page.locator('.sim-wire')).toHaveCount(1);
  document = await exportDocument(page); expect(document).toEqual(saved.document);
  const endpoint = { from: document.wires[0].from, to: document.wires[0].to };
  await collapseDiagram(page); await page.locator('.react-flow__controls-fitview').click();
  const interaction = page.locator('.sim-wire .react-flow__edge-interaction'); await interaction.hover();
  const point = await interaction.evaluate(path => { const point = path.getPointAtLength(path.getTotalLength() / 2), matrix = path.getScreenCTM(); return { x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f }; });
  await page.mouse.click(point.x, point.y); await expect(page.locator('.sim-wire')).toHaveClass(/is-selected/);
  await page.getByLabel('线条样式', { exact: true }).selectOption('curve');
  document = await exportDocument(page); expect(document.wires[0].style).toBe('curve'); expect(document.wires[0].routing).toBeUndefined();
  expect({ from: document.wires[0].from, to: document.wires[0].to }).toEqual(endpoint);
  const manual = { ...smallDocument, title: 'Manual fixture retained', components: [...ports, ...channels], wires: [{ ...wire, style: 'straight', routing: undefined, waypoints: [{ x: 280, y: 290 }] }] };
  await importDocument(page, manual); expect(await exportDocument(page)).toEqual(JSON.parse(JSON.stringify(manual)));
  const headers = { origin: new URL(process.env.DIANTUO_TEST_URL).origin };
  const accepted = await page.request.post('/api/circuits', { headers, data: { title: legacy.title, document: legacy } });
  expect(accepted.status()).toBe(201);
  const apiSaved = (await accepted.json()).circuit;
  expect(apiSaved.document.wires[0]).toMatchObject({ style: 'orthogonal', routing: 'duct', waypoints: legacy.wires[0].waypoints });
  const readback = await page.request.get(`/api/circuits/${apiSaved.id}`); expect(readback.status()).toBe(200);
  expect((await readback.json()).circuit.document).toEqual(apiSaved.document);
  const totalBefore = (await (await page.request.get('/api/circuits')).json()).total;
  const invalids = [
    { ...smallDocument, wires: [{ ...wire, routing: 'unknown-routing' }] },
    { ...smallDocument, wires: [{ ...wire, waypoints: [{ x: 1, y: 2, futurePointField: true }] }] },
    { ...smallDocument, wires: [{ ...wire, from: { ...wire.from, futureTerminalField: true } }] },
    { ...smallDocument, components: [{ ...ports[0], position: { ...ports[0].position, futurePointField: true } }, ports[1]], wires: [] },
  ];
  for (const invalid of invalids) expect((await page.request.post('/api/circuits', { headers, data: { title: 'Rejected future fields', document: invalid } })).status()).toBe(400);
  expect((await (await page.request.get('/api/circuits')).json()).total).toBe(totalBefore);
});

test('integrated: cross-document group paste remains one undo operation and running interruptions cannot edit it', async ({ page }) => {
  await login(page); await newDocument(page);
  await importDocument(page, { ...smallDocument, wires: [{ ...wire, style: 'curve', routing: undefined, waypoints: [{ x: 320, y: 260 }] }] });
  await collapseDiagram(page); await page.locator('.react-flow__controls-fitview').click();
  await page.locator('[data-device-id="ia"]').click(); await page.locator('[data-device-id="ib"]').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: '复制选中对象', exact: true }).focus(); await page.keyboard.press('Control+c');
  await newDocument(page);
  await importDocument(page, { schemaVersion: 1, title: 'Paste target', components: [{ id: 'ic', type: 'terminal', label: 'C', position: { x: 100, y: 300 } }], wires: [] });
  await page.getByRole('button', { name: '粘贴对象', exact: true }).focus();
  for (let index = 0; index < 8; index++) await page.keyboard.press('Control+v');
  await expect(page.locator('[data-device-id]')).toHaveCount(17); await expect(page.locator('.sim-wire')).toHaveCount(8);
  let document = await exportDocument(page); const copiedIds = new Set(document.components.filter(component => component.id !== 'ic').map(component => component.id));
  expect(copiedIds.size).toBe(16); expect(copiedIds.has('ia') || copiedIds.has('ib')).toBe(false);
  expect(document.wires.every(wire => copiedIds.has(wire.from.componentId) && copiedIds.has(wire.to.componentId) && wire.color === '#203040')).toBe(true);
  for (let index = 0; index < 8; index++) await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('[data-device-id]')).toHaveCount(1); await expect(page.locator('.sim-wire')).toHaveCount(0);
  for (let index = 0; index < 8; index++) await page.getByRole('button', { name: '重做', exact: true }).click();
  document = await exportDocument(page);
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.getByRole('button', { name: '开始仿真', exact: true }).click();
    await expect(page.getByRole('button', { name: '粘贴对象', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
    await page.keyboard.press('Control+v'); await page.keyboard.press('Delete');
    await expect(page.locator('[data-device-id]')).toHaveCount(17);
    await page.getByRole('button', { name: '结束仿真', exact: true }).click();
    expect(await exportDocument(page)).toEqual(document);
  }
});

test('integrated: switching an unsaved course preserves its parked circuit and failed quota preserves the active document', async ({ page }) => {
  await login(page); await newDocument(page); await importDocument(page, smallDocument);
  await disclosure(page); await page.getByLabel('电路标题', { exact: true }).fill('Uncommitted circuit retained');
  const retained = await exportDocument(page);
  await page.getByLabel('选择训练课程', { exact: true }).selectOption('motor-course-02');
  await page.getByRole('button', { name: '本机暂存', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '本机暂存 · 当前账号', exact: true });
  await dialog.locator('div').filter({ has: page.getByText(retained.title, { exact: true }) }).getByRole('button', { name: '恢复接线', exact: true }).click();
  expect(await exportDocument(page)).toEqual(retained);
  const recoveryBefore = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('diantuo:simulator:recovery:')).map(key => [key, localStorage.getItem(key)])));
  await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith('diantuo:simulator:recovery:')) throw new DOMException('Fixture quota', 'QuotaExceededError'); return original.call(this, key, value); }; });
  await page.getByLabel('选择训练课程', { exact: true }).selectOption('motor-course-03');
  await expect(page.getByRole('alert').first()).toContainText('已保留当前画布'); expect(await exportDocument(page)).toEqual(retained);
  expect(await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('diantuo:simulator:recovery:')).map(key => [key, localStorage.getItem(key)])))).toEqual(recoveryBefore);
});

test('integrated: upload reference and undo restore the authenticated PNG preview and modal keys leave wiring intact', async ({ page }) => {
  await login(page); await newDocument(page); await importDocument(page, smallDocument);
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=', 'base64');
  const uploading = page.waitForResponse(response => response.url().endsWith('/api/media') && response.request().method() === 'POST');
  await page.locator('input[type="file"][accept="image/png,image/jpeg,image/webp"]').setInputFiles({ name: 'fixture-reference.png', mimeType: 'image/png', buffer: bytes });
  const response = await uploading; expect(response.status()).toBe(201); const media = (await response.json()).media;
  const preview = page.locator(`.sim-diagram img[src="/api/media/${media.id}"]`);
  await expect(preview).toBeVisible(); await expect.poll(() => preview.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  const uploaded = await exportDocument(page); expect(uploaded.drawingMediaId).toBe(media.id);
  await collapseDiagram(page); await page.locator('.react-flow__controls-fitview').click(); await page.locator('[data-device-id="ia"]').click();
  await page.getByRole('button', { name: '展开图纸', exact: true }).click(); await page.getByRole('button', { name: '选择图纸', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '图纸选择', exact: true }); await expect(page.getByLabel('搜索参考图纸')).toBeFocused();
  await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v'); await page.keyboard.press('Delete'); await page.keyboard.press('Control+z');
  await expect(page.locator('[data-device-id]')).toHaveCount(2); await expect(dialog).toBeVisible();
  await dialog.getByRole('radio').first().check(); await dialog.getByRole('button', { name: '确认', exact: true }).click();
  expect((await exportDocument(page)).referenceDiagramId).toBeDefined(); await expect(preview).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); expect(await exportDocument(page)).toEqual(uploaded);
  await expect(preview).toBeVisible(); await expect.poll(() => preview.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
});

for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  test(`integrated: essential editing controls remain reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); await login(page);
    for (const name of ['开始仿真', '保存草稿', '检查接线', '导入本地保存的图纸', '导出图纸到本地', '收起图纸']) {
      const button = page.getByRole('button', { name, exact: true }); await button.scrollIntoViewIfNeeded(); await expect(button).toBeVisible(); await button.click({ trial: true });
      const box = await button.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    }
    await disclosure(page); const course = page.getByLabel('选择训练课程', { exact: true }); await course.selectOption('motor-course-02'); await disclosure(page, false);
    for (const name of ['导线全部入槽', '撤销', '复制选中对象', '粘贴对象']) { const control = page.getByRole('button', { name, exact: true }); await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible(); }
  });
}
