import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { activateRelease, backupState, containedPath, emptyDestination, inventory, restoreState, verifyArchive } from "../scripts/release-tools.mjs";
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
  await assert.rejects(restoreState(directory, path.join(directory, "restored")), /manifest/);
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
  const release = path.join(directory, "release"); await mkdir(release);
  await writeFile(path.join(release, "code.js"), "version 1");
  await writeFile(path.join(release, "manifest.json"), JSON.stringify({ format: 1, kind: "release", id: "v1", files: await inventory(release) }));
  await writeFile(path.join(state, "new-write"), "latest work");
  await activateRelease(release, path.join(directory, "runtime"), stop);
  assert.equal(await readFile(path.join(state, "new-write"), "utf8"), "latest work");
  await writeFile(stop.leaseFile, JSON.stringify({ pid: process.pid }));
  await assert.rejects(activateRelease(release, path.join(directory, "runtime"), stop), /live process/);
});
