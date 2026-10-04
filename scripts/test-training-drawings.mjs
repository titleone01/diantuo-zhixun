import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertDrawingRecordOrigin, assertIsolatedDrawingPaths, readDrawingJson, trainingDrawingFetch, trainingDrawingOptions, trainingDrawingOrigin } from "./import-training-drawings.mjs";

export async function testTrainingDrawings(argv = process.argv.slice(2), environment = process.env) {
  const paths = trainingDrawingOptions("test", argv, environment);
  const manifest = await readDrawingJson(paths.manifestPath);
  const origin = paths.origin || trainingDrawingOrigin(manifest.origin);
  assertDrawingRecordOrigin(manifest, origin, "导入清单", { required: true });
  if (new URL(origin).protocol !== "http:" || new URL(origin).port !== "3000") assertIsolatedDrawingPaths("test", paths);
  const accountRecord = await readDrawingJson(paths.accountsPath);
  assertDrawingRecordOrigin(accountRecord, origin, "成员账号记录");
  const { accounts } = accountRecord;
  const hash = value => createHash("sha256").update(value).digest("hex");
  assert.equal(manifest.entries.length, 20);
  assert.ok(Array.isArray(accounts) && accounts.length >= 2, "需要本次环境的两个成员账号");
  assert.notEqual(accounts[0].username, accounts[1].username, "需要两个不同的成员账号");
  let memberReads = 0, anonymousDenied = 0;
  for (const account of accounts.slice(0, 2)) {
    const login = await trainingDrawingFetch(`${origin}/api/auth/sign-in/username`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username: account.username, password: account.password }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    try {
      const session = await trainingDrawingFetch(`${origin}/api/session`, { headers: { cookie } }).then(response => response.json());
      assert.equal(session.user.role, "member");
      const response = await trainingDrawingFetch(`${origin}/api/training-projects`, { headers: { cookie } });
      assert.equal(response.status, 200);
      const { items } = await response.json(); assert.equal(items.length, 10);
      for (const project of items) {
        assert.deepEqual(project.media, project.drawings.schematic);
        for (const kind of ["schematic", "layout"]) {
          const expected = manifest.entries.find(entry => entry.projectId === project.id && entry.kind === kind);
          assert.ok(expected); assert.equal(project.drawings[kind]?.id, expected.mediaId);
          const media = await trainingDrawingFetch(`${origin}/api/media/${expected.mediaId}`, { headers: { cookie } });
          assert.equal(media.status, 200); assert.equal(media.headers.get("content-type"), "image/png");
          assert.equal(hash(Buffer.from(await media.arrayBuffer())), expected.sha256);
          memberReads += 1;
        }
      }
    } finally {
      await trainingDrawingFetch(`${origin}/api/auth/sign-out`, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: "{}" });
    }
  }
  assert.equal((await trainingDrawingFetch(`${origin}/api/training-projects`)).status, 401);
  for (const file of manifest.entries) {
    const response = await trainingDrawingFetch(`${origin}/api/media/${file.mediaId}`);
    assert.equal(response.status, 401); anonymousDenied += 1;
  }
  const evidence = { verifiedAt: new Date().toISOString(), origin, projects: 10, sourceImages: 20, memberReads, anonymousDenied, allHashesMatch: true, sourceDirectory: manifest.directory };
  await mkdir(paths.artifactDirectory, { recursive: true });
  await writeFile(paths.evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`真实图纸读取验证通过：2 位成员共 ${memberReads} 次读取，20 张图 SHA-256 全部一致；匿名 ${anonymousDenied} 次文件请求及项目列表均被拒绝。`);
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await testTrainingDrawings(); }
  catch (error) { console.error(error instanceof Error ? error.message : "图纸验收失败"); process.exitCode = 1; }
}
