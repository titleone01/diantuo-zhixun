import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertDrawingRecordOrigin, importTrainingDrawings, readDrawingJson, trainingDrawingFetch, trainingDrawingOptions, trainingDrawingOrigin } from "../scripts/import-training-drawings.mjs";
import { testTrainingDrawings } from "../scripts/test-training-drawings.mjs";

const isolatedOrigin = "http://127.0.0.1:45678";

test("drawing tools retain legacy defaults and accept explicit isolated artifact and credential paths", () => {
  const local = path.resolve(import.meta.dirname, "../.local");
  const original = trainingDrawingOptions("import", [], {});
  assert.equal(original.origin, "http://localhost:3000");
  assert.equal(original.adminPath, path.join(local, "admin-access.json"));
  assert.equal(original.manifestPath, path.join(local, "training-drawing-import.json"));
  const directory = path.resolve("temp", "drawing-fixture");
  const options = trainingDrawingOptions("import", [], {
    DIANTUO_TEST_URL: isolatedOrigin,
    DIANTUO_TEST_ADMIN_PATH: path.join(directory, "admin-access.json"),
    DIANTUO_TEST_ARTIFACT_DIR: path.join(directory, "artifacts"),
  });
  assert.equal(options.origin, isolatedOrigin);
  assert.equal(options.adminPath, path.join(directory, "admin-access.json"));
  assert.equal(options.manifestPath, path.join(directory, "artifacts", "training-drawing-import.json"));
  assert.equal(options.accountsPath, path.join(directory, "artifacts", "test-accounts.json"));
  const fromManifest = trainingDrawingOptions("test", ["--url", isolatedOrigin, "--manifest", path.join(directory, "explicit-import.json")], {});
  assert.equal(fromManifest.accountsPath, path.join(directory, "test-accounts.json"));
  assert.equal(fromManifest.evidencePath, path.join(directory, "training-drawing-acceptance.json"));
  const fromArgs = trainingDrawingOptions("import", ["--url", isolatedOrigin, "--artifact-dir", directory, "--admin-file", path.join(directory, "admin.json")], { DIANTUO_TEST_URL: "http://localhost:3000", DIANTUO_TEST_ARTIFACT_DIR: "wrong", DIANTUO_TEST_ADMIN_PATH: "wrong.json" });
  assert.equal(fromArgs.origin, isolatedOrigin);
  assert.equal(fromArgs.adminPath, path.join(directory, "admin.json"));
  assert.equal(fromArgs.artifactDirectory, directory);
});

test("isolated origins cannot silently fall back to project credentials or old evidence", () => {
  assert.throws(() => trainingDrawingOptions("import", ["--url", isolatedOrigin], {}), /独立图纸证据/);
  assert.throws(() => trainingDrawingOptions("import", ["--url", isolatedOrigin, "--artifact-dir", "temp/artifacts"], {}), /临时管理员/);
  assert.throws(() => trainingDrawingOptions("import", ["--admin-file", "temp/admin.json", "--artifact-dir", "temp/artifacts"], {}), /避免误写默认站点/);
  assert.throws(() => trainingDrawingOptions("test", ["--url", isolatedOrigin], {}), /独立图纸证据/);
  const oldAccounts = path.resolve(import.meta.dirname, "../.local/test-accounts.json");
  assert.throws(() => trainingDrawingOptions("test", ["--url", isolatedOrigin, "--artifact-dir", "temp/artifacts", "--accounts-file", oldAccounts], {}), /旧账号/);
  assert.throws(() => trainingDrawingOptions("import", ["--admin-file"], {}), /需要参数/);
});

