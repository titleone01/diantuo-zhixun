import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const local = new URL("../.local/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("training-drawing-import.json", local), "utf8"));
const { accounts } = JSON.parse(await readFile(new URL("test-accounts.json", local), "utf8"));
const origin = process.env.DIANTUO_TEST_URL || manifest.origin;
const hash = value => createHash("sha256").update(value).digest("hex");
assert.equal(manifest.entries.length, 20);
let memberReads = 0, anonymousDenied = 0;
for (const account of accounts.slice(0, 2)) {
  const login = await fetch(`${origin}/api/auth/sign-in/username`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username: account.username, password: account.password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  try {
    const session = await fetch(`${origin}/api/session`, { headers: { cookie } }).then(response => response.json());
    assert.equal(session.user.role, "member");
    const response = await fetch(`${origin}/api/training-projects`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const { items } = await response.json(); assert.equal(items.length, 10);
    for (const project of items) {
      assert.deepEqual(project.media, project.drawings.schematic);
      for (const kind of ["schematic", "layout"]) {
        const expected = manifest.entries.find(entry => entry.projectId === project.id && entry.kind === kind);
        assert.ok(expected); assert.equal(project.drawings[kind]?.id, expected.mediaId);
        const media = await fetch(`${origin}/api/media/${expected.mediaId}`, { headers: { cookie } });
        assert.equal(media.status, 200); assert.equal(media.headers.get("content-type"), "image/png");
        assert.equal(hash(Buffer.from(await media.arrayBuffer())), expected.sha256);
        memberReads += 1;
      }
    }
  } finally {
    await fetch(`${origin}/api/auth/sign-out`, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: "{}" });
  }
}
assert.equal((await fetch(`${origin}/api/training-projects`)).status, 401);
for (const file of manifest.entries) {
  const response = await fetch(`${origin}/api/media/${file.mediaId}`);
  assert.equal(response.status, 401); anonymousDenied += 1;
}
const evidence = { verifiedAt: new Date().toISOString(), origin, projects: 10, sourceImages: 20, memberReads, anonymousDenied, allHashesMatch: true, sourceDirectory: manifest.directory };
await writeFile(new URL("training-drawing-acceptance.json", local), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`真实图纸读取验证通过：2 位成员共 ${memberReads} 次读取，20 张图 SHA-256 全部一致；匿名 ${anonymousDenied} 次文件请求及项目列表均被拒绝。`);
