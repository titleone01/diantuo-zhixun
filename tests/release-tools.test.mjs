import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { activateRelease, backupState, buildDocumentContract, containedPath, emptyDestination, inventory, restoreState, stateBusinessDigest, verifyArchive } from "../scripts/release-tools.mjs";
import { unusedPort } from "../scripts/backend-test-runner.mjs";

test("archives reject traversal, modified bytes, extra files and nonempty restore targets", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "diantuo-archive-test-"));
  for (const name of ["../escape", "/escape", "a\\b", ""]) assert.throws(() => containedPath(directory, name));
  await writeFile(path.join(directory, "sample"), "valid");
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ format: 1, kind: "release", files: await inventory(directory) }));
  await verifyArchive(directory, "release");
  await writeFile(path.join(directory, "sample"), "wrong");
  await assert.rejects(verifyArchive(directory, "release"), /hashes/);
  await assert.rejects(emptyDestination(directory), /nonempty/);
  await assert.rejects(restoreState(directory, path.join(directory, "restored")), /destination/);
});

test('archive verification is independent of manifest key order and filename locale', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'diantuo-archive-order-test-'));
  for (const name of ['a', 'Z', '中文']) await writeFile(path.join(directory, name), 'owned fixture bytes');
  const files = Object.fromEntries(Object.entries(await inventory(directory)).reverse().map(([name, item]) => [name, { sha256: item.sha256, bytes: item.bytes }]));
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ format: 1, kind: 'release', files }));
  await verifyArchive(directory, 'release');
});

test("quiescent state backup includes WAL, checks hashes and code rollback retains newest state", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "diantuo-archive-test-"));
  const state = path.join(directory, "runtime/state");
  await mkdir(state, { recursive: true });
  await writeFile(path.join(state, "sample-wal"), "wal bytes");
  const stop = { stopped: true, origin: `http://127.0.0.1:${await unusedPort()}`, leaseFile: path.join(directory, "absent-lease.json") };
  const backup = path.join(directory, "backup");
  await assert.rejects(backupState(state, backup, { ...stop, stopped: false }), /acknowledgement/);
  await backupState(state, backup, stop);
  const restored = path.join(directory, "restored");
  await restoreState(backup, restored);
  assert.equal(await readFile(path.join(restored, "state/sample-wal"), "utf8"), "wal bytes");
  await assert.rejects(restoreState(backup, restored), /nonempty/);
  await assert.rejects(restoreState(backup, path.join(backup, 'nested')), /destination/);
  const release = path.join(directory, "release"); await mkdir(release);
  await writeFile(path.join(release, "code.js"), "version 1");
  await buildDocumentContract(release);
  await writeFile(path.join(release, "manifest.json"), JSON.stringify({ format: 1, kind: "release", id: "v1", files: await inventory(release) }));
  await writeFile(path.join(state, "new-write"), "latest work");
  await activateRelease(release, path.join(directory, "runtime"), stop);
  assert.equal(await readFile(path.join(state, "new-write"), "utf8"), "latest work");
  await writeFile(stop.leaseFile, JSON.stringify({ pid: process.pid }));
  await assert.rejects(activateRelease(release, path.join(directory, "runtime"), stop), /live process/);
});

