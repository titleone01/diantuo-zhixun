import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const fixture = JSON.parse(await readFile(process.env.DIANTUO_BROWSER_FIXTURE, 'utf8'));

async function openDrawing(page) {
  await page.goto('/');
  await page.getByLabel('账号', { exact: true }).fill(fixture.accounts[0].username);
  await page.getByLabel('密码', { exact: true }).fill(fixture.accounts[0].password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始仿真', exact: true })).toBeVisible();
  const panel = page.locator('.sim-diagram');
  await panel.getByRole('button', { name: '选择项目图纸', exact: true }).click();
  await panel.getByLabel('选择训练项目图纸', { exact: true }).selectOption(fixture.modalCourse.id);
  await expect(panel.getByRole('button', { name: '用于当前练习', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '用于当前练习', exact: true }).click();
  await expect.poll(() => panel.locator('.dt-drawing-viewer-content img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  return panel;
}

async function measure(panel) {
  return panel.evaluate(element => {
    const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const box = rect(element), viewer = rect(element.querySelector('.dt-drawing-viewer-viewport'));
    const controls = [...element.querySelectorAll('.sim-diagram-header button, .dt-project-toolbar button, .dt-project-toolbar a, .sim-diagram-tools button')].filter(node => node.getClientRects().length).map(node => {
      const bounds = rect(node), hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      return { label: node.getAttribute('aria-label') || node.textContent.trim(), ...bounds, receivesPointer: !!hit && (node === hit || node.contains(hit)) };
    });
    return { panel: box, viewer, drawingShare: viewer.height / box.height, headerHeight: element.querySelector('.sim-diagram-header').getBoundingClientRect().height, footerHeight: element.querySelector('.sim-diagram-tools').getBoundingClientRect().height, contentOverflow: element.scrollWidth > element.clientWidth + 1, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, controls };
  });
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  test(`floating drawing compact: image space and reachable controls at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const panel = await openDrawing(page);
    const initial = await measure(panel);
    expect(initial.drawingShare, 'the drawing should occupy at least three quarters of the floating window').toBeGreaterThanOrEqual(0.75);
    expect(initial.headerHeight).toBeLessThanOrEqual(37);
    expect(initial.footerHeight).toBeLessThanOrEqual(37);
    expect(initial.contentOverflow).toBe(false);
    expect(initial.pageOverflow).toBe(false);
    for (const control of initial.controls) {
      expect(control.x, control.label).toBeGreaterThanOrEqual(initial.panel.x);
      expect(control.right, control.label).toBeLessThanOrEqual(initial.panel.right + 1);
      expect(control.receivesPointer, control.label).toBe(true);
    }
    await expect(panel.getByRole('link', { name: '查看原图', exact: true })).toHaveAttribute('href', /^\/api\/media\//);
    await panel.getByRole('tab', { name: '元件布置图', exact: true }).click();
    await expect(panel.getByRole('tab', { name: '元件布置图', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(panel.locator('.dt-drawing-viewer')).toHaveAttribute('data-drawing-zoom', '1');
    await panel.getByRole('tab', { name: '原理图', exact: true }).click();
    for (let index = 0; index < 8; index++) await panel.getByRole('button', { name: '放大图纸', exact: true }).click();
    await expect(panel.locator('.dt-drawing-viewer')).toHaveAttribute('data-drawing-zoom', '3');
    const area = panel.locator('.dt-drawing-viewer-viewport');
    await expect.poll(() => area.evaluate(node => node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)).toBe(true);
    const box = await area.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 50, box.y + box.height / 2 - 50, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => area.evaluate(node => node.scrollTop + node.scrollLeft)).toBeGreaterThan(0);
    await panel.getByRole('button', { name: '适应图纸', exact: true }).click();
    await expect(panel.locator('.dt-drawing-viewer')).toHaveAttribute('data-drawing-zoom', '1');
    await panel.getByRole('button', { name: '放大查看', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: '关闭放大图纸', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await panel.getByRole('button', { name: '选择项目图纸', exact: true }).click();
    await expect(panel.getByLabel('选择训练项目图纸', { exact: true })).toBeVisible();
    await panel.getByRole('button', { name: '收起项目选项', exact: true }).click();
    const evidence = process.env.DIANTUO_FINAL_REVIEW_EVIDENCE;
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await writeFile(path.join(evidence, `compact-drawing-${viewport.width}.json`), JSON.stringify({ viewport, initial, afterInteraction: await measure(panel), productionDataUsed: false }, null, 2));
      await panel.screenshot({ path: path.join(evidence, `compact-drawing-${viewport.width}.png`) });
    }
  });
}
