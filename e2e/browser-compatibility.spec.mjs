import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('browser compatibility: missing recent APIs still allow editing, saving and recovery', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Array.prototype, 'at', { configurable: true, writable: true, value: undefined });
    Object.defineProperty(globalThis, 'structuredClone', { configurable: true, writable: true, value: undefined });
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, writable: true, value: undefined });
  });
  await page.goto(process.env.DIANTUO_STATIC_URL);
  await expect(page.getByRole('button', { name: '开始仿真', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '添加两极断路器', exact: true }).click();
  await expect(page.locator('[data-component-type="breaker2"]')).toHaveCount(1);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('已保存在此浏览器', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-component-type="breaker2"]')).toHaveCount(1);
  await expect(page.locator('#dt-startup')).toHaveCount(0);
});

test('browser compatibility: IE and Edge Legacy show an actionable message', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (Windows NT 10.0; Trident/7.0; rv:11.0) like Gecko' }));
  await page.goto(process.env.DIANTUO_STATIC_URL);
  await expect(page.getByRole('heading', { name: '请使用新版浏览器打开', exact: true })).toBeVisible();
  await expect(page.getByText('BROWSER_UNSUPPORTED', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '下载新版 Microsoft Edge' })).toHaveAttribute('href', 'https://www.microsoft.com/zh-cn/edge/download');
  await expect(page.getByRole('button', { name: '开始仿真', exact: true })).toHaveCount(0);
  await mkdir('.local/acceptance-public', { recursive: true });
  await page.screenshot({ path: '.local/acceptance-public/browser-compat-unsupported-20261015.png' });
});

test('browser compatibility: a failed application download does not leave a blank page', async ({ page }) => {
  await page.route(/\/assets\/index-[^/]+\.js$/, route => route.abort('failed'));
  await page.goto(process.env.DIANTUO_STATIC_URL);
  await expect(page.getByRole('heading', { name: '实训工作台暂时未能打开', exact: true })).toBeVisible();
  await expect(page.getByText('APP_RESOURCE_FAILED', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/acceptance-public/browser-compat-resource-20261015.png' });
});
