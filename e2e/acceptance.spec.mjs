import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pressAndHold } from './gestures.mjs';
const fixture = JSON.parse(await readFile(process.env.DIANTUO_BROWSER_FIXTURE, 'utf8'));
async function login(page, account = 0) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(fixture.accounts[account].username);
  await page.getByLabel('密码', { exact: true }).fill(fixture.accounts[account].password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始仿真', exact: true })).toBeVisible();
}
async function openDraft(page, draft) {
  await page.getByRole('link', { name: '个人中心', exact: true }).click();
  await page.getByRole('button', { name: '草稿箱', exact: true }).click();
  await page.getByLabel('每页草稿数量').selectOption('50');
  await page.getByRole('row').filter({ has: page.getByText(draft.title, { exact: true }) }).getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.locator('.sim-canvas-heading b')).toHaveText(draft.document.title);
  const collapse = page.getByRole('button', { name: '收起图纸', exact: true });
  if (await collapse.isVisible()) await collapse.click();
  await page.locator('.react-flow__controls-fitview').click();
}
async function tap(page, id) {
  const button = page.locator(`[data-device-id="${id}"] .sim-actuator`);
  await button.focus(); await button.press('Enter');
}
async function motor(page, id, active) { await expect(page.locator(`[data-device-id="${id}"]`)).toHaveClass(active ? /is-active/ : /^(?!.*is-active).*$/); }
async function toggle(page, id) { await page.locator(`[data-device-id="${id}"] .sim-toggle-actuator`).click(); }
for (let number = 1; number <= 10; number++) {
  const lesson = `motor-course-${String(number).padStart(2, '0')}`;
  test(`${lesson}: standard controls and passed assessment`, async ({ page }) => {
    await login(page); const draft = fixture.drafts[`${lesson}:correct`]; await openDraft(page, draft);
    await page.getByRole('button', { name: '检查接线', exact: true }).click();
    await expect(page.locator('.sim-assessment-status')).toContainText('课程通过');
    await page.getByRole('button', { name: '开始仿真', exact: true }).click();
    if ([8, 9].includes(number)) await page.getByRole('button', { name: '暂停计时', exact: true }).click();
    const roles = draft.document.roles; await toggle(page, roles.qf);
    const motors = Object.keys(roles).filter(role => /^m\d?$/.test(role));
    for (const role of motors) await motor(page, roles[role], false);
    if (number === 1) {
      const start = page.locator(`[data-device-id="${roles.sb}"] .sim-actuator`); await pressAndHold(page, start, () => motor(page, roles.m, true)); await motor(page, roles.m, false);
    } else if ([2, 3].includes(number)) { await tap(page, roles.sb2); await motor(page, roles.m, true); await tap(page, roles.sb1); await motor(page, roles.m, false); }
    else if ([4, 5, 6].includes(number)) {
      await tap(page, roles.sb1); await motor(page, roles.m, true); await expect(page.locator(`[data-device-id="${roles.m}"]`)).toHaveAttribute('data-runtime-direction', 'forward');
      await tap(page, roles.sb3); await tap(page, roles.sb2); await expect(page.locator(`[data-device-id="${roles.m}"]`)).toHaveAttribute('data-runtime-direction', 'reverse');
      if (number === 6) { await tap(page, roles.sq2); await expect(page.locator(`[data-device-id="${roles.m}"]`)).toHaveAttribute('data-runtime-direction', 'forward'); }
      await tap(page, roles.sb3); await motor(page, roles.m, false);
    } else if (number === 7) { await tap(page, roles.sb4); await motor(page, roles.m2, false); await tap(page, roles.sb3); await motor(page, roles.m1, true); await tap(page, roles.sb4); await motor(page, roles.m2, true); await tap(page, roles.sb2); await motor(page, roles.m2, false); await tap(page, roles.sb1); await motor(page, roles.m1, false); }
    else if ([8, 9].includes(number)) {
      await tap(page, roles.sb1); await motor(page, roles.m, number === 9);
      if (number === 9) await expect(page.locator(`[data-device-id="${roles.m}"]`)).toHaveAttribute('data-runtime-connection', 'star');
      for (let second = 0; second < 2; second++) await page.getByRole('button', { name: '推进 1 秒', exact: true }).click();
      await motor(page, roles.m, number === 9); await page.getByRole('button', { name: '推进 1 秒', exact: true }).click(); await motor(page, roles.m, true);
      if (number === 9) await expect(page.locator(`[data-device-id="${roles.m}"]`)).toHaveAttribute('data-runtime-connection', 'delta');
      await tap(page, roles.sb2); await motor(page, roles.m, false);
    } else { await tap(page, roles.sb2); await expect(page.locator(`[data-device-id="${roles.m}"]`)).toHaveAttribute('data-runtime-speed', 'low'); await tap(page, roles.sb3); await expect(page.locator(`[data-device-id="${roles.m}"]`)).toHaveAttribute('data-runtime-speed', 'high'); await tap(page, roles.sb1); await motor(page, roles.m, false); }
    await page.getByRole('button', { name: '结束仿真', exact: true }).click();
  });
  test(`${lesson}: missing protective earth is rejected`, async ({ page }) => {
    await login(page); await openDraft(page, fixture.drafts[`${lesson}:incorrect`]);
    await page.getByRole('button', { name: '检查接线', exact: true }).click();
    await expect(page.locator('.sim-assessment-status')).toContainText('接线未通过');
    await expect(page.locator('.sim-assessment-status')).not.toHaveClass(/passed/);
  });
}
test('real terminal drag, device move, zoom and reload retain world endpoints', async ({ page }) => {
  await login(page); await openDraft(page, fixture.drafts.wiring);
  const first = page.locator('[data-terminal-key="a::A"]'), last = page.locator('[data-terminal-key="b::A"]');
  // Fit View animates. Playwright hover waits for each handle's screen geometry
  // to become stable before reading coordinates for the real pointer gesture.
  await first.hover(); await last.hover();
  const a = await first.boundingBox(), b = await last.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 }); await page.mouse.up();
  await expect(page.locator('.sim-wire')).toHaveCount(1);
  const endpoints = async () => {
    const wire = await page.locator('.sim-wire').evaluate(element => ({ from: element.dataset.fromTerminal, to: element.dataset.toTerminal, fromWorld: JSON.parse(element.dataset.fromWorld), toWorld: JSON.parse(element.dataset.toWorld) }));
    for (const [terminal, point] of [[wire.from, wire.fromWorld], [wire.to, wire.toWorld]]) {
      const world = await page.locator(`[data-terminal-key="${terminal}"]`).evaluate(element => ({ x: Number(element.dataset.worldX), y: Number(element.dataset.worldY) })); expect(point).toEqual(world);
    }
    return wire;
  };
  const before = await endpoints(); const box = await page.locator('[data-device-id="b"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 15 }); await page.mouse.up();
  await expect.poll(async () => page.locator('.sim-wire').getAttribute('data-to-world')).not.toBe(JSON.stringify(before.toWorld));
  const moved = await endpoints(); expect(moved.toWorld).not.toEqual(before.toWorld);
  await page.locator('.react-flow__controls-zoomout').click(); expect(await endpoints()).toEqual(moved);
  const saved = page.waitForResponse(response => response.url().endsWith(`/api/circuits/${fixture.drafts.wiring.id}`) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click(); expect((await saved).status()).toBe(200);
  await page.reload(); await expect(page.locator('.sim-wire')).toHaveCount(1); expect(await endpoints()).toEqual(moved);
});
test('two browser accounts cannot open each other private drafts', async ({ page, browser }) => {
  await login(page); const other = await browser.newContext(); const pageB = await other.newPage();
  try {
    await login(pageB, 1); await pageB.getByRole('link', { name: '个人中心', exact: true }).click(); await pageB.getByRole('button', { name: '草稿箱', exact: true }).click();
    await expect(pageB.getByText('草稿箱还是空的')).toBeVisible();
    const denied = await pageB.request.get(`/api/circuits/${fixture.drafts.wiring.id}`); expect(denied.status()).toBe(404);
    const owned = await page.request.get(`/api/circuits/${fixture.drafts.wiring.id}`); expect(owned.status()).toBe(200);
  } finally { await other.close(); }
});
test('corrupt recovery bytes survive a storage quota failure', async ({ page }) => {
  await login(page);
  const user = (await (await page.request.get('/api/session')).json()).user;
  const key = `diantuo:simulator:recovery:v1:${user.id}`, raw = '{corrupt fixture';
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key, raw });
  await page.reload(); await expect(page.getByRole('alert').first()).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('diantuo:simulator:recovery:')) throw new DOMException('Fixture quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.getByText('课程与草稿', { exact: true }).click(); await page.getByLabel('电路标题', { exact: true }).fill('Quota fixture retained');
  await expect(page.getByRole('alert').first()).toContainText('恢复记录无法写入');
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw);
  await expect(page.getByLabel('电路标题', { exact: true })).toHaveValue('Quota fixture retained');
});
test('two windows surface a save conflict without overwriting the winner', async ({ page, browser }) => {
  await login(page); await openDraft(page, fixture.drafts.conflict);
  const context = await browser.newContext({ viewport: { width: 1700, height: 1100 } }); const second = await context.newPage();
  try {
    await login(second); await openDraft(second, fixture.drafts.conflict);
    await page.getByText('课程与草稿', { exact: true }).click(); await page.getByLabel('电路标题', { exact: true }).fill('Winner title');
    const winning = page.waitForResponse(response => response.url().endsWith(`/api/circuits/${fixture.drafts.conflict.id}`) && response.request().method() === 'PUT');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click(); expect((await winning).status()).toBe(200);
    await second.getByText('课程与草稿', { exact: true }).click(); await second.getByLabel('电路标题', { exact: true }).fill('Losing title');
    const losing = second.waitForResponse(response => response.url().endsWith(`/api/circuits/${fixture.drafts.conflict.id}`) && response.request().method() === 'PUT');
    await second.getByRole('button', { name: '保存草稿', exact: true }).click(); expect((await losing).status()).toBe(409);
    await expect(second.getByRole('dialog', { name: '草稿存在更新', exact: true })).toBeVisible();
    const current = await (await page.request.get(`/api/circuits/${fixture.drafts.conflict.id}`)).json(); expect(current.circuit.title).toBe('Winner title');
    await expect(second.getByLabel('电路标题', { exact: true })).toHaveValue('Losing title');
  } finally { await context.close(); }
});
test('late JSON import cannot replace a newer simulation session', async ({ page }) => {
  await login(page); await openDraft(page, fixture.drafts.wiring);
  const count = await page.locator('[data-device-id]').count(), title = await page.locator('.sim-canvas-heading b').textContent();
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function() { return new Promise((resolve, reject) => { window.releaseFixtureImport = () => original.call(this).then(resolve, reject); }); };
  });
  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles({ name: 'late.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, title: 'Late import', components: [], wires: [] })) });
  await expect.poll(() => page.evaluate(() => typeof window.releaseFixtureImport)).toBe('function');
  await page.getByRole('button', { name: '开始仿真', exact: true }).click(); await page.evaluate(() => window.releaseFixtureImport());
  await expect(page.locator('.sim-toast')).toContainText('读取期间'); await expect(page.locator('.sim-canvas-heading b')).toHaveText(title); await expect(page.locator('[data-device-id]')).toHaveCount(count);
  await page.getByRole('button', { name: '结束仿真', exact: true }).click();
});
test('reference picker traps focus and prevents editor keyboard deletion', async ({ page }) => {
  await login(page); await openDraft(page, fixture.drafts.wiring);
  await page.locator('[data-device-id="a"]').click();
  await page.getByRole('button', { name: '展开图纸', exact: true }).click();
  const trigger = page.getByRole('button', { name: '选择图纸', exact: true }); await trigger.click();
  const dialog = page.getByRole('dialog', { name: '图纸选择', exact: true }); await expect(page.getByLabel('搜索参考图纸')).toBeFocused();
  await page.keyboard.press('Delete'); await expect(page.locator('[data-device-id]')).toHaveCount(2);
  await dialog.getByRole('button', { name: '取消', exact: true }).focus(); await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]'))).toBe(true);
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
});
test('Ctrl+C/Ctrl+V retain duct dimensions and group wire references, one undo removes the paste', async ({ page }) => {
  await login(page); await openDraft(page, fixture.drafts.clipboard);
  await expect(page.getByRole('button', { name: '复制选中对象', exact: true })).toBeVisible();
  const count = () => page.locator('[data-device-id]').count();
  const exportDocument = async () => {
    await page.getByRole('button', { name: '导出图纸到本地', exact: true }).click();
    const document = JSON.parse(await page.getByLabel('导出的电路 JSON', { exact: true }).inputValue());
    await page.getByRole('button', { name: '关闭电路文件窗口', exact: true }).click(); return document;
  };
  await page.locator('[data-device-id="duct"]').click();
  await page.getByRole('button', { name: '复制选中对象', exact: true }).focus();
  await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v'); await expect(page.locator('[data-device-id]')).toHaveCount(4);
  let document = await exportDocument(); const ducts = document.components.filter(component => component.type === 'wire-duct');
  expect(ducts).toHaveLength(2); expect(ducts[1].size).toEqual(ducts[0].size); expect(ducts[1].id).not.toBe(ducts[0].id);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); expect(await count()).toBe(3);
  await page.locator('[data-device-id="a"]').click(); await page.locator('[data-device-id="b"]').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: '复制选中对象', exact: true }).focus(); await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
  await expect(page.locator('[data-device-id]')).toHaveCount(5); await expect(page.locator('.sim-wire')).toHaveCount(2);
  document = await exportDocument(); const original = new Set(['a', 'b', 'duct']); const newIds = new Set(document.components.filter(component => !original.has(component.id)).map(component => component.id));
  expect(newIds.size).toBe(2); const internal = document.wires.filter(wire => wire.id !== 'internal'); expect(internal).toHaveLength(1);
  expect(newIds.has(internal[0].from.componentId) && newIds.has(internal[0].to.componentId)).toBe(true); expect(internal[0].color).toBe('#203040');
  await page.getByRole('button', { name: '撤销', exact: true }).click(); expect(await count()).toBe(3); await expect(page.locator('.sim-wire')).toHaveCount(1);
});
