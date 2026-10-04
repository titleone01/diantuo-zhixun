import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { activateRelease, backupState, buildRelease, inventory, restoreState, sha256, stateBusinessDigest, verifyArchive } from "./release-tools.mjs";
import { createFixture } from "./isolated-fixture.mjs";
import { runPersistenceTest } from "./test-persistence.mjs";
import { launch, localOnlyEnvironment } from './backend-test-runner.mjs';
import { setTimeout as delay } from 'node:timers/promises';

class RecoveryClient {
  cookies = new Map();
  constructor(origin) { this.origin = origin; }
  async call(route, method = 'GET', body) {
    const headers = { cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '), ...(method !== 'GET' ? { origin: this.origin } : {}) };
    if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
    const response = await fetch(`${this.origin}/api${route}`, { method, headers, signal: AbortSignal.timeout(15000), ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) });
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';')[0], split = pair.indexOf('=');
      this.cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    return { status: response.status, data: response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  }
  async login(credentials) { assert.equal((await this.call('/auth/sign-in/username', 'POST', { username: credentials.username, password: credentials.password })).status, 200); }
}
const documentHash = document => sha256(Buffer.from(JSON.stringify(document)));
const recoveryPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlFQAAAAASUVORK5CYII=', 'base64');
function recoveryPdf() {
  const stream = 'BT /F1 12 Tf 20 80 Td (Latest recovery business) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let content = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => { const offset = Buffer.byteLength(content); content += `${index + 1} 0 obj\n${object}\nendobj\n`; return offset; });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}
async function seedLatestBusiness(environment) {
  // These credentials belong exclusively to this script's newly created fixture.
  const { accounts } = JSON.parse(await readFile(path.join(environment.DIANTUO_TEST_ARTIFACT_DIR, 'test-accounts.json'), 'utf8'));
  assert.equal(accounts.length, 2);
  const client = new RecoveryClient(environment.DIANTUO_TEST_URL); await client.login(accounts[0]);
  const document = { schemaVersion: 1, title: 'Recovery v1 pre-backup draft', components: [{ id: 'a', type: 'terminal', label: 'A', position: { x: 100, y: 100 } }, { id: 'b', type: 'terminal', label: 'B', position: { x: 400, y: 200 } }], wires: [{ id: 'w', from: { componentId: 'a', terminalId: 'A' }, to: { componentId: 'b', terminalId: 'A' }, color: '#112233' }] };
  const created = await client.call('/circuits', 'POST', { title: document.title, document }); assert.equal(created.status, 201);
  assert.equal(created.data.circuit.revision, 1);
  return { origin: environment.DIANTUO_TEST_URL, accounts, original: created.data.circuit, originalHash: documentHash(document) };
}
async function writeLatestBusiness(proof) {
  const client = new RecoveryClient(proof.origin); await client.login(proof.accounts[0]);
  const upload = async (bytes, name, type) => {
    const form = new FormData(); form.append('file', new File([bytes], name, { type }));
    const response = await client.call('/media', 'POST', form); assert.equal(response.status, 201); return response.data.media.id;
  };
  const pdfBytes = recoveryPdf();
  const privatePng = await upload(recoveryPng, 'new-private.png', 'image/png');
  const sharedPng = await upload(recoveryPng, 'new-shared.png', 'image/png');
  const sharedPdf = await upload(pdfBytes, 'new-shared.pdf', 'application/pdf');
  const oldDocument = { ...proof.original.document, title: 'Recovery v2 updated after backup', components: proof.original.document.components.map(component => component.id === 'b' ? { ...component, position: { x: 570, y: 220 } } : component), wires: proof.original.document.wires.map(wire => ({ ...wire, color: '#445566', routing: 'duct' })), drawingMediaId: privatePng, drawingMediaType: 'image/png', drawingKind: 'schematic' };
  const updated = await client.call(`/circuits/${proof.original.id}`, 'PUT', { title: oldDocument.title, document: oldDocument, revision: proof.original.revision }); assert.equal(updated.status, 200);
  proof.updated = updated.data.circuit; assert.equal(proof.updated.revision, 2); assert.notEqual(documentHash(proof.updated.document), proof.originalHash);
  const document = { ...proof.original.document, title: 'Recovery v2 new draft after backup', drawingMediaId: sharedPng, drawingMediaType: 'image/png', drawingKind: 'schematic', projectDrawings: { schematic: { mediaId: sharedPng, type: 'image/png' }, layout: { mediaId: sharedPdf, type: 'application/pdf' } } };
  const created = await client.call('/circuits', 'POST', { title: document.title, document }); assert.equal(created.status, 201); proof.newDraft = created.data.circuit;
  const published = await client.call(`/circuits/${proof.newDraft.id}/publish`, 'POST', { revision: proof.newDraft.revision }); assert.equal(published.status, 201); proof.publication = published.data.publication;
  proof.media = [{ id: privatePng, hash: sha256(recoveryPng), shared: false }, { id: sharedPng, hash: sha256(recoveryPng), shared: true }, { id: sharedPdf, hash: sha256(pdfBytes), shared: true }];
  proof.expected = await verifyLatestBusiness(proof);
}
async function verifyLatestBusiness(proof) {
  const owner = new RecoveryClient(proof.origin), other = new RecoveryClient(proof.origin), anonymous = new RecoveryClient(proof.origin);
  await owner.login(proof.accounts[0]); await other.login(proof.accounts[1]);
  for (const expected of [proof.updated, proof.newDraft]) {
    const response = await owner.call(`/circuits/${expected.id}`); assert.equal(response.status, 200);
    assert.equal(response.data.circuit.revision, expected.revision); assert.equal(response.data.circuit.title, expected.title);
    assert.equal(documentHash(response.data.circuit.document), documentHash(expected.document));
    assert.deepEqual([...response.data.circuit.mediaIds].sort(), [...expected.mediaIds].sort());
    assert.equal((await other.call(`/circuits/${expected.id}`)).status, 404);
    assert.equal((await other.call(`/circuits/${expected.id}`, 'PUT', { title: 'Forbidden update', document: expected.document, revision: expected.revision })).status, 404);
    assert.equal((await anonymous.call(`/circuits/${expected.id}`)).status, 401);
  }
  const publication = await other.call(`/publications/${proof.publication.id}`); assert.equal(publication.status, 200);
  assert.equal(publication.data.publication.sourceRevision, proof.publication.sourceRevision);
  assert.equal(documentHash(publication.data.publication.document), documentHash(proof.publication.document));
  assert.deepEqual([...publication.data.publication.mediaIds].sort(), [...proof.publication.mediaIds].sort());
  assert.equal((await anonymous.call(`/publications/${proof.publication.id}`)).status, 401);
  for (const media of proof.media) {
    const response = await owner.call(`/media/${media.id}`); assert.equal(response.status, 200); assert.equal(sha256(response.data), media.hash);
    const second = await other.call(`/media/${media.id}`); assert.equal(second.status, media.shared ? 200 : 404);
    if (media.shared) assert.equal(sha256(second.data), media.hash);
    assert.equal((await anonymous.call(`/media/${media.id}`)).status, 401);
  }
  assert.equal((await other.call('/session')).data.user.role, 'member'); assert.equal((await other.call('/invites')).status, 403);
  const stale = await owner.call(`/circuits/${proof.original.id}`, 'PUT', { title: 'Stale pre-backup save', document: proof.original.document, revision: proof.original.revision }); assert.equal(stale.status, 409);
  const retained = await owner.call(`/circuits/${proof.original.id}`); assert.equal(retained.status, 200); assert.equal(documentHash(retained.data.circuit.document), documentHash(proof.updated.document));
  return { updatedRevision: proof.updated.revision, updatedHash: documentHash(proof.updated.document), newDraftRevision: proof.newDraft.revision, newDraftHash: documentHash(proof.newDraft.document), publicationRevision: proof.publication.sourceRevision, publicationHash: documentHash(proof.publication.document), attachmentHashes: proof.media.map(media => media.hash), permissionsRetained: true, stalePreBackupRevisionRejected: true };
}
async function verifyOldBackup(backup, destination, proof) {
  await restoreState(backup, destination);
  const { DatabaseSync } = await import('node:sqlite'); let found = false;
  for (const name of Object.keys(await inventory(path.join(destination, 'state'))).filter(name => /\.(sqlite|sqlite3|db)$/.test(name))) {
    const db = new DatabaseSync(path.join(destination, 'state', name), { readOnly: true });
    try {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='circuits'").get()) continue;
      const old = db.prepare('SELECT revision,document FROM circuits WHERE id=?').get(proof.original.id); assert.ok(old); found = true;
      assert.equal(old.revision, 1); assert.equal(sha256(Buffer.from(old.document)), proof.originalHash);
      assert.equal(db.prepare('SELECT count(*) AS n FROM circuits WHERE id=?').get(proof.newDraft.id).n, 0);
      assert.equal(db.prepare('SELECT count(*) AS n FROM publications WHERE id=?').get(proof.publication.id).n, 0);
      for (const media of proof.media) assert.equal(db.prepare('SELECT count(*) AS n FROM media WHERE id=?').get(media.id).n, 0);
    } finally { db.close(); }
  }
  assert.ok(found); await verifyArchive(backup, 'backup');
}

const directory = await mkdtemp(path.join(tmpdir(), "diantuo-recovery-"));
let original, restored, operator;
try {
  const release = process.argv[2] ? path.resolve(process.argv[2]) : path.join(directory, "release-v1");
  if (!process.argv[2]) await buildRelease(release);
  const v1 = await verifyArchive(release, "release");
  original = await createFixture({ release });
  console.log("[recovery] Seed isolated accounts, drafts, publications and attachments");
  await original.run(["--test", "tests/backend.integration.test.mjs"], original.env);
  const latestBusiness = await seedLatestBusiness(original.env);
  await original.stop();
  await cp(original.adminFile, path.join(original.directory, 'artifacts/admin-access.json'));
  const stop = { stopped: true, origin: original.origin, leaseFile: original.leaseFile, privateConfig: path.join(original.directory, ".dev.vars"), runtimeConfig: path.join(original.directory, "wrangler.json"), privateDirectory: path.join(original.directory, 'artifacts') };
  const backup = path.join(directory, "backup");
  await backupState(original.state, backup, stop);
  const runtime = path.join(directory, "restored-runtime");
  const offline = await restoreState(backup, runtime);
  const restoredConfig = JSON.parse(await readFile(path.join(runtime, 'base-config.json'), 'utf8'));
  await cp(path.join(runtime, '.local/admin-access.json'), path.join(runtime, "admin-access.json"));
  await cp(path.join(runtime, '.local'), path.join(runtime, "artifacts"), { recursive: true });
  await assert.rejects(restoreState(backup, runtime), /nonempty/);
  // A test-only second release proves activation and rollback use distinct immutable bytes.
  const v2path = path.join(directory, "release-v2");
  await cp(release, v2path, { recursive: true });
  const html = path.join(v2path, "assets/index.html");
  await writeFile(html, (await readFile(html, "utf8")).replace("<head>", "<head><meta name=\"recovery-release\" content=\"v2\">"));
  const v2 = { ...v1, createdAt: new Date().toISOString(), files: await inventory(v2path, new Set(["manifest.json"])) };
  v2.id = sha256(JSON.stringify(v2.files));
  await writeFile(path.join(v2path, "manifest.json"), JSON.stringify(v2, null, 2));
  await activateRelease(v2path, runtime, stop);
  restored = await createFixture({ release: v2path, directory: runtime, config: restoredConfig, origin: original.origin, initialize: false });
  await runPersistenceTest(restored.env);
  assert.match(await (await fetch(restored.origin)).text(), /recovery-release/);
  console.log('[recovery] Write new business after the v1 backup, under v2');
  await writeLatestBusiness(latestBusiness);
  // A source file in a separate development directory cannot hot-reload this bundled Worker.
  const development = path.resolve(import.meta.dirname, '../worker/local.ts'), sourceBytes = await readFile(development);
  try {
    await writeFile(development, "throw new Error('isolated development change must not reach released runtime');");
    await delay(1000);
    assert.equal((await fetch(`${restored.origin}/api/session`)).status, 200);
  } finally { await writeFile(development, sourceBytes); }
  assert.ok(restored.config.main.startsWith(v2path));
  await restored.stop();
  await verifyOldBackup(backup, path.join(directory, 'old-backup-proof'), latestBusiness);
  const latestState = await stateBusinessDigest(restored.state);
  await activateRelease(release, runtime, { stopped: true, origin: restored.origin, leaseFile: restored.leaseFile });
  assert.equal(await stateBusinessDigest(restored.state), latestState);
  restored = await createFixture({ release, directory: runtime, config: restoredConfig, origin: original.origin, initialize: false });
  assert.doesNotMatch(await (await fetch(restored.origin)).text(), /recovery-release/);
  await runPersistenceTest(restored.env);
  assert.deepEqual(await verifyLatestBusiness(latestBusiness), latestBusiness.expected);
  await restored.stop();
  // Exercise the exact operator-facing entry point, without bootstrap/migrations.
  operator = launch(['scripts/start-release.mjs', runtime, String(new URL(restored.origin).port)], path.resolve(import.meta.dirname, '..'), { ...localOnlyEnvironment(process.env), CI: 'true', WRANGLER_WRITE_LOGS: 'false' }, 120000);
  const deadline = Date.now() + 60000;
  for (;;) {
    if (Date.now() > deadline || operator.child.exitCode !== null) throw new Error('Operator runtime readiness failed');
    const response = await fetch(`${restored.origin}/api/session`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
    if (response?.ok) break; await delay(250);
  }
  await runPersistenceTest(restored.env);
  assert.deepEqual(await verifyLatestBusiness(latestBusiness), latestBusiness.expected);
  await operator.stop();
  await verifyArchive(backup, "backup");
  const result = { verifiedAt: new Date().toISOString(), releaseV1: v1.id, releaseV2: v2.id, offline, loginsDraftPublicationAttachmentsPermissions: true, rollbackRetainsLatestState: true, latestBusinessAfterBackup: { ...latestBusiness.expected, oldBackupRetainsOriginalRevision: true, newBusinessAbsentFromOldBackup: true, operatorEntryPointVerified: true }, sourceIsolation: true, operatorEntryPoint: true, privateRuntimeRestored: true, nonemptyRestoreRefused: true };
  await writeFile(path.join(directory, "recovery-result.json"), JSON.stringify(result, null, 2));
  const publicEvidence = path.resolve(import.meta.dirname, '../.local/acceptance-public'); await mkdir(publicEvidence, { recursive: true });
  await writeFile(path.join(publicEvidence, 'recovery.json'), JSON.stringify(result, null, 2));
  console.log(`恢复及版本回退演练通过；脱敏结果：${path.join(directory, "recovery-result.json")}`);
} catch (error) {
  const privateReport = path.join(directory, 'private-error.json');
  const seen = new WeakSet();
  const diagnostic = JSON.stringify({ failedAt: new Date().toISOString(), error }, (_key, value) => {
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
      if (value instanceof Error) return Object.fromEntries(Object.getOwnPropertyNames(value).map(name => [name, value[name]]));
    }
    return value;
  }, 2);
  try { await writeFile(privateReport, diagnostic + '\n', { mode: 0o600 }); }
  catch { console.error('Could not write the private recovery diagnostic.'); }
  console.error(`Recovery rehearsal failed: ${error.name}; private diagnostic: ${privateReport}`);
  process.exitCode = 1;
}
finally { await operator?.stop(); await restored?.stop(); await original?.stop(); }