test("drawing origins reject remote hosts and URL credentials; fixture credentials without an origin remain supported", () => {
  for (const url of ["https://example.com", "http://user:secret@localhost:3000", "file:///tmp", `${isolatedOrigin}/api`, `${isolatedOrigin}?token=secret`, "not-a-url"]) assert.throws(() => trainingDrawingOrigin(url), /loopback/);
  assert.equal(trainingDrawingOrigin(`${isolatedOrigin}/`), isolatedOrigin);
  assert.doesNotThrow(() => assertDrawingRecordOrigin({ username: "fixture_admin" }, isolatedOrigin, "管理员记录"));
  assert.throws(() => assertDrawingRecordOrigin({ origin: "http://localhost:3000" }, isolatedOrigin, "管理员记录"), /不一致/);
  assert.throws(() => assertDrawingRecordOrigin({}, isolatedOrigin, "导入清单", { required: true }), /缺少 origin/);
});

test("member drawing verification rejects mismatched evidence or account origins before any request", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "diantuo-drawing-options-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const request = t.mock.method(globalThis, "fetch", () => { throw new Error("must not send credentials"); });
  const args = ["--url", isolatedOrigin, "--artifact-dir", directory];
  await writeFile(path.join(directory, "training-drawing-import.json"), JSON.stringify({ origin: "http://localhost:3000" }));
  await assert.rejects(testTrainingDrawings(args, {}), /导入清单.*不一致/);
  await writeFile(path.join(directory, "training-drawing-import.json"), JSON.stringify({ origin: isolatedOrigin, entries: [] }));
  await writeFile(path.join(directory, "test-accounts.json"), JSON.stringify({ origin: "http://localhost:3000", accounts: [{ username: "fake", password: "fake" }] }));
  await assert.rejects(testTrainingDrawings(args, {}), /成员账号记录.*不一致/);
  assert.equal(request.mock.callCount(), 0);
});

test("import validates a recorded administrator origin before login and leaves source images unchanged", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "diantuo-drawing-import-options-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stems = ["电动机点动控制电路", "电动机连续运行控制电路", "点动与连续运行电路", "接触器互锁正反转电路", "双重联锁正反转控制电路", "自动往返控制电路", "顺序控制电路", "延时起动控制电路", "Y-△降压起动控制电路", "双速电机运行控制电路"];
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j44kAAAAASUVORK5CYII=", "base64");
  for (const stem of stems) for (const suffix of ["原理图", "布局图"]) await writeFile(path.join(directory, `${stem}${suffix}.png`), bytes);
  const adminPath = path.join(directory, "admin.json");
  await writeFile(adminPath, JSON.stringify({ origin: "http://localhost:3000", username: "fake-admin", password: "fake-password" }));
  const request = t.mock.method(globalThis, "fetch", () => { throw new Error("must not send credentials"); });
  await assert.rejects(importTrainingDrawings(["--directory", directory, "--url", isolatedOrigin, "--admin-file", adminPath, "--artifact-dir", directory], {}), /管理员记录.*不一致/);
  assert.equal(request.mock.callCount(), 0);
  assert.deepEqual(await readFile(path.join(directory, `${stems[0]}原理图.png`)), bytes);
});

test("malformed credential JSON does not expose its contents in the reported error", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "diantuo-drawing-json-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "admin.json");
  await writeFile(filename, '{"password":"fixture-secret", broken}');
  await assert.rejects(readDrawingJson(filename), error => !error.message.includes("fixture-secret") && error.message.includes("内容未输出"));
});

test("drawing requests have a finite deadline, forbid redirects, and never retry timed-out mutations", async t => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, "timeout", milliseconds => { assert.equal(milliseconds, 15000); return controller.signal; });
  const request = t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.redirect, "error");
    assert.equal(init.method, "PUT");
    return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  });
  const pending = trainingDrawingFetch(`${isolatedOrigin}/api/training-projects/project-01`, { method: "PUT" });
  const rejected = assert.rejects(pending, error => error.name === "TimeoutError");
  controller.abort(new DOMException("fixture timeout", "TimeoutError"));
  await rejected;
  assert.equal(request.mock.callCount(), 1);
});
