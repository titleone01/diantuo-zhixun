import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// The coordinator runner supplies only its new synthetic member and course media.
const fixture = JSON.parse(await readFile(process.env.DIANTUO_BROWSER_FIXTURE, 'utf8'));
const evidence = process.env.DIANTUO_FINAL_REVIEW_EVIDENCE;

async function settle(page) {
  await page.getByRole('dialog').waitFor({ state: 'visible' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.querySelectorAll('.dt-reference-modal img')].map(img =>
      img.complete ? undefined : new Promise(resolve => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); })));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function measure(page, scenario, phase) {
  return page.locator('.dt-reference-modal').evaluate((modal, { scenario, phase }) => {
    const footer = modal.querySelector('.dt-modal-actions');
    const practice = [...footer.querySelectorAll('button')].find(button => button.textContent.trim() === '进入电路配置');
    const area = modal.querySelector('.dt-drawing-viewer-viewport, .dt-reference-video');
    const rect = element => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom }; };
    const m = rect(modal), f = rect(footer), b = rect(practice);
    const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return { scenario, phase, noLocatorHover: true,
      modal: { ...m, clientHeight: modal.clientHeight, scrollHeight: modal.scrollHeight, scrollTop: modal.scrollTop, overflowY: getComputedStyle(modal).overflowY },
      footer: f, practice: b, practiceReceivesPointer: !!hit && (hit === practice || practice.contains(hit)),
      footerFullyVisible: f.y >= m.y && f.bottom <= m.bottom + 1 && f.bottom <= innerHeight + 1,
      practiceFullyVisible: b.x >= 0 && b.y >= m.y && b.right <= innerWidth + 1 && b.bottom <= m.bottom + 1 && b.bottom <= innerHeight + 1,
      area: area ? { ...rect(area), scrollTop: area.scrollTop, clientHeight: area.clientHeight, scrollHeight: area.scrollHeight, overflowY: getComputedStyle(area).overflowY } : null,
      viewport: { width: innerWidth, height: innerHeight },
    };
  }, { scenario, phase });
}

async function open(page, scenario) {
  await page.getByRole('link', { name: '图纸集', exact: true }).click();
  await expect(page.locator('.dt-reference-card')).toHaveCount(10);
  await page.locator('.dt-reference-card').filter({ has: page.getByText(fixture.modalCourse.name, { exact: true }) }).click();
  if(scenario==='course-layout')await page.getByRole('dialog').getByRole('tab',{name:'元件布置图',exact:true}).click();
  await settle(page);
}

async function snapshot(page, name, measurement) {
  if (!evidence) return;
  const x = Math.max(0, measurement.modal.x), y = Math.max(0, measurement.modal.y);
  const width = Math.min(measurement.modal.right, measurement.viewport.width) - x;
  const height = Math.min(measurement.modal.bottom, measurement.viewport.height) - y;
  if (width > 0 && height > 0) await page.screenshot({ path: path.join(evidence, name), clip: { x, y, width, height } });
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 1024, height: 768 }]) {
  test(`final modal: initial fixed actions without hover at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    expect(fixture.modalCourse, 'The standard runner must seed its owned synthetic course drawing').toBeTruthy();
    if (evidence) await mkdir(evidence, { recursive: true });
    await page.setViewportSize(viewport);
    // Embedded third-party players are not started during this local layout check.
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(process.env.DIANTUO_TEST_URL).origin || ['data:', 'blob:'].includes(url.protocol)) await route.continue();
      else await route.abort();
    });
    const results = [], issues = [];
    let step = 'login';
    try {
      await page.goto('/');
      await page.getByLabel('账号', { exact: true }).fill(fixture.accounts[0].username);
      await page.getByLabel('密码', { exact: true }).fill(fixture.accounts[0].password);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(page.getByRole('button', { name: '开始仿真', exact: true })).toBeVisible();
      for (const scenario of ['course-drawing', 'course-layout']) {
        step = `${scenario}:open`;
        await open(page, scenario);
        const initial = await measure(page, scenario, 'initial');
        results.push(initial);
        await snapshot(page, `${viewport.width}-${scenario}-initial.png`, initial);
        if (initial.modal.scrollTop !== 0) issues.push(`${scenario}: initial outer scroll is not zero`);
        if (initial.modal.overflowY !== 'hidden') issues.push(`${scenario}: computed outer overflow is ${initial.modal.overflowY}`);
        if (!initial.footerFullyVisible || !initial.practiceFullyVisible || !initial.practiceReceivesPointer) issues.push(`${scenario}: initial action area is not wholly visible and pointer-accessible`);

        step = `${scenario}:interior-scroll`;
        for (let index = 0; index < 5; index++) await page.getByRole('dialog').getByRole('button', { name: '放大原图', exact: true }).click();
        await settle(page);
        const enlarged = await measure(page, scenario, 'before-interior-wheel');
        results.push(enlarged);
        if (enlarged.area) {
          await page.mouse.move(enlarged.area.x + enlarged.area.width / 2, enlarged.area.y + enlarged.area.height / 2);
          await page.mouse.wheel(0, 900);
          if (enlarged.area.scrollHeight > enlarged.area.clientHeight + 1) await expect.poll(async () => (await measure(page, scenario, 'poll')).area.scrollTop).toBeGreaterThan(enlarged.area.scrollTop);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        }
        const scrolled = await measure(page, scenario, 'after-interior-wheel');
        results.push(scrolled);
        if (scrolled.modal.scrollTop !== 0 || Math.abs(scrolled.footer.y - initial.footer.y) > 1 || Math.abs(scrolled.footer.bottom - initial.footer.bottom) > 1) issues.push(`${scenario}: interior scroll moved the outer action area`);

        step = `${scenario}:footer-wheel`;
        await page.mouse.move(scrolled.practice.x + scrolled.practice.width / 2, scrolled.practice.y + scrolled.practice.height / 2);
        await page.mouse.wheel(0, 900);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const final = await measure(page, scenario, 'after-footer-wheel');
        results.push(final);
        if (final.modal.scrollTop !== 0 || !final.practiceFullyVisible || !final.practiceReceivesPointer) issues.push(`${scenario}: footer wheel moved or hid actions`);
        await snapshot(page, `${viewport.width}-${scenario}-scrolled.png`, final);
        // A real mouse click uses the already measured visible position, never locator auto-scroll.
        if (initial.practiceFullyVisible && final.practiceFullyVisible && final.practiceReceivesPointer) {
          await page.mouse.click(final.practice.x + final.practice.width / 2, final.practice.y + final.practice.height / 2); await page.getByRole('button', {name:'创建练习',exact:true}).click();
          await expect(page.getByRole('dialog')).toHaveCount(0);
          await expect(page.getByRole('button', { name: '开始仿真', exact: true })).toBeVisible();
        } else await page.locator('.dt-reference-modal > header button').click();
      }
      step = 'complete';
    } finally {
      if (evidence) await writeFile(path.join(evidence, `${viewport.width}.json`), JSON.stringify({ viewport, step, initialNoHover: true, productionDataUsed: false, scenarios: results, issues }, null, 2));
    }
    expect(issues, 'The action area must start visible and stay fixed while only inner content scrolls').toEqual([]);
  });
}
