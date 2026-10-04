import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createFixture } from './isolated-fixture.mjs';
import { buildRelease } from './release-tools.mjs';
import { TestClient } from './test-fixtures.mjs';
import { importTrainingDrawings } from './import-training-drawings.mjs';
import { testTrainingDrawings } from './test-training-drawings.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function argument(argv, key) {
  const index = argv.indexOf(key); if (index === -1) return undefined;
  if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`${key} requires a value`);
  return argv[index + 1];
}

/** Explicit local source directory only. All uploads/accounts belong to a fresh isolated DB. */
export async function testFormalDrawings(argv = process.argv.slice(2)) {
  const directory = argument(argv, '--directory');
  if (!directory) throw new Error('Usage: node scripts/test-formal-drawings.mjs --directory <20 original PNGs> [--evidence <public JSON>]');
  if (argv.some((value, index) => index % 2 === 0 && !['--directory', '--evidence'].includes(value))) throw new Error('Unsupported argument');
  const evidenceFile = path.resolve(argument(argv, '--evidence') || path.join(root, '.local/acceptance-public/formal-drawings.json'));
  const temporary = await mkdtemp(path.join(tmpdir(), 'diantuo-formal-drawings-'));
  const release = path.join(temporary, 'release');
  let fixture, browser;
  const evidence = { at: new Date().toISOString(), status: 'running', scope: '20 original local PNGs; fresh isolated DB and two synthetic members; no production writes', tests: [], images: [] };
  const step = async (title, action) => { const started = Date.now(); try { const result = await action(); evidence.tests.push({ title, status: 'passed', durationMs: Date.now() - started }); return result; } catch (error) { evidence.tests.push({ title, status: 'failed', durationMs: Date.now() - started, error: error.name }); throw error; } };
  try {
    await step('Build current code into an isolated release', () => buildRelease(release));
    fixture = await createFixture({ release, directory: path.join(temporary, 'runtime') });
    evidence.origin = fixture.origin;
    const admin = new TestClient(fixture.origin); await admin.login(JSON.parse(await readFile(fixture.adminFile, 'utf8')));
    const accounts = [];
    for (let index = 0; index < 2; index++) {
      const credentials = { username: `formal_${index}_${randomBytes(4).toString('hex')}`, name: `Isolated formal member ${index + 1}`, password: randomBytes(24).toString('base64url') };
      const invite = await admin.call('/invites', 'POST', { expiresInHours: 1 }); assert.equal(invite.status, 201);
      const member = new TestClient(fixture.origin); assert.equal((await member.call('/invites/accept', 'POST', { ...credentials, token: invite.data.invite.token })).status, 201); accounts.push(credentials);
    }
    const artifacts = path.join(temporary, 'private-artifacts'); await mkdir(artifacts, { recursive: true });
    const accountsFile = path.join(artifacts, 'accounts.json'); await writeFile(accountsFile, JSON.stringify({ origin: fixture.origin, accounts }), { mode: 0o600 });
    const manifestFile = path.join(artifacts, 'import.json');
    await step('Import and hash-read twenty original PNGs', () => importTrainingDrawings(['--directory', directory, '--url', fixture.origin, '--admin-file', fixture.adminFile, '--manifest', manifestFile, '--artifact-dir', artifacts], {}));
    const initial = JSON.parse(await readFile(manifestFile, 'utf8')); assert.equal(initial.uploaded, 20);
    const api = await step('Two synthetic members read forty matching PNGs; twenty anonymous media requests and list are denied', () => testTrainingDrawings(['--url', fixture.origin, '--manifest', manifestFile, '--accounts-file', accountsFile, '--artifact-dir', artifacts], {}));
    evidence.memberReads = api.memberReads; evidence.anonymousMediaDenied = api.anonymousDenied; evidence.anonymousListDenied = true;
    await step('Repeating the import preserves all associations and uploads zero duplicates', () => importTrainingDrawings(['--directory', directory, '--url', fixture.origin, '--admin-file', fixture.adminFile, '--manifest', manifestFile, '--artifact-dir', artifacts], {}));
    const repeated = JSON.parse(await readFile(manifestFile, 'utf8')); assert.equal(repeated.uploaded, 0); assert.equal(repeated.unchanged, 20);
    assert.deepEqual(repeated.entries.map(entry => entry.mediaId), initial.entries.map(entry => entry.mediaId));
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1700, height: 1100 }, baseURL: fixture.origin });
    const page = await context.newPage(); await page.goto('/');
    await page.getByLabel('账号', { exact: true }).fill(accounts[0].username); await page.getByLabel('密码', { exact: true }).fill(accounts[0].password);
    await page.getByRole('button', { name: '登录', exact: true }).click(); await page.getByRole('button', { name: '开始仿真', exact: true }).waitFor();
    for (let index = 1; index <= 10; index++) {
      const projectId = `project-${String(index).padStart(2, '0')}`;
      await step(`Chromium loads the original schematic and layout for ${projectId}`, async () => {
        const expand = page.getByRole('button', { name: '展开图纸', exact: true }); if (await expand.isVisible()) await expand.click();
        const options = page.getByRole('button', { name: '选择项目图纸', exact: true }); if (await options.isVisible()) await options.click();
        await page.getByLabel('选择训练项目图纸', { exact: true }).selectOption(projectId);
        for (const [kind, name] of [['schematic', '原理图'], ['layout', '元件布置图']]) {
          await page.getByRole('tab', { name, exact: true }).click();
          const entry = initial.entries.find(item => item.projectId === projectId && item.kind === kind);
          const image = page.locator(`.dt-project-preview img[src="/api/media/${entry.mediaId}"]`); await image.waitFor({ state: 'visible' });
          await page.waitForFunction(id => { const image = document.querySelector(`.dt-project-preview img[src="/api/media/${id}"]`); return image?.complete && image.naturalWidth > 0; }, entry.mediaId);
          const browserRead = await page.request.get(`/api/media/${entry.mediaId}`); assert.equal(browserRead.status(), 200); assert.equal(sha256(await browserRead.body()), entry.sha256);
          const dimensions = await image.evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight }));
          evidence.images.push({ projectId, kind, name: entry.name, sha256: entry.sha256, bytes: entry.size, browserDecoded: true, ...dimensions });
        }
      });
    }
    await step('Source PNGs retain their original hashes after import and browser readback', async () => { for (const entry of initial.entries) assert.equal(sha256(await readFile(path.join(directory, entry.name))), entry.sha256); });
    assert.equal(evidence.images.length, 20); evidence.status = 'passed'; evidence.sourceImages = 20; evidence.browserImages = 20; evidence.importUploads = 20; evidence.repeatedImportUploads = 0;
    console.log('Formal drawings passed: 20 original PNGs, 40 member hash reads, 20 anonymous denials plus list, 20 Chromium decodes, repeat import 0 uploads.');
  } catch (error) {
    evidence.status = 'failed'; evidence.error = error.name;
    await writeFile(path.join(temporary, 'private-failure.txt'), String(error.stack || error), { mode: 0o600 });
    throw Object.assign(new Error(`Formal drawing validation failed (${error.name}); private synthetic fixture evidence: ${temporary}`), { cause: error });
  } finally {
    if (browser) await browser.close(); if (fixture) await fixture.stop();
    evidence.completedAt = new Date().toISOString(); await mkdir(path.dirname(evidenceFile), { recursive: true }); await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  return evidence;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await testFormalDrawings(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
