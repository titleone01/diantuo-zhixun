import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const fixture = JSON.parse(await readFile(process.env.DIANTUO_BROWSER_FIXTURE, 'utf8'));
const evidence = path.resolve('.local/integration-audit/layout');
async function stableViewport(page) {
  await page.locator('.react-flow__viewport').evaluate(element => new Promise(resolve => {
    let last = '', stable = 0;
    const check = () => { const next = element.style.transform; stable = next === last ? stable + 1 : 0; last = next; if (stable >= 15) resolve(); else requestAnimationFrame(check); };
    requestAnimationFrame(check);
  }));
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }]) {
  test(`integrated layout: titles, controls and drawings at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByLabel('账号', { exact: true }).fill(fixture.accounts[0].username);
    await page.getByLabel('密码', { exact: true }).fill(fixture.accounts[0].password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('button', { name: '开始仿真', exact: true })).toBeVisible();
    await page.getByRole('link', { name: '个人中心', exact: true }).click();
    await page.getByRole('button', { name: '草稿箱', exact: true }).click();
    await page.getByLabel('每页草稿数量').selectOption('50');
    const draft = fixture.drafts['motor-course-09:correct'];
    await page.getByRole('row').filter({ has: page.getByText(draft.title, { exact: true }) }).getByRole('button', { name: '编辑', exact: true }).click();
    await expect(page.locator('.sim-canvas-heading b')).toHaveText(draft.document.title);
    await mkdir(evidence, { recursive: true });
    await page.locator('.react-flow__controls-fitview').click();
    await stableViewport(page);
    await page.screenshot({ path: path.join(evidence, `${viewport.width}-drawing.png`) });
    const collapse = page.getByRole('button', { name: '收起图纸', exact: true });
    if (await collapse.isVisible()) await collapse.click();
    await page.locator('.react-flow__controls-fitview').click();
    await stableViewport(page);
    const layout = await page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      return { heading: rect('.dt-document-disclosure > summary'), actions: rect('.sim-document-actions'), canvas: rect('.sim-canvas'), pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
    });
    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    const overlap = layout.heading.x < layout.actions.right && layout.heading.right > layout.actions.x && layout.heading.y < layout.actions.bottom && layout.heading.bottom > layout.actions.y;
    expect(overlap, 'canvas title must not collide with upload/save/publish').toBe(false);
    await page.getByRole('button', { name: '上传图纸', exact: true }).hover();
    await page.screenshot({ path: path.join(evidence, `${viewport.width}-circuit.png`) });
    await writeFile(path.join(evidence, `${viewport.width}.json`), JSON.stringify(layout, null, 2));
    await page.getByRole('button', { name: '展开图纸', exact: true }).click();
    await page.getByRole('button', { name: '选择图纸', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: path.join(evidence, `${viewport.width}-picker.png`) });
    const dialog = await page.getByRole('dialog').boundingBox();
    expect(dialog.x).toBeGreaterThanOrEqual(0);
    expect(dialog.y).toBeGreaterThanOrEqual(0);
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(dialog.y + dialog.height).toBeLessThanOrEqual(viewport.height + 1);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('link', { name: '图纸集', exact: true }).click();
    await page.getByRole('tab', { name: /^工业电路图纸/ }).click();
    await page.locator('.dt-reference-card').first().click();
    const courseDialog = page.getByRole('dialog');
    await expect(courseDialog).toBeVisible();
    const practice = courseDialog.getByRole('button', { name: '进入电路配置', exact: true });
    await practice.hover();
    const buttonRect = await practice.boundingBox(), modalRect = await courseDialog.boundingBox();
    expect(buttonRect.y + buttonRect.height).toBeLessThanOrEqual(modalRect.y + modalRect.height);
    expect(buttonRect.y + buttonRect.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: path.join(evidence, `${viewport.width}-course-modal.png`) });
  });
}
