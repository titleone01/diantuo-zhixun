import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({ entryPoints: ["app/server/training-projects.ts"], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
const { setTrainingDrawing, listTrainingProjects } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const member = { id: "admin", role: "admin" };

async function fixture() {
  const db = new DatabaseSync(":memory:");
  for (const name of (await readdir("db/migrations")).filter(name => name.endsWith(".sql")).sort()) db.exec(await readFile(`db/migrations/${name}`, "utf8"));
  db.exec("INSERT INTO user(id,name,email,username,createdAt,updatedAt) VALUES('admin','Admin','admin@test.invalid','admin',1,1)");
  db.exec("INSERT INTO media(id,ownerId,objectKey,name,type,size,createdAt) VALUES('one','admin','one','one.png','image/png',42,1),('two','admin','two','two.pdf','application/pdf',42,1)");
  const env = { DB: { prepare(sql) { let args = []; return { bind(...values) { args = values; return this; }, async first() { return db.prepare(sql).get(...args) ?? null; }, async all() { return { results: db.prepare(sql).all(...args) }; }, async run() { return { meta: db.prepare(sql).run(...args) }; } }; } } };
  const write = (body, method = "PUT") => setTrainingDrawing(env, member, "project-01", new Request("http://localhost/api/training-projects/project-01", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const read = async () => (await (await listTrainingProjects(env)).json()).items[0];
  return { db, write, read };
}

test("drawing CAS catches same-media title races, independent slots, replacements and ABA recreation", async () => {
  const { db, write, read } = await fixture();
  try {
    await write({ mediaId: "one", expectedVersion: null });
    const original = (await read()).drawings.schematic.version;
    assert.ok(original); assert.notEqual(original, "one");
    await write({ mediaId: "two", kind: "layout", expectedVersion: null });
    const layout = (await read()).drawings.layout;
    const races = await Promise.allSettled(["first", "second"].map(title => write({ mediaId: "one", title, expectedVersion: original })));
    assert.equal(races.filter(item => item.status === "fulfilled").length, 1);
    assert.equal(races.find(item => item.status === "rejected").reason.status, 409);
    const renamed = (await read()).drawings.schematic.version;
    assert.notEqual(renamed, original);
    await assert.rejects(write({ mediaId: "two", expectedVersion: original }), error => error.status === 409);
    await assert.rejects(write({ expectedVersion: original }, "DELETE"), error => error.status === 409);
    await write({ mediaId: "two", expectedVersion: renamed });
    const replaced = (await read()).drawings.schematic.version;
    await write({ expectedVersion: replaced }, "DELETE");
    await write({ mediaId: "one", expectedVersion: null });
    const recreated = (await read()).drawings.schematic.version;
    assert.notEqual(recreated, original); assert.notEqual(recreated, replaced);
    for (const stale of [original, renamed, replaced]) {
      await assert.rejects(write({ mediaId: "one", expectedVersion: stale }), error => error.status === 409);
      await assert.rejects(write({ expectedVersion: stale }, "DELETE"), error => error.status === 409);
    }
    assert.deepEqual((await read()).drawings.layout, layout);
  } finally { db.close(); }
});

test("old clients cannot perform unconditional writes; precondition types are checked", async () => {
  const { db, write } = await fixture();
  try {
    for (const method of ["PUT", "DELETE"]) {
      await assert.rejects(write({ mediaId: "one" }, method), error => error.status === 428);
      await assert.rejects(write({ mediaId: "one", expectedMediaId: null }, method), error => error.status === 428);
      for (const expectedVersion of ["", 7, false, [], {}]) await assert.rejects(write({ mediaId: "one", expectedVersion }, method), error => error.status === 400);
    }
    await write({ expectedVersion: null }, "DELETE");
    assert.equal(db.prepare("SELECT count(*) n FROM training_drawings").get().n, 0);
  } finally { db.close(); }
});

test("new migration initializes both legacy slots without changing media, title, owner or snapshots", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const migrations = (await readdir("db/migrations")).filter(name => name.endsWith(".sql")).sort();
    for (const name of migrations.filter(name => !name.startsWith("0006"))) db.exec(await readFile(`db/migrations/${name}`, "utf8"));
    db.exec("INSERT INTO user(id,name,email,username,createdAt,updatedAt) VALUES('admin','Admin','a@test.invalid','admin',1,1)");
    db.exec("INSERT INTO media(id,ownerId,objectKey,name,type,size,createdAt) VALUES('one','admin','one','one.png','image/png',42,1)");
    db.exec("INSERT INTO training_drawings(projectId,kind,title,mediaId,updatedBy,updatedAt) VALUES('project-01','schematic','Old title','one','admin',3),('project-01','layout','Old layout','one','admin',4)");
    const before = db.prepare("SELECT * FROM training_drawings ORDER BY kind").all();
    db.exec(await readFile("db/migrations/0006_training_drawing_versions.sql", "utf8"));
    const after = db.prepare("SELECT * FROM training_drawings ORDER BY kind").all();
    for (let index = 0; index < after.length; index++) {
      const { version, ...values } = after[index];
      assert.match(version, /^[a-f0-9]{32}$/); assert.deepEqual(values, { ...before[index] });
    }
    assert.notEqual(after[0].version, after[1].version);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { db.close(); }
});