test('activation and rollback check saved drafts, publications, terminals, fields and applied migrations', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const directory = await mkdtemp(path.join(tmpdir(), 'diantuo-contract-test-'));
  const runtime = path.join(directory, 'runtime'), state = path.join(runtime, 'state'), release = path.join(directory, 'release');
  await mkdir(state, { recursive: true }); await mkdir(release);
  await buildDocumentContract(release);
  const contract = JSON.parse(await readFile(path.join(release, 'document-contract.json'), 'utf8'));
  assert.ok(contract.fields.wire.includes('from'));
  assert.ok(contract.components.some(component => component.type === 'terminal' && component.terminals.includes('A')));
  await mkdir(path.join(release, 'migrations'));
  await writeFile(path.join(release, 'migrations/0001_test.sql'), '-- fixture migration');
  const seal = async () => { await writeFile(path.join(release, 'manifest.json'), JSON.stringify({ format: 1, kind: 'release', id: 'fixture', files: await inventory(release, new Set(['manifest.json'])) })); };
  await seal();
  const db = new DatabaseSync(path.join(state, 'fixture.sqlite'));
  db.exec("CREATE TABLE d1_migrations(name TEXT); INSERT INTO d1_migrations VALUES('0001_test.sql'); CREATE TABLE circuits(document TEXT); CREATE TABLE publications(document TEXT)");
  const document = { schemaVersion: 1, title: 'Owned fixture', components: [{ id: 'a', type: 'terminal', label: 'A', position: { x: 0, y: 0 } }, { id: 'b', type: 'terminal', label: 'B', position: { x: 200, y: 0 } }], wires: [{ id: 'w', from: { componentId: 'a', terminalId: 'A' }, to: { componentId: 'b', terminalId: 'B' }, color: '#000000' }] };
  db.prepare('INSERT INTO circuits VALUES(?)').run(JSON.stringify(document));
  db.prepare('INSERT INTO publications VALUES(?)').run(JSON.stringify(document));
  const stop = { stopped: true, origin: `http://127.0.0.1:${await unusedPort()}`, leaseFile: path.join(directory, 'absent-lease') };
  try {
    await activateRelease(release, runtime, stop);
    const pointer = await readFile(path.join(runtime, 'active-release.json'));
    const rejected = async (pattern) => {
      const before = await stateBusinessDigest(state);
      await assert.rejects(activateRelease(release, runtime, stop), pattern);
      assert.deepEqual(await readFile(path.join(runtime, 'active-release.json')), pointer);
      assert.equal(await stateBusinessDigest(state), before);
    };
    db.prepare('UPDATE circuits SET document=?').run(JSON.stringify({ ...document, components: [{ ...document.components[0], type: 'future-fuse' }] }));
    await rejected(/cannot interpret/);
    db.prepare('UPDATE circuits SET document=?').run(JSON.stringify(document));
    db.prepare('UPDATE publications SET document=?').run(JSON.stringify({ ...document, wires: [{ ...document.wires[0], futureRouting: 'future-routing' }] }));
    await rejected(/cannot interpret/);
    db.prepare('UPDATE publications SET document=?').run('{corrupt');
    await rejected(/corrupt/);
    db.prepare('UPDATE publications SET document=?').run(JSON.stringify(document));
    const narrower = { ...contract, components: contract.components.map(component => component.type === 'terminal' ? { ...component, terminals: component.terminals.filter(id => id !== 'A') } : component) };
    await writeFile(path.join(release, 'document-contract.json'), JSON.stringify(narrower)); await seal();
    await rejected(/lacks stored terminals/);
    await writeFile(path.join(release, 'document-contract.json'), JSON.stringify(contract)); await seal();
    db.exec("INSERT INTO d1_migrations VALUES('0002_future.sql')");
    await rejected(/schema differ/);
  } finally { db.close(); }
});

test('private runtime files restore byte-for-byte without printing their contents', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'diantuo-private-backup-test-'));
  const state = path.join(directory, 'state'), privateDirectory = path.join(directory, 'private');
  await mkdir(state); await mkdir(privateDirectory); await writeFile(path.join(state, 'blob'), 'owned test data');
  await writeFile(path.join(privateDirectory, 'admin.json'), '{"fixture":"opaque test credentials"}');
  const stop = { stopped: true, origin: `http://127.0.0.1:${await unusedPort()}`, leaseFile: path.join(directory, 'absent-lease'), privateDirectory };
  await assert.rejects(backupState(state, path.join(privateDirectory, 'backup'), stop), /outside/);
  const backup = path.join(directory, 'backup'), restored = path.join(directory, 'restored');
  await backupState(state, backup, stop); await restoreState(backup, restored);
  assert.deepEqual(await readFile(path.join(restored, '.local/admin.json')), await readFile(path.join(privateDirectory, 'admin.json')));
  await verifyArchive(backup, 'backup');
});
