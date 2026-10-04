import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const fixture = JSON.parse(await readFile(process.env.DIANTUO_BROWSER_FIXTURE, 'utf8'));

async function geometry(page) {
  return page.locator('.sim-diagram').evaluate(panel => {
    const rect = panel.getBoundingClientRect(), board = panel.closest('.sim-canvas');
    return { width: rect.width, height: rect.height, offsetWidth: panel.offsetWidth, inlineWidth: panel.style.width, boardWidth: board.clientWidth };
  });
}

async function resizeWidthWithMouse(page, requestedWidth) {
  const before = await geometry(page);
  const handle = page.locator('[data-resize-edge="w"]'), box = await handle.boundingBox();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // The component snapshots offsetWidth on pointerdown. Moving the west edge
  // left by this exact delta requests 560, even with fractional layout pixels.
  const end = { x: start.x - (requestedWidth - before.offsetWidth), y: start.y };
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 }); await page.mouse.up();
  const settledWidths = await page.locator('.sim-diagram').evaluate(panel => new Promise(resolve => {
    const widths = [];
    const record = () => { widths.push(panel.getBoundingClientRect().width); if (widths.length === 30) resolve(widths); else requestAnimationFrame(record); };
    requestAnimationFrame(record);
  }));
  return { requestedWidth, before, drag: { start, end }, after: await geometry(page), settledWidths };
}

test('final schematic: a mouse resize to exactly 560 preserves manual width and reset restores responsive sizing', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 }); await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(fixture.accounts[0].username);
  await page.getByLabel('密码', { exact: true }).fill(fixture.accounts[0].password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始仿真', exact: true })).toBeVisible();
  const initial = await geometry(page);
  expect(initial.boardWidth).toBeGreaterThan(576);
  expect(initial.width).toBeLessThan(560);
  const manual = await resizeWidthWithMouse(page, 560);
  const evidence = process.env.DIANTUO_FINAL_REVIEW_EVIDENCE;
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await writeFile(path.join(evidence, 'manual-560.json'), JSON.stringify({ viewport: { width: 1366, height: 900 }, initial, manual }, null, 2));
    await page.screenshot({ path: path.join(evidence, 'manual-560.png') });
  }
  expect(manual.after.inlineWidth, 'manual 560 must not be interpreted as the responsive default').toBe('560px');
  expect(manual.settledWidths.every(width => Math.abs(width - 560) < 0.5)).toBe(true);
  await page.getByRole('button', { name: '收起图纸', exact: true }).click();
  await page.getByRole('button', { name: '展开图纸', exact: true }).click();
  expect((await geometry(page)).width).toBeCloseTo(560, 0);
  await page.getByRole('button', { name: '全屏查看图纸', exact: true }).click();
  await page.keyboard.press('Escape');
  expect((await geometry(page)).width).toBeCloseTo(560, 0);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await geometry(page)).width).toBeCloseTo(560, 0);
  await page.getByRole('button', { name: '复位图纸窗口', exact: true }).click();
  const reset = await geometry(page);
  expect(reset.inlineWidth).toContain('50%'); expect(reset.width).toBeLessThan(560);
  await page.setViewportSize({ width: 1366, height: 900 });
  expect((await geometry(page)).width).toBeCloseTo(initial.width, 0);
  // A second manual resize after reset must acquire manual intent again.
  const repeated = await resizeWidthWithMouse(page, 560);
  expect(repeated.after.inlineWidth).toBe('560px');
  expect(repeated.settledWidths.every(width => Math.abs(width - 560) < 0.5)).toBe(true);
  if (evidence) await writeFile(path.join(evidence, 'reset-repeat.json'), JSON.stringify({ reset, repeated }, null, 2));
});
