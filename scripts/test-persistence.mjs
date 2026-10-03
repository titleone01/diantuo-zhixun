import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function persistencePaths(environment = process.env) {
  const local = fileURLToPath(new URL("../.local/", import.meta.url));
  return {
    artifactDirectory: path.resolve(environment.DIANTUO_TEST_ARTIFACT_DIR || local),
    adminPath: path.resolve(environment.DIANTUO_TEST_ADMIN_PATH || path.join(local, "admin-access.json")),
  };
}

export function persistenceFetch(url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
}

const hash = value => createHash("sha256").update(value).digest("hex");
export async function runPersistenceTest(environment = process.env) {
  const { artifactDirectory, adminPath } = persistencePaths(environment);
  const evidence = JSON.parse(await readFile(path.join(artifactDirectory, "backend-acceptance.json"), "utf8"));
  const { accounts } = JSON.parse(await readFile(path.join(artifactDirectory, "test-accounts.json"), "utf8"));
  const admin = JSON.parse(await readFile(adminPath, "utf8"));
  const origin = environment.DIANTUO_TEST_URL || evidence.origin;
  assert.equal(accounts.length, 2);
  async function login(credentials) {
    const response = await persistenceFetch(`${origin}/api/auth/sign-in/username`, {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ username: credentials.username, password: credentials.password }),
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const sessionResponse = await persistenceFetch(`${origin}/api/session`, { headers: { cookie } });
    assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json();
    assert.equal(session.user.username, credentials.username);
    return cookie;
  }
  const adminCookie = await login(admin);
  const memberCookies = [];
  for (const account of accounts) memberCookies.push(await login(account));
  const cookie = memberCookies[0];
  const circuitResponse = await persistenceFetch(`${origin}/api/circuits/${evidence.circuitId}`, { headers: { cookie } });
  assert.equal(circuitResponse.status, 200);
  const circuit = await circuitResponse.json();
  assert.equal(hash(JSON.stringify(circuit.circuit.document)), evidence.circuitHash);
  for (const [id, expected] of [[evidence.mediaId, evidence.imageHash], [evidence.pdfId, evidence.pdfHash]]) {
    const response = await persistenceFetch(`${origin}/api/media/${id}`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), expected);
  }
  assert.equal((await persistenceFetch(`${origin}/api/circuits/${evidence.circuitId}`, { headers: { cookie: memberCookies[1] } })).status, 404);
  for (const sessionCookie of [adminCookie, ...memberCookies]) {
    const response = await persistenceFetch(`${origin}/api/auth/sign-out`, { method: "POST", headers: { origin, cookie: sessionCookie, "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 200);
  }
  const result = { verifiedAt: new Date().toISOString(), origin, logins: 3, circuitId: evidence.circuitId, circuitHash: evidence.circuitHash, imageHash: evidence.imageHash, pdfHash: evidence.pdfHash, otherMemberDenied: true };
  await writeFile(path.join(artifactDirectory, "persistence-acceptance.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log("重启后验证通过：管理员和两个成员登录，草稿、PNG、PDF 的 SHA-256 与重启前相同，另一成员仍不能读取私有草稿。");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runPersistenceTest(); }
  catch (error) {
    // JSON parse errors and assertion details can include credential file contents.
    console.error(`重启后验证失败（${error instanceof Error ? error.name : "UnknownError"}）：请检查验收目录与服务状态；未写入新的通过证据。`);
    process.exitCode = 1;
  }
}
