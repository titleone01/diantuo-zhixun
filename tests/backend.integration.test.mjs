import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const origin = process.env.DIANTUO_TEST_URL;
const localDirectory = fileURLToPath(new URL("../.local/", import.meta.url));
const adminPath = process.env.DIANTUO_TEST_ADMIN_PATH || path.join(localDirectory, "admin-access.json");
const artifactDirectory = process.env.DIANTUO_TEST_ARTIFACT_DIR || localDirectory;
const hash = value => createHash("sha256").update(value).digest("hex");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlFQAAAAASUVORK5CYII=", "base64");
function validPdf() {
  const stream = "BT /F1 12 Tf 20 80 Td (Local persistence test) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let content = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => { const offset = Buffer.byteLength(content); content += `${index + 1} 0 obj\n${object}\nendobj\n`; return offset; });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}
test("real D1/R2, invitation auth, two-user isolation, atomic revisions, snapshots, assessment", { skip: !origin, timeout: 180000 }, async t => {
  const adminCredentials = JSON.parse(await readFile(adminPath, "utf8"));
  const built = await build({ stdin: { contents: 'export * from "./app/simulator/core/lessons"; export * from "./app/simulator/core/engine";', resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", platform: "node" });
  const { createLessonDocument, assessLesson } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
  const fixture = createLessonDocument("motor-jog", { wired: true });
  const suffix = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const newAccount = label => ({ username: `qa_${label}_${suffix}`.slice(0, 30), name: `验收成员 ${label.toUpperCase()}`, password: randomBytes(18).toString("base64url") });
  class Client {
    cookies = new Map();
    async call(path, method = "GET", body, options = {}) {
      const headers = { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "), ...(method !== "GET" ? { origin } : {}), ...options.headers };
      if (body !== undefined && !(body instanceof FormData) && !headers["content-type"]) headers["content-type"] = "application/json";
      if (options.noOrigin) delete headers.origin;
      const response = await fetch(`${origin}/api${path}`, { method, headers, signal: AbortSignal.timeout(15000), ...(body !== undefined ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}) });
      for (const value of response.headers.getSetCookie()) {
        const [pair] = value.split(";"); const index = pair.indexOf("=");
        this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
      const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.arrayBuffer();
      return { status: response.status, data, headers: response.headers };
    }
    async login(credentials) {
      const result = await this.call("/auth/sign-in/username", "POST", { username: credentials.username, password: credentials.password });
      assert.equal(result.status, 200, `login failed: ${result.data.code || result.status}`);
    }
  }
  const admin = new Client(), anonymous = new Client(), a = new Client(), b = new Client();
  const userA = newAccount("a"), userB = newAccount("b");
  await t.test("anonymous access and signup are blocked; bootstrap admin has a real session", async () => {
    assert.equal((await anonymous.call("/circuits")).status, 401);
    assert.equal((await anonymous.call("/publications")).status, 401);
    assert.equal((await anonymous.call("/auth/sign-up/email", "POST", {})).status, 403);
    await admin.login(adminCredentials);
    assert.equal((await admin.call("/session")).data.user.role, "admin");
  });
  async function invitation() {
    const result = await admin.call("/invites", "POST", { expiresInHours: 2 });
    assert.equal(result.status, 201); return result.data.invite;
  }
  await t.test("invites are single-use; racing acceptance creates only one member", async () => {
    const first = await invitation();
    assert.equal((await anonymous.call(`/invites/preview?token=${first.token}`)).status, 200);
    assert.equal((await anonymous.call("/invites/accept", "POST", { token: first.token, ...userA, role: "admin" })).status, 201);
    assert.ok([409, 410].includes((await anonymous.call("/invites/accept", "POST", { token: first.token, ...newAccount("replay") })).status));
    const second = await invitation();
    const contender = newAccount("race");
    const raced = await Promise.all([userB, contender].map(value => anonymous.call("/invites/accept", "POST", { token: second.token, ...value })));
    assert.equal(raced.filter(result => result.status === 201).length, 1);
    assert.ok(raced.some(result => [409, 410].includes(result.status)));
    if (raced[1].status === 201) Object.assign(userB, contender);
    await a.login(userA); await b.login(userB);
    assert.equal((await a.call("/session")).data.user.role, "member");
    assert.equal((await a.call("/invites")).status, 403);
    const revoked = await invitation();
    assert.equal((await admin.call(`/invites/${revoked.id}`, "DELETE")).status, 200);
    assert.equal((await anonymous.call("/invites/accept", "POST", { token: revoked.token, ...newAccount("revoked") })).status, 410);
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(path.join(artifactDirectory, "test-accounts.json"), JSON.stringify({ origin, accounts: [userA, userB] }, null, 2), { mode: 0o600 });
  });
  let circuit;
  await t.test("private drafts reject other members; concurrent saves have exactly one winner", async () => {
    const created = await a.call("/circuits", "POST", { title: "验收：点动草稿", document: fixture, ownerId: "forged-owner" });
    assert.equal(created.status, 201); circuit = created.data.circuit;
    assert.equal((await b.call(`/circuits/${circuit.id}`)).status, 404);
    assert.equal((await b.call(`/circuits/${circuit.id}`, "PUT", { ...circuit, title: "越权" })).status, 404);
    assert.equal((await b.call(`/circuits/${circuit.id}`, "DELETE", { revision: circuit.revision })).status, 404);
    const attempts = await Promise.all(["并发保存甲", "并发保存乙"].map(title => a.call(`/circuits/${circuit.id}`, "PUT", { title, document: fixture, revision: circuit.revision })));
    assert.deepEqual(attempts.map(x => x.status).sort(), [200, 409]);
    circuit = attempts.find(x => x.status === 200).data.circuit;
    assert.equal(circuit.revision, 2);
    assert.equal((await b.call("/circuits")).data.items.length, 0);
  });
  let publication;
  await t.test("publication is an immutable snapshot; reactions are idempotent and fork is independent", async () => {
    const published = await a.call(`/circuits/${circuit.id}/publish`, "POST", { revision: circuit.revision });
    assert.equal(published.status, 201); publication = published.data.publication;
    assert.equal((await a.call(`/circuits/${circuit.id}/publish`, "POST", { revision: circuit.revision })).data.publication.id, publication.id);
    circuit = (await a.call(`/circuits/${circuit.id}`, "PUT", { title: "修改后的私有草稿", document: { ...fixture, wires: [] }, revision: circuit.revision })).data.circuit;
    assert.deepEqual((await b.call(`/publications/${publication.id}`)).data.publication.document, fixture);
    assert.equal((await a.call(`/circuits/${circuit.id}/publish`, "POST", { revision: 1 })).status, 409);
    for (const kind of ["like", "favorite"]) {
      assert.equal((await b.call(`/publications/${publication.id}/${kind}`, "POST", { active: true })).status, 200);
      const repeated = await b.call(`/publications/${publication.id}/${kind}`, "POST", { active: true });
      assert.equal(repeated.data.publication[kind === "like" ? "likes" : "favorites"], 1);
    }
    const fork = await b.call(`/publications/${publication.id}/fork`, "POST", {});
    assert.equal(fork.status, 201); assert.notEqual(fork.data.circuit.id, circuit.id);
    assert.equal(fork.data.circuit.forkedFrom, publication.id);
    assert.equal((await a.call(`/circuits/${fork.data.circuit.id}`)).status, 404);
  });
  let mediaId;
  await t.test("malformed multipart and incomplete PNG signatures are rejected", async () => {
    const malformed = await a.call("/media", "POST", "not multipart", { headers: { "content-type": "multipart/form-data" } });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.data.code, "INVALID_MULTIPART");
    const form = new FormData();
    form.append("file", new File([png.subarray(0, 4)], "truncated.png", { type: "image/png" }));
    assert.equal((await a.call("/media", "POST", form)).status, 415);
  });
  await t.test("R2 attachment stays private until explicitly included in publication", async () => {
    const form = new FormData();
    form.append("file", new File([png], "diagram.png", { type: "image/png" }));
    const upload = await a.call("/media", "POST", form); assert.equal(upload.status, 201); mediaId = upload.data.media.id;
    assert.equal((await a.call(`/media/${mediaId}`)).status, 200);
    const partial = await a.call(`/media/${mediaId}`, "GET", undefined, { headers: { range: "bytes=0-7" } });
    assert.equal(partial.status, 206); assert.equal(partial.data.byteLength, 8);
    assert.match(partial.headers.get("content-range"), /^bytes 0-7\//);
    assert.equal((await a.call(`/media/${mediaId}`, "GET", undefined, { headers: { range: "bytes=99999-" } })).status, 416);
    assert.equal((await b.call(`/media/${mediaId}`)).status, 404);
    assert.equal((await anonymous.call(`/media/${mediaId}`)).status, 401);
    assert.equal((await b.call("/circuits", "POST", { title: "越权附件", document: { ...fixture, drawingMediaId: mediaId } })).status, 403);
    const svg = new FormData(); svg.append("file", new File(["<svg onload='alert(1)' />"], "unsafe.svg", { type: "image/svg+xml" }));
    assert.equal((await a.call("/media", "POST", svg)).status, 415);
    circuit = (await a.call(`/circuits/${circuit.id}`, "PUT", { title: "验收：含图纸电路", document: { ...fixture, drawingMediaId: mediaId }, revision: circuit.revision })).data.circuit;
    assert.ok(circuit.mediaIds.includes(mediaId));
    assert.equal((await b.call(`/media/${mediaId}`)).status, 404);
    assert.equal((await a.call(`/circuits/${circuit.id}/publish`, "POST", { revision: circuit.revision })).status, 201);
    assert.equal((await b.call(`/media/${mediaId}`)).status, 200);
  });
  let pdfId;
  const pdf = validPdf();
  await t.test("valid PDF is private, served inline with defensive headers, and retains exact bytes", async () => {
    const form = new FormData(); form.append("file", new File([pdf], "qa-valid.pdf", { type: "application/pdf" }));
    const uploaded = await a.call("/media", "POST", form); assert.equal(uploaded.status, 201); pdfId = uploaded.data.media.id;
    const readback = await a.call(`/media/${pdfId}`);
    assert.equal(readback.status, 200); assert.equal(hash(Buffer.from(readback.data)), hash(pdf));
    assert.equal(readback.headers.get("content-type"), "application/pdf");
    assert.ok(readback.headers.get("content-disposition").startsWith("inline;"));
    assert.equal(readback.headers.get("x-content-type-options"), "nosniff");
    assert.match(readback.headers.get("content-security-policy"), /frame-ancestors 'self'/);
    assert.equal((await b.call(`/media/${pdfId}`)).status, 404);
    assert.equal((await anonymous.call(`/media/${pdfId}`)).status, 401);
  });
  await t.test("hidden inactive drawing IDs are checked, preserved in snapshots, and independent after deletion", async () => {
    const document = { ...fixture, drawingMediaId: mediaId, drawingMediaType: "image/png", projectDrawings: { schematic: { mediaId, type: "image/png" }, layout: { mediaId: pdfId, type: "application/pdf" } }, drawingKind: "schematic" };
    // The active schematic is already shared, but the inactive PDF belongs to A.
    // Omitting mediaIds must not hide that unauthorized attachment from checks.
    assert.equal((await b.call("/circuits", "POST", { title: "隐藏他人布局图", document })).status, 403);
    const created = await a.call("/circuits", "POST", { title: "双图快照验收", document, mediaIds: [] });
    assert.equal(created.status, 201);
    assert.deepEqual(created.data.circuit.mediaIds.sort(), [mediaId, pdfId].sort());
    const shared = await a.call(`/circuits/${created.data.circuit.id}/publish`, "POST", { revision: 1 });
    assert.equal(shared.status, 201);
    assert.deepEqual(shared.data.publication.mediaIds.sort(), [mediaId, pdfId].sort());
    const forked = await b.call(`/publications/${shared.data.publication.id}/fork`, "POST", {});
    assert.equal(forked.status, 201); assert.deepEqual(forked.data.circuit.document.projectDrawings, document.projectDrawings);
    assert.equal((await a.call(`/circuits/${created.data.circuit.id}`, "DELETE", { revision: 1 })).status, 200);
    assert.equal((await b.call(`/media/${pdfId}`)).status, 200);
    assert.equal((await anonymous.call(`/media/${pdfId}`)).status, 401);
    assert.deepEqual((await b.call(`/publications/${shared.data.publication.id}`)).data.publication.document.projectDrawings, document.projectDrawings);
  });
  await t.test("assessment is authenticated and recalculated; invalid documents and CSRF are rejected", async () => {
    assert.equal((await anonymous.call("/assess", "POST", { document: fixture })).status, 401);
    const good = await a.call("/assess", "POST", { document: fixture, lessonId: "motor-jog", assessment: { status: "passed" } });
    assert.equal(good.status, 200); assert.equal(good.data.assessment.status, "passed");
    const bad = await a.call("/assess", "POST", { document: { ...fixture, wires: [] }, lessonId: "motor-jog", assessment: { status: "passed" } });
    assert.equal(bad.status, 200); assert.notEqual(bad.data.assessment.status, "passed");
    assert.equal((await a.call("/circuits", "POST", { title: "无效", document: {} })).status, 400);
    assert.equal((await a.call("/me", "PATCH", { name: "跨站" }, { headers: { origin: "https://attacker.invalid" } })).status, 403);
    assert.equal((await a.call("/me", "PATCH", { name: "无来源" }, { noOrigin: true })).status, 403);
    const profile = await a.call("/me"); assert.ok(profile.data.assessments.length >= 2);
    assert.equal((await b.call("/me")).data.assessments.length, 0);
  });
  await t.test("all ten official motor courses use the same server assessment and reject forged success", async motorTest => {
    for (let number = 1; number <= 10; number += 1) await motorTest.test(`motor-course-${String(number).padStart(2, "0")}`, async () => {
      const lessonId = `motor-course-${String(number).padStart(2, "0")}`;
      const document = createLessonDocument(lessonId, { wired: true });
      const expected = JSON.parse(JSON.stringify(assessLesson(document, lessonId)));
      const result = await a.call("/assess", "POST", { document, lessonId });
      assert.equal(result.status, 200); assert.equal(result.data.assessment.status, "passed");
      assert.deepEqual(result.data.assessment, expected);
      assert.equal(result.data.documentHash, hash(JSON.stringify(document)));
      const invalid = { ...document, wires: [] };
      const rejected = await a.call("/assess", "POST", { document: invalid, lessonId, assessment: { status: "passed", passed: 999 } });
      assert.equal(rejected.status, 200); assert.notEqual(rejected.data.assessment.status, "passed");
    });
  });
  await t.test("server rejects held low/high requests bypassing FR's NC even when control supply crosses its fixed main pole", async () => {
    for (const start of ["sb2", "sb3"]) {
      const lessonId = "motor-course-10", document = createLessonDocument(lessonId, { wired: true });
      const removeAt = (component, terminal) => { document.wires = document.wires.filter(wire => ![wire.from, wire.to].some(port => port.componentId === component && port.terminalId === terminal)); };
      let counter = 0;
      const connect = (from, fromTerminal, to, toTerminal) => document.wires.push({ id: `qa-fr-${counter++}`, from: { componentId: from, terminalId: fromTerminal }, to: { componentId: to, terminalId: toTerminal }, color: "#8866cc" });
      removeAt("fu2a", "1");
      for (const [component, terminal] of [["fr", "95"], ["fr", "96"], ["sb1", "11"], ["sb1", "12"]]) removeAt(component, terminal);
      connect("fr", "2", "fu2a", "1"); connect("fu2a", "2", "sb1", "11"); connect("sb1", "12", "fr", "95");
      for (const [component, terminal] of [["km1", "13"], ["km2", "13"], ["sb2", "23"], ["sb3", "23"]]) connect(component === start ? "sb1" : "fr", component === start ? "12" : "96", component, terminal);
      const expected = JSON.parse(JSON.stringify(assessLesson(document, lessonId)));
      assert.equal(expected.status, "failed");
      const result = await a.call("/assess", "POST", { document, lessonId, assessment: { status: "passed", passed: 999 } });
      assert.equal(result.status, 200); assert.deepEqual(result.data.assessment, expected);
      assert.ok(result.data.assessment.diagnostics.some(item => item.code === "OVERLOAD_CONTROL_BYPASS"));
    }
  });
  await t.test("ten training projects: two independent drawing kinds, CAS protection and member-only reading", async drawingTest => {
    assert.equal((await anonymous.call("/training-projects")).status, 401);
    const listed = await a.call("/training-projects");
    assert.equal(listed.status, 200); assert.equal(listed.data.items.length, 10);
    for (const item of listed.data.items) { assert.ok("schematic" in item.drawings); assert.ok("layout" in item.drawings); assert.deepEqual(item.media, item.drawings.schematic); }
    const slot = listed.data.items.find(item => !item.drawings.schematic && !item.drawings.layout);
    if (!slot) { drawingTest.skip("existing user drawings fill every slot; do not overwrite them"); return; }
    assert.equal((await a.call(`/training-projects/${slot.id}`, "PUT", { mediaId })).status, 403);
    assert.equal((await admin.call(`/training-projects/${slot.id}`, "PUT", { mediaId })).status, 403);
    const form = new FormData();
    form.append("file", new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlFQAAAAASUVORK5CYII=", "base64")], "qa-permission-only.png", { type: "image/png" }));
    const uploaded = await admin.call("/media", "POST", form);
    assert.equal(uploaded.status, 201);
    const drawingId = uploaded.data.media.id;
    const layoutForm = new FormData(); layoutForm.append("file", new File([pdf], "qa-layout-permission-only.pdf", { type: "application/pdf" }));
    const layoutUpload = await admin.call("/media", "POST", layoutForm); assert.equal(layoutUpload.status, 201);
    const layoutId = layoutUpload.data.media.id;
    assert.equal((await b.call(`/media/${drawingId}`)).status, 404);
    try {
      assert.equal((await admin.call(`/training-projects/${slot.id}`, "PUT", { mediaId: drawingId, expectedMediaId: null })).status, 200);
      assert.equal((await admin.call(`/training-projects/${slot.id}`, "PUT", { mediaId: layoutId, kind: "layout", expectedMediaId: null })).status, 200);
      assert.equal((await admin.call(`/training-projects/${slot.id}`, "PUT", { mediaId: layoutId, expectedMediaId: null })).status, 409);
      assert.equal((await admin.call(`/training-projects/${slot.id}`, "PUT", { mediaId: layoutId, kind: "invalid" })).status, 400);
      assert.equal((await a.call(`/training-projects/${slot.id}`, "PUT", { mediaId, kind: "layout" })).status, 403);
      assert.equal((await a.call(`/training-projects/${slot.id}`, "DELETE", { kind: "layout" })).status, 403);
      const readback = (await b.call("/training-projects")).data.items.find(item => item.id === slot.id);
      assert.equal(readback.drawingStatus, "uploaded"); assert.equal(readback.media.id, drawingId);
      assert.equal(readback.drawings.schematic.id, drawingId); assert.equal(readback.drawings.layout.id, layoutId);
      assert.equal((await b.call(`/media/${drawingId}`)).status, 200);
      assert.equal((await b.call(`/media/${layoutId}`)).status, 200);
      assert.equal((await anonymous.call(`/media/${layoutId}`)).status, 401);
      assert.equal((await anonymous.call(`/media/${drawingId}`)).status, 401);
      assert.equal((await admin.call(`/training-projects/${slot.id}`, "DELETE", { kind: "layout" })).status, 200);
      const remaining = (await b.call("/training-projects")).data.items.find(item => item.id === slot.id);
      assert.equal(remaining.drawings.layout, null); assert.equal(remaining.drawings.schematic.id, drawingId);
      assert.equal((await b.call(`/media/${layoutId}`)).status, 404);
      assert.equal((await b.call(`/media/${drawingId}`)).status, 200);
    } finally {
      assert.equal((await admin.call(`/training-projects/${slot.id}`, "DELETE")).status, 200);
      assert.equal((await admin.call(`/training-projects/${slot.id}`, "DELETE", { kind: "layout" })).status, 200);
    }
    assert.equal((await b.call(`/media/${drawingId}`)).status, 404);
    assert.equal((await b.call("/training-projects")).data.items.find(item => item.id === slot.id).drawingStatus, "pending");
  });
  await t.test("sign-out invalidates the server session", async () => {
    assert.equal((await a.call("/auth/sign-out", "POST", {})).status, 200);
    assert.equal((await a.call("/session")).data.user, null);
  });
  await t.test("administrators can disable members and invalidate sessions; last admin is protected", async () => {
    const members = await admin.call("/members");
    assert.equal(members.status, 200);
    const target = members.data.items.find(value => value.username === userB.username);
    const owner = members.data.items.find(value => value.username === adminCredentials.username);
    assert.equal((await b.call(`/members/${owner.id}`, "PATCH", { disabled: true })).status, 403);
    assert.equal((await admin.call(`/members/${owner.id}`, "PATCH", { disabled: true })).status, 409);
    assert.equal((await admin.call(`/members/${target.id}`, "PATCH", { disabled: true })).status, 200);
    assert.equal((await b.call("/session")).data.user, null);
    assert.equal((await b.call("/circuits")).status, 401);
    assert.equal((await b.call("/auth/sign-in/username", "POST", { username: userB.username, password: userB.password })).status, 401);
    assert.equal((await admin.call(`/members/${target.id}`, "PATCH", { disabled: false })).status, 200);
    await b.login(userB);
  });
  const evidence = { at: new Date().toISOString(), origin, memberUsernames: [userA.username, userB.username], circuitId: circuit.id, circuitHash: hash(JSON.stringify(circuit.document)), publicationId: publication.id, mediaId, imageHash: hash(png), pdfId, pdfHash: hash(pdf) };
  await writeFile(path.join(artifactDirectory, "backend-acceptance.json"), JSON.stringify(evidence, null, 2));
});
