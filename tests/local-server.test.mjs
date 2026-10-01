import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalServer } from "../server/local-server.mjs";

const password = "training-test-password-2026";
const cookieFrom = (response) => response.headers.getSetCookie().map((value) => value.split(";")[0]).filter((value) => !value.endsWith("=")).join("; ");

test("local server protects every file, enforces roles, persists drawings and revokes sessions", async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "diantuo-auth-test-"));
  const dataDir = path.join(tempRoot, "data");
  const staticDir = path.join(tempRoot, "static");
  await mkdir(path.join(staticDir, "assets"), { recursive: true });
  await mkdir(path.join(staticDir, "models"), { recursive: true });
  await writeFile(path.join(staticDir, "index.html"), "<!doctype html><title>PRIVATE_TRAINING_PAGE</title>");
  await writeFile(path.join(staticDir, "assets/app.js"), "PRIVATE_JAVASCRIPT");
  await writeFile(path.join(staticDir, "models/component.glb"), "PRIVATE_MODEL");
  await writeFile(path.join(tempRoot, "secret.txt"), "OUTSIDE_STATIC_ROOT");
  let server;
  let base;
  const start = async (host = "127.0.0.1") => {
    server = createLocalServer({ dataDir, staticDir, host });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => {
    if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };
  t.after(async () => {
    await stop();
    assert.ok(path.resolve(tempRoot).startsWith(`${path.resolve(os.tmpdir())}${path.sep}diantuo-auth-test-`));
    await rm(tempRoot, { recursive: true, force: true });
  });
  const request = (route, init = {}) => fetch(`${base}${route}`, { redirect: "manual", ...init });
  const challenge = async () => {
    const response = await request("/login");
    const html = await response.text();
    const csrf = html.match(/name="_csrf" value="([a-f0-9]+)"/)?.[1];
    assert.ok(csrf);
    assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
    return { cookie: cookieFrom(response), csrf };
  };
  const signIn = async (username, route = "/api/login", extraHeaders = {}) => {
    const form = await challenge();
    const response = await request(route, { method: "POST", headers: { Origin: base, Cookie: form.cookie, "Content-Type": "application/json", ...extraHeaders }, body: JSON.stringify({ username, password, _csrf: form.csrf }) });
    const body = await response.json();
    return { response, body, cookie: cookieFrom(response), csrf: body.csrfToken };
  };
  const authHeaders = (session, extra = {}) => ({ Cookie: session.cookie, Origin: base, "X-CSRF-Token": session.csrf, ...extra });
  const change = (route, session, body, method = "POST", extra = {}) => request(route, { method, headers: authHeaders(session, { "Content-Type": "application/json", ...extra }), body: JSON.stringify(body) });

  assert.throws(() => createLocalServer({ dataDir, staticDir, host: "0.0.0.0" }), /先以 HOST=127.0.0.1/);
  await start();

  await t.test("anonymous requests cannot fetch HTML, JavaScript, models or API drawing bytes", async () => {
    for (const route of ["/", "/index.html", "/assets/app.js", "/models/component.glb", "/unknown"]) {
      const response = await request(route);
      assert.equal(response.status, 303, route);
      assert.equal(response.headers.get("location"), "/login");
      assert.doesNotMatch(await response.text(), /PRIVATE_/);
    }
    for (const route of ["/api/session", "/api/projects", "/api/accounts", "/api/projects/project-01/drawing"]) assert.equal((await request(route)).status, 401, route);
    assert.equal((await request("/api/setup", { method: "POST", headers: { Origin: "http://other-site.invalid", "Content-Type": "application/json" }, body: "{}" })).status, 403);
  });

  await t.test("bootstrap requires both a loopback connection and a localhost Host", async () => {
    const form = await challenge();
    const response = await request("/api/setup", { method: "POST", headers: { Host: "untrusted.invalid", Origin: "http://untrusted.invalid", Cookie: form.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password, _csrf: form.csrf }) });
    assert.equal(response.status, 403);
  });

  await t.test("a forged non-ASCII CSRF value is rejected without a server error", async () => {
    const form = await challenge();
    const response = await request("/api/setup", {
      method: "POST",
      headers: { Origin: base, Cookie: form.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password, _csrf: "伪".repeat(form.csrf.length) }),
    });
    assert.equal(response.status, 403);
  });

  await t.test("CSP permits the model decoder's WebAssembly without enabling arbitrary eval", async () => {
    const response = await request("/login");
    const csp = response.headers.get("content-security-policy");
    assert.match(csp, /script-src [^;]*'wasm-unsafe-eval'/);
    assert.doesNotMatch(csp, /(?:^|[\s;])'unsafe-eval'(?:[\s;]|$)/);
    assert.match(csp, /frame-ancestors 'self'/);
  });

  const admin = await signIn("admin", "/api/setup");
  assert.equal(admin.response.status, 201);
  assert.equal(admin.body.user.role, "admin");
  assert.match(admin.response.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  const secondSetup = await signIn("second-admin", "/api/setup");
  assert.equal(secondSetup.response.status, 409);
  const sessionResponse = await request("/api/session", { headers: { Cookie: admin.cookie } });
  assert.equal((await sessionResponse.json()).csrfToken, admin.csrf);

  let studentId;
  await t.test("only administrators create students and mutations require same-origin CSRF", async () => {
    assert.equal((await change("/api/accounts", admin, { username: "student", password }, "POST", { "X-CSRF-Token": "wrong" })).status, 403);
    assert.equal((await change("/api/accounts", admin, { username: "student", password }, "POST", { Origin: "http://other-site.invalid" })).status, 403);
    assert.equal((await change("/api/accounts", admin, { username: "student", password, role: "admin" })).status, 400);
    const created = await change("/api/accounts", admin, { username: "student", password });
    assert.equal(created.status, 201);
    const account = (await created.json()).account;
    assert.equal(account.role, "student");
    studentId = account.id;
    assert.equal((await change("/api/accounts", admin, { username: "student", password })).status, 409);
    assert.equal((await change(`/api/accounts/${admin.body.user.id}`, admin, { disabled: true }, "PATCH")).status, 403);
  });

  const student = await signIn("student");
  assert.equal(student.response.status, 200);
  await t.test("student role cannot upload, create accounts, list accounts or escalate roles", async () => {
    assert.equal((await request("/api/accounts", { headers: { Cookie: student.cookie } })).status, 403);
    assert.equal((await change("/api/accounts", student, { username: "injected", password, role: "admin" })).status, 403);
    assert.equal((await change(`/api/accounts/${studentId}`, student, { disabled: false, role: "admin" }, "PATCH")).status, 403);
    assert.equal((await request("/api/projects/project-01/drawing", { method: "PUT", headers: authHeaders(student, { "Content-Type": "application/pdf", "X-File-Name": "plan.pdf" }), body: "%PDF-1.4\nstudent-content" })).status, 403);
    for (const route of ["/", "/assets/app.js", "/models/component.glb"]) assert.equal((await request(route, { headers: { Cookie: student.cookie } })).status, 200);
    assert.equal((await request("/%2e%2e%5csecret.txt", { headers: { Cookie: student.cookie } })).status, 404);
    assert.equal((await request("/.hidden", { headers: { Cookie: student.cookie } })).status, 404);
  });

  const drawingBytes = Buffer.from("%PDF-1.4\ntraining drawing persistence fixture\n%%EOF");
  await t.test("administrator upload validates file content, limit and project id; students can read", async () => {
    const upload = (content, mime = "application/pdf", project = "project-01") => request(`/api/projects/${project}/drawing`, { method: "PUT", headers: authHeaders(admin, { "Content-Type": mime, "X-File-Name": encodeURIComponent("直接启动图纸.pdf") }), body: content });
    assert.equal((await upload("<script>fake pdf</script>")).status, 415);
    assert.equal((await upload(drawingBytes, "image/png")).status, 415);
    assert.equal((await upload(drawingBytes, "application/pdf", "project-11")).status, 404);
    assert.equal((await upload(Buffer.alloc(12 * 1024 * 1024 + 1))).status, 413);
    assert.equal((await upload(drawingBytes)).status, 200);
    const response = await request("/api/projects/project-01/drawing", { headers: { Cookie: student.cookie } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), drawingBytes);
    const list = await request("/api/projects", { headers: { Cookie: student.cookie } });
    const { projects } = await list.json();
    assert.equal(projects.length, 10);
    assert.equal(projects[0].drawing.name, "直接启动图纸.pdf");
    assert.equal(projects[0].drawing.size, drawingBytes.length);
    assert.equal(projects[1].drawing, null);
  });

  await t.test("disabling immediately revokes sessions, and re-enabling does not restore old cookies", async () => {
    assert.equal((await change(`/api/accounts/${studentId}`, admin, { disabled: true }, "PATCH")).status, 200);
    assert.equal((await request("/api/session", { headers: { Cookie: student.cookie } })).status, 401);
    assert.equal((await request("/models/component.glb", { headers: { Cookie: student.cookie } })).status, 303);
    assert.equal((await signIn("student")).response.status, 401);
    assert.equal((await change(`/api/accounts/${studentId}`, admin, { disabled: false }, "PATCH")).status, 200);
    assert.equal((await request("/api/session", { headers: { Cookie: student.cookie } })).status, 401);
    const renewed = await signIn("student");
    assert.equal(renewed.response.status, 200);
    assert.equal((await change("/api/logout", renewed, {})).status, 200);
    assert.equal((await request("/api/session", { headers: { Cookie: renewed.cookie } })).status, 401);
  });

  await t.test("concurrent login requests reserve the attempt budget before password hashing", async () => {
    const created = await change("/api/accounts", admin, { username: "rate-limited", password });
    assert.equal(created.status, 201);
    const forms = await Promise.all(Array.from({ length: 12 }, () => challenge()));
    const attempts = await Promise.all(forms.map((form) => request("/api/login", {
      method: "POST",
      headers: { Origin: base, Cookie: form.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "rate-limited", password: "deliberately-wrong-password", _csrf: form.csrf }),
    })));
    assert.equal(attempts.filter((response) => response.status === 401).length, 10);
    assert.equal(attempts.filter((response) => response.status === 429).length, 2);
    assert.equal((await signIn("rate-limited")).response.status, 429, "a correct password cannot bypass an already exhausted budget");
  });

  await t.test("accounts, session authorization and uploaded drawings survive a restart", async () => {
    await stop();
    await start("0.0.0.0");
    assert.equal((await request("/api/session", { headers: { Cookie: admin.cookie } })).status, 200);
    const persistedStudent = await signIn("student");
    assert.equal(persistedStudent.response.status, 200);
    const drawing = await request("/api/projects/project-01/drawing", { headers: { Cookie: persistedStudent.cookie } });
    assert.deepEqual(Buffer.from(await drawing.arrayBuffer()), drawingBytes);
    const accountList = await request("/api/accounts", { headers: { Cookie: admin.cookie } });
    assert.equal((await accountList.json()).accounts.length, 3);
    const databaseBytes = await readFile(path.join(dataDir, "training.sqlite"));
    assert.equal(databaseBytes.includes(Buffer.from(password)), false, "plaintext passwords must not be stored");
  });
});
