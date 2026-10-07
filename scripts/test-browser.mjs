import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildRelease } from './release-tools.mjs';
import { createFixture } from './isolated-fixture.mjs';
import { lessonFunctions, TestClient } from './test-fixtures.mjs';
import { importTrainingDrawings } from './import-training-drawings.mjs';
const root = path.resolve(import.meta.dirname, '..');
const filter = process.argv.slice(2);
if (filter.length && (filter.length !== 2 || filter[0] !== '--grep' || !filter[1])) throw new Error('Expected --grep <test title pattern> or no arguments');
const directory = await mkdtemp(path.join(tmpdir(), 'diantuo-browser-'));
const release = path.join(directory, 'release'); await buildRelease(release);
const fixture = await createFixture({ release, directory: path.join(directory, 'runtime') });
try {
  const admin = new TestClient(fixture.origin); await admin.login(JSON.parse(await readFile(fixture.adminFile, 'utf8')));
  // The browser suite owns this temporary course association and all media bytes.
  const drawing = await readFile(path.join(root, 'public/schematic.png'));
  const form = new FormData(); form.append('file', new Blob([drawing], { type: 'image/png' }), 'synthetic-modal.png');
  const uploaded = await fetch(`${fixture.origin}/api/media`, { method: 'POST', headers: { cookie: admin.cookie, origin: fixture.origin }, body: form });
  assert.equal(uploaded.status, 201); const media = (await uploaded.json()).media;
  const linked = await admin.call('/training-projects/project-01', 'PUT', { mediaId: media.id, kind: 'schematic', expectedVersion: null });
  assert.equal(linked.status, 200);
  let drawingEntries = [];
  if (process.env.DIANTUO_TERMINAL_DRAWINGS) {
    const artifactDirectory = path.join(directory, 'drawing-evidence');
    await importTrainingDrawings(['--directory', process.env.DIANTUO_TERMINAL_DRAWINGS, '--replace', '--url', fixture.origin, '--admin-file', fixture.adminFile, '--artifact-dir', artifactDirectory]);
    drawingEntries = JSON.parse(await readFile(path.join(artifactDirectory, 'training-drawing-import.json'), 'utf8')).entries;
    await admin.login(JSON.parse(await readFile(fixture.adminFile, 'utf8')));
  }
  const projects = await admin.call('/training-projects'); assert.equal(projects.status, 200);
  const project = projects.data.items.find(item => item.id === 'project-01'); assert(project);
  const modalCourse = { id: project.id, name: project.name };
  const { LESSONS, createLessonDocument } = await lessonFunctions();
  const accounts = [];
  for (let index = 0; index < 2; index++) {
    const credentials = { username: `browser_${index}_${randomBytes(4).toString('hex')}`, name: `浏览器验收 ${index + 1}`, password: randomBytes(20).toString('base64url') };
    const invite = await admin.call('/invites', 'POST', { expiresInHours: 1 }); assert.equal(invite.status, 201);
    const client = new TestClient(fixture.origin); assert.equal((await client.call('/invites/accept', 'POST', { ...credentials, token: invite.data.invite.token })).status, 201);
    await client.login(credentials); accounts.push(credentials);
  }
  const client = new TestClient(fixture.origin); await client.login(accounts[0]);
  const lessons = LESSONS.filter(lesson => lesson.id.startsWith('motor-course-'));
  const drafts = {};
  for (const lesson of lessons) {
    const correct = createLessonDocument(lesson.id, { wired: true });
    // Remove protective earth only: a structurally valid but unsafe wiring case.
    const incorrect = { ...correct, wires: correct.wires.filter(wire => wire.from.terminalId !== 'PE' && wire.to.terminalId !== 'PE') };
    for (const [kind, document] of Object.entries({ correct, incorrect })) {
      const title = `Browser ${lesson.id} ${kind}`;
      const saved = await client.call('/circuits', 'POST', { title, document }); assert.equal(saved.status, 201);
      drafts[`${lesson.id}:${kind}`] = { title, id: saved.data.circuit.id, document };
    }
  }
  const wiring = { schemaVersion: 1, title: 'Browser wiring', components: [{ id: 'a', type: 'terminal', label: 'A', position: { x: 80, y: 100 } }, { id: 'b', type: 'terminal', label: 'B', position: { x: 450, y: 160 } }], wires: [] };
  const saved = await client.call('/circuits', 'POST', { title: wiring.title, document: wiring }); assert.equal(saved.status, 201);
  drafts.wiring = { title: wiring.title, id: saved.data.circuit.id, document: wiring };
  const clipboard = { ...wiring, title: 'Browser clipboard', components: [...wiring.components, { id: 'duct', type: 'wire-duct', label: 'WD1', position: { x: 100, y: 350 }, size: { width: 600, height: 60 } }], wires: [{ id: 'internal', from: { componentId: 'a', terminalId: 'A' }, to: { componentId: 'b', terminalId: 'A' }, color: '#203040' }] };
  const copied = await client.call('/circuits', 'POST', { title: clipboard.title, document: clipboard }); assert.equal(copied.status, 201);
  drafts.clipboard = { title: clipboard.title, id: copied.data.circuit.id, document: clipboard };
  const conflict = await client.call('/circuits', 'POST', { title: 'Browser conflict', document: { ...wiring, title: 'Browser conflict' } }); assert.equal(conflict.status, 201);
  drafts.conflict = { title: 'Browser conflict', id: conflict.data.circuit.id, document: conflict.data.circuit.document };
  const dataFile = path.join(directory, 'browser-fixture.json'); await writeFile(dataFile, JSON.stringify({ accounts, drafts, modalCourse, drawingEntries }), { mode: 0o600 });
  await fixture.run([path.join(root, 'node_modules/playwright/cli.js'), 'test', '--config', path.join(root, 'playwright.config.mjs'), ...filter], { DIANTUO_TEST_URL: fixture.origin, DIANTUO_BROWSER_FIXTURE: dataFile, DIANTUO_BROWSER_PRIVATE_OUTPUT: path.join(directory, 'private-results') }, 900000);
} catch (error) { console.error(`浏览器验收失败（${error.name}）；测试专属证据目录：${directory}`); process.exitCode = 1; }
finally { await fixture.stop(); }
