import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { activateRelease, backupState, buildRelease, inventory, restoreState, sha256, stateBusinessDigest, verifyArchive } from "./release-tools.mjs";
import { createFixture } from "./isolated-fixture.mjs";
import { runPersistenceTest } from "./test-persistence.mjs";
import { launch, localOnlyEnvironment } from './backend-test-runner.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(path.join(tmpdir(), "diantuo-recovery-"));
let original, restored, operator;
try {
  const release = process.argv[2] ? path.resolve(process.argv[2]) : path.join(directory, "release-v1");
  if (!process.argv[2]) await buildRelease(release);
  const v1 = await verifyArchive(release, "release");
  original = await createFixture({ release });
  console.log("[recovery] Seed isolated accounts, drafts, publications and attachments");
  await original.run(["--test", "tests/backend.integration.test.mjs"], original.env);
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
  // A source file in a separate development directory cannot hot-reload this bundled Worker.
  const development = path.resolve(import.meta.dirname, '../worker/local.ts'), sourceBytes = await readFile(development);
  try {
    await writeFile(development, "throw new Error('isolated development change must not reach released runtime');");
    await delay(1000);
    assert.equal((await fetch(`${restored.origin}/api/session`)).status, 200);
  } finally { await writeFile(development, sourceBytes); }
  assert.ok(restored.config.main.startsWith(v2path));
  await restored.stop();
  const latestState = await stateBusinessDigest(restored.state);
  await activateRelease(release, runtime, { stopped: true, origin: restored.origin, leaseFile: restored.leaseFile });
  assert.equal(await stateBusinessDigest(restored.state), latestState);
  restored = await createFixture({ release, directory: runtime, config: restoredConfig, origin: original.origin, initialize: false });
  assert.doesNotMatch(await (await fetch(restored.origin)).text(), /recovery-release/);
  await runPersistenceTest(restored.env);
  await restored.stop();
  // Exercise the exact operator-facing entry point, without bootstrap/migrations.
  operator = launch(['scripts/start-release.mjs', runtime, String(new URL(restored.origin).port)], path.resolve(import.meta.dirname, '..'), { ...localOnlyEnvironment(process.env), CI: 'true', WRANGLER_WRITE_LOGS: 'false' }, 120000);
  const deadline = Date.now() + 60000;
  for (;;) {
    if (Date.now() > deadline || operator.child.exitCode !== null) throw new Error('Operator runtime readiness failed');
    const response = await fetch(`${restored.origin}/api/session`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
    if (response?.ok) break; await delay(250);
  }
  await runPersistenceTest(restored.env); await operator.stop();
  await verifyArchive(backup, "backup");
  const result = { verifiedAt: new Date().toISOString(), releaseV1: v1.id, releaseV2: v2.id, offline, loginsDraftPublicationAttachmentsPermissions: true, rollbackRetainsLatestState: true, sourceIsolation: true, operatorEntryPoint: true, privateRuntimeRestored: true, nonemptyRestoreRefused: true };
  await writeFile(path.join(directory, "recovery-result.json"), JSON.stringify(result, null, 2));
  const publicEvidence = path.resolve(import.meta.dirname, '../.local/acceptance-public'); await mkdir(publicEvidence, { recursive: true });
  await writeFile(path.join(publicEvidence, 'recovery.json'), JSON.stringify(result, null, 2));
  console.log(`恢复及版本回退演练通过；脱敏结果：${path.join(directory, "recovery-result.json")}`);
} catch (error) { console.error(`Recovery rehearsal failed: ${error.name}; retained at ${directory}`); process.exitCode = 1; }
finally { await operator?.stop(); await restored?.stop(); await original?.stop(); }
