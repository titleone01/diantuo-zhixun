import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle=await build({stdin:{contents:'export * from "./workspace-session";export * from "./core/lessons";',resolveDir:fileURLToPath(new URL('../app/simulator/',import.meta.url))},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const {WorkspaceBoundary,readRecovery,persistRecovery,recoveryAfterSave,createLessonDocument}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const lesson=()=>createLessonDocument('motor-jog',{wired:true});
const saved=(document,revision=1)=>({id:'my-draft',title:document.title,document,revision,createdAt:'2026-09-30',updatedAt:'2026-09-30'});

test('account boundary: A requests and deferred recovery writes cannot enter B, including A-B-A transitions',async()=>{
  const boundary=new WorkspaceBoundary(),storage=new Map();boundary.enter('member-A');const request=boundary.capture();
  const delayed=Promise.resolve().then(()=>{if(boundary.acceptsSession(request))storage.set('visible-profile','A private records');if(boundary.acceptsWorkspace(request))storage.set('recovery:member-B','A private drawing');});
  boundary.enter(null);boundary.enter('member-B');await delayed;assert.equal(storage.size,0);assert.equal(boundary.acceptsSession(request),false);
  boundary.enter('member-A');assert.equal(boundary.acceptsSession(request),false,'same account ID after another login is still a different session');
});

test('account boundary: replacing the working document rejects late loads/saves but keeps current account queries valid',()=>{
  const boundary=new WorkspaceBoundary();boundary.enter('member-A');const request=boundary.capture();boundary.replace();assert.equal(boundary.acceptsSession(request),true);assert.equal(boundary.acceptsWorkspace(request),false);
  const current=boundary.capture();assert.equal(boundary.acceptsWorkspace(current),true);
});

test('recovery: absence is distinct from malformed or obsolete local circuit data',()=>{
  assert.equal(readRecovery(null),null);
  for(const value of ['bad JSON','null','{}',JSON.stringify({document:{},dirty:true}),JSON.stringify({document:{...lesson(),schemaVersion:99},dirty:true}),JSON.stringify({document:lesson(),dirty:'yes'}),JSON.stringify({document:lesson(),dirty:true,saved:{...saved(lesson()),revision:0}})])assert.throws(()=>readRecovery(value));
});

test('recovery: validated draft retains the actual selected project and unsaved modifications',()=>{
  const doc=lesson();doc.trainingProjectId='project-04';doc.lessonId=undefined;doc.drawingMediaId='my-image';const result=readRecovery(JSON.stringify({document:doc,saved:null,dirty:true}));
  assert.equal(result.document.trainingProjectId,'project-04');assert.equal(result.document.lessonId,undefined);assert.equal(result.dirty,true);
  const old=lesson(),changed={...old,title:'尚未提交的新标题'},recovered=readRecovery(JSON.stringify({document:changed,saved:saved(old),dirty:false}));assert.equal(recovered.dirty,true,'an incorrect old dirty flag cannot claim a newer document is server-saved');
});

test('save completion: edits made during the request remain dirty and become the recovery document',()=>{
  const submitted=lesson(),current=structuredClone(submitted);current.title='保存期间继续编辑';current.components[0].position.x+=75;
  const acknowledgement=saved(submitted,2),next=recoveryAfterSave(current,submitted,acknowledgement);
  assert.equal(next.dirty,true);assert.equal(next.document.title,current.title);assert.equal(next.document.components[0].position.x,current.components[0].position.x);assert.equal(next.saved.revision,2);assert.deepEqual(next.saved.document,submitted);
  const second=recoveryAfterSave(current,structuredClone(current),saved(current,3));assert.equal(second.dirty,false);assert.equal(second.saved.revision,3);
});

test('recovery writes preserve unreadable historical bytes before replacing the working record',()=>{
  const key='recovery:member-A',raw='{"document": broken historical data';
  const values=new Map([[key,raw],['recovery:member-B','other account']]);
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const next={document:lesson(),saved:null,dirty:true};
  persistRecovery(storage,key,next);
  const backups=[...values].filter(([name])=>name.startsWith(`${key}:unreadable:`));
  assert.equal(backups.length,1);assert.equal(backups[0][1],raw);
  assert.deepEqual(readRecovery(values.get(key)),next);
  persistRecovery(storage,key,{...next,dirty:false});
  assert.equal(values.size,3,'valid recovery does not create another backup');
  assert.equal(values.get('recovery:member-B'),'other account');
});

test('recovery quota failure cannot overwrite the only unreadable copy',()=>{
  const key='recovery:member-A',raw='old unreadable data',values=new Map([[key,raw]]);
  const storage={getItem:key=>values.get(key)??null,setItem:(name,value)=>{
    if(name!==key)throw new Error('QuotaExceededError');values.set(name,value);
  }};
  assert.throws(()=>persistRecovery(storage,key,{document:lesson(),saved:null,dirty:true}),/QuotaExceededError/);
  assert.equal(values.get(key),raw);
});
