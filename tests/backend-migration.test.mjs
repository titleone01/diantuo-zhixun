import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";

test("drawing-kind migration preserves a legacy schematic and permits an independent layout", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const name of ["0001_members.sql", "0002_member_status.sql", "0003_training_drawings.sql"]) db.exec(await readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8"));
    db.exec("INSERT INTO user(id,name,email,username,createdAt,updatedAt) VALUES('a','Admin','a@test.invalid','admin',1,1)");
    db.exec("INSERT INTO media(id,ownerId,objectKey,name,type,size,createdAt) VALUES('legacy','a','legacy','old.png','image/png',42,1),('new-layout','a','layout','layout.png','image/png',43,1)");
    db.exec("INSERT INTO training_drawings(projectId,title,mediaId,updatedBy,updatedAt) VALUES('project-01','Existing drawing','legacy','a',5)");
    db.exec(await readFile(new URL("../db/migrations/0004_training_drawing_kinds.sql", import.meta.url), "utf8"));
    const legacy = db.prepare("SELECT * FROM training_drawings WHERE projectId=? AND kind=?").get("project-01", "schematic");
    assert.equal(legacy.mediaId, "legacy"); assert.equal(legacy.title, "Existing drawing"); assert.equal(legacy.updatedAt, 5);
    db.exec("INSERT INTO training_drawings(projectId,kind,title,mediaId,updatedBy,updatedAt) VALUES('project-01','layout','Layout','new-layout','a',6)");
    assert.equal(db.prepare("SELECT count(*) count FROM training_drawings").get().count, 2);
    assert.throws(() => db.exec("INSERT INTO training_drawings(projectId,kind,title,mediaId,updatedBy,updatedAt) VALUES('project-01','schematic','Duplicate','legacy','a',7)"), /UNIQUE/);
    assert.throws(() => db.exec("INSERT INTO training_drawings(projectId,kind,title,mediaId,updatedBy,updatedAt) VALUES('project-01','other','Invalid','legacy','a',7)"), /CHECK/);
  } finally { db.close(); }
});

test("stale conditional deletion cannot remove a newer drawing or the other kind", async () => {
  const bundled=await build({entryPoints:['app/server/training-projects.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
  const {setTrainingDrawing}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  const db=new DatabaseSync(':memory:');
  try {
    for(const name of ['0001_members.sql','0002_member_status.sql','0003_training_drawings.sql','0004_training_drawing_kinds.sql']) db.exec(await readFile(new URL(`../db/migrations/${name}`,import.meta.url),'utf8'));
    db.exec("INSERT INTO user(id,name,email,username,createdAt,updatedAt) VALUES('a','Admin','a@test.invalid','admin',1,1)");
    db.exec("INSERT INTO media(id,ownerId,objectKey,name,type,size,createdAt) VALUES('newer','a','newer','new.png','image/png',42,1),('layout','a','layout','layout.png','image/png',43,1)");
    db.exec("INSERT INTO training_drawings(projectId,kind,title,mediaId,updatedBy,updatedAt) VALUES('project-01','schematic','Newer','newer','a',2),('project-01','layout','Layout','layout','a',2)");
    const env={DB:{prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)??null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return {meta:db.prepare(sql).run(...args)};}};}}};
    const request=expectedMediaId=>new Request('http://localhost/api/training-projects/project-01',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'schematic',expectedMediaId})});
    for(const expected of ['outdated',null]) await assert.rejects(()=>setTrainingDrawing(env,{id:'a',role:'admin'},'project-01',request(expected)),error=>error.status===409);
    assert.equal(db.prepare("SELECT mediaId FROM training_drawings WHERE kind='schematic'").get().mediaId,'newer');
    const removed=await setTrainingDrawing(env,{id:'a',role:'admin'},'project-01',request('newer'));assert.equal(removed.status,200);
    assert.equal(db.prepare('SELECT count(*) count FROM training_drawings').get().count,1);
    assert.equal(db.prepare('SELECT kind FROM training_drawings').get().kind,'layout');
  } finally {db.close();}
});
