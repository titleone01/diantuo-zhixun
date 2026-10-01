import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const local = new URL("../.local/", import.meta.url);
const evidence = JSON.parse(await readFile(new URL("backend-acceptance.json", local), "utf8"));
const { accounts } = JSON.parse(await readFile(new URL("test-accounts.json", local), "utf8"));
const admin = JSON.parse(await readFile(new URL("admin-access.json", local), "utf8"));
const origin = process.env.DIANTUO_TEST_URL || evidence.origin;
const hash = value => createHash("sha256").update(value).digest("hex");
async function login(credentials) {
  const response = await fetch(`${origin}/api/auth/sign-in/username`, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ username: credentials.username, password: credentials.password }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const session = await fetch(`${origin}/api/session`, { headers: { cookie } }).then(value => value.json());
  assert.equal(session.user.username, credentials.username);
  return cookie;
}
const adminCookie = await login(admin);
const memberCookies = [];
for (const account of accounts) memberCookies.push(await login(account));
const cookie = memberCookies[0];
const circuitResponse = await fetch(`${origin}/api/circuits/${evidence.circuitId}`, { headers: { cookie } });
assert.equal(circuitResponse.status, 200);
const circuit = await circuitResponse.json();
assert.equal(hash(JSON.stringify(circuit.circuit.document)), evidence.circuitHash);
for (const [id, expected] of [[evidence.mediaId, evidence.imageHash], [evidence.pdfId, evidence.pdfHash]]) {
  const response = await fetch(`${origin}/api/media/${id}`, { headers: { cookie } });
  assert.equal(response.status, 200);
  assert.equal(hash(Buffer.from(await response.arrayBuffer())), expected);
}
assert.equal((await fetch(`${origin}/api/circuits/${evidence.circuitId}`, { headers: { cookie: memberCookies[1] } })).status, 404);
for (const sessionCookie of [adminCookie, ...memberCookies]) {
  await fetch(`${origin}/api/auth/sign-out`, { method: "POST", headers: { origin, cookie: sessionCookie, "content-type": "application/json" }, body: "{}" });
}
const result = { verifiedAt: new Date().toISOString(), origin, logins: 3, circuitId: evidence.circuitId, circuitHash: evidence.circuitHash, imageHash: evidence.imageHash, pdfHash: evidence.pdfHash, otherMemberDenied: true };
await writeFile(new URL("persistence-acceptance.json", local), `${JSON.stringify(result, null, 2)}\n`);
console.log("重启后验证通过：管理员和两个成员登录，草稿、PNG、PDF 的 SHA-256 与重启前相同，另一成员仍不能读取私有草稿。");
