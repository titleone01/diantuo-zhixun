import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { importTrainingDrawings } from './import-training-drawings.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Only used with createFixture's temporary Worker/D1/R2, never the live site. */
export async function verifyCourseDrawingReplacement({fixture,directory,admin,member,secondMember,createLessonDocument,sourceDirectory,replacementBytes}){
  const before=await admin.call('/training-projects');assert.equal(before.status,200);
  const project=before.data.items.find(p=>p.id==='project-06'),old=project.drawings.layout;assert(old?.version);
  const document={...createLessonDocument('motor-course-06',{wired:true}),title:'Isolated old layout snapshot',trainingProjectId:project.id,drawingKind:'layout',drawingMediaId:old.id,drawingMediaType:old.type,projectDrawings:Object.fromEntries(Object.entries(project.drawings).map(([kind,media])=>[kind,{mediaId:media.id,type:media.type}]))};
  const saved=await member.call('/circuits','POST',{title:document.title,document});assert.equal(saved.status,201);
  const published=await member.call(`/circuits/${saved.data.circuit.id}/publish`,'POST',{revision:saved.data.circuit.revision});assert.equal(published.status,201);
  const publicationId=published.data.publication.id;
  const mediaBytes=async(client,id)=>{const response=await fetch(`${fixture.origin}/api/media/${id}`,{headers:{cookie:client.cookie},signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);return Buffer.from(await response.arrayBuffer());};
  const oldHash=hash(await mediaBytes(member,old.id));
  const temporary=path.join(directory,'single-slot');await mkdir(temporary);await writeFile(path.join(temporary,'自动往返控制电路布局图.png'),replacementBytes);
  const options=dir=>['--directory',dir,'--project','project-06','--kind','layout','--replace','--url',fixture.origin,'--admin-file',fixture.adminFile,'--artifact-dir',path.join(directory,'single-slot-evidence')];
  await importTrainingDrawings(options(temporary));await admin.login(JSON.parse(await readFile(fixture.adminFile,'utf8')));
  const changed=await admin.call('/training-projects');const current=changed.data.items.find(p=>p.id===project.id).drawings.layout;assert.notEqual(current.id,old.id);assert.notEqual(current.version,old.version);
  for(const prior of before.data.items)for(const kind of ['schematic','layout'])if(prior.id!=='project-06'||kind!=='layout')assert.deepEqual(changed.data.items.find(p=>p.id===prior.id).drawings[kind],prior.drawings[kind]);
  assert.equal((await admin.call('/training-projects/project-06','PUT',{kind:'layout',mediaId:old.id,expectedVersion:old.version})).status,409);
  assert.equal((await admin.call('/training-projects/project-06','PUT',{kind:'layout',mediaId:old.id})).status,428);
  assert.equal((await member.call('/training-projects/project-06','PUT',{kind:'layout',mediaId:old.id,expectedVersion:current.version})).status,403);
  for(const client of [member,secondMember]){const snapshot=await client.call(`/publications/${publicationId}`);assert.equal(snapshot.status,200);assert.deepEqual(snapshot.data.publication.document,document);assert.equal(hash(await mediaBytes(client,old.id)),oldHash);}
  await importTrainingDrawings(options(sourceDirectory));await admin.login(JSON.parse(await readFile(fixture.adminFile,'utf8')));
  const restored=JSON.parse(await readFile(path.join(directory,'single-slot-evidence/training-drawing-import.json'),'utf8')).entries[0];assert.equal(restored.projectId,'project-06');assert.equal(restored.kind,'layout');assert.equal(restored.sha256,oldHash);
  const evidence={passed:true,isolated:true,untouchedSlots:19,missingVersion:428,staleVersion:409,memberWrite:403,oldSnapshotPreserved:true,oldMediaSha256:oldHash,restoredSha256:restored.sha256};
  return {entry:restored,evidence};
}
