import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile,readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const bundled = await build({
  stdin: { contents: `export * from './app/simulator/core/lessons';export * from './app/simulator/core/engine';export * from './app/simulator/core/validation';export * from './app/simulator/core/course-roles';export * from './app/simulator/core/catalog';export * from './app/simulator/course-projects';export {default as CourseLibrary} from './app/simulator/CourseLibrary';export {createElement} from 'react';export {renderToStaticMarkup} from 'react-dom/server';`, resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
  loader: { '.css': 'empty' }, define: { '__STATIC_DEMO__': 'true', 'import.meta.env.BASE_URL': '"/diantuo-zhixun/"' },
});
const testModule = {exports:{}};
new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),testModule,testModule.exports);
const core = testModule.exports;

test('new practices and static course cards expose the same ten motor courses', () => {
  const ids = Array.from({length:10},(_,i)=>`motor-course-${String(i+1).padStart(2,'0')}`);
  assert.deepEqual(core.LESSONS.map(lesson=>lesson.id),ids);
  assert.equal(core.DEFAULT_LESSON_ID,ids[0]);
  assert.deepEqual(core.COURSE_PROJECTS.map(project=>project.lessonId),ids);
  const html=core.renderToStaticMarkup(core.createElement(core.CourseLibrary,{onPractice(){}}));
  assert.equal((html.match(/class="dt-reference-card"/g)??[]).length,10);
  assert.ok(html.includes('课程原图需登录成员站查看'));
  assert.ok(!html.includes('/api/media/'));
  assert.ok(!html.includes('工业电路图纸'));
  assert.ok(!html.includes('家庭电路图纸'));
  assert.equal(core.selectableProjects([...core.COURSE_PROJECTS,{id:'legacy',lessonId:'motor-jog'}]).length,10);
});

test('built Pages never contains any of the twenty private original PNG bytes',async()=>{
  const originals=JSON.parse(await readFile('architecture/course-drawings-2026-10-07.json','utf8')).entries;
  assert.equal(originals.length,20);const hashes=new Set(originals.map(entry=>entry.sha256));
  async function inspect(directory){for(const file of await readdir(directory,{withFileTypes:true})){const location=path.join(directory,file.name);if(file.isDirectory())await inspect(location);else if(file.name.toLowerCase().endsWith('.png'))assert.equal(hashes.has(createHash('sha256').update(await readFile(location)).digest('hex')),false,`Private PNG leaked into ${location}`);}}
  await inspect('docs');
});

for(const lesson of core.LEGACY_LESSONS)test(`historical ${lesson.id} retains validation, roles and electrical assessment`,()=>{
  assert.equal(core.isSelectableLesson(lesson.id),false);
  assert.equal(core.getLesson(lesson.id),lesson);
  const original=core.createLessonDocument(lesson.id,{wired:true});
  const restored=core.validateDocument(JSON.parse(JSON.stringify(original)));
  assert.equal(restored.valid,true);
  assert.deepEqual(restored.document,original);
  assert.ok(core.courseRequirements(lesson.id).length>0);
  assert.equal(core.assessLesson(restored.document).status,'passed');
});

test('course 06 aligns vertical XT2 and clockwise SQ switches above a compact button row in blank and wired practices',()=>{
  for(const wired of [false,true]){
    const doc=core.createLessonDocument('motor-course-06',{wired}),byRole=role=>doc.components.find(component=>component.id===doc.roles[role]);
    const xt1=byRole('xt16'),xt2=byRole('xt2'),limits=['sq1','sq2','sq3','sq4'].map(byRole),buttons=['sb1','sb2','sb3'].map(byRole),controls=[...limits,...buttons];
    assert.equal(xt2.type,'terminal-strip16');assert.equal(xt2.rotation,270);
    assert.equal(core.getDefinition(xt1.type).fixedConnections.length,16);
    const right=Math.max(...doc.components.filter(c=>core.isWireDuct(c.type)).map(c=>c.position.x+core.componentSize(c).width));
    for(const component of controls)assert.ok(component.position.x>right);
    assert.ok(xt2.position.x>right);assert.ok(xt2.position.x+core.componentSize(xt2).width<limits[0].position.x);
    assert.equal(limits[0].position.y,xt2.position.y);
    assert.equal(limits[3].position.y+core.componentSize(limits[3]).height,xt2.position.y+core.componentSize(xt2).height);
    for(const [index,component] of limits.entries()){
      assert.equal(component.position.x,limits[0].position.x);
      if(index)assert.ok(component.position.y>=limits[index-1].position.y+core.componentSize(limits[index-1]).height+28);
      assert.equal(component.rotation,90);
    }
    for(const [index,component] of buttons.entries()){
      assert.equal(component.position.y,buttons[0].position.y);
      assert.ok(component.position.y>=xt2.position.y+core.componentSize(xt2).height+28);
      if(index)assert.ok(component.position.x>=buttons[index-1].position.x+core.componentSize(buttons[index-1]).width+28);
    }
    assert.equal(buttons[0].position.x,xt2.position.x);
    assert.ok(buttons[2].position.x+core.componentSize(buttons[2]).width<=limits[0].position.x+core.componentSize(limits[0]).width);
    const horizontal=doc.components.filter(c=>c.type==='wire-duct');
    assert.ok(xt2.position.y>horizontal[0].position.y+core.componentSize(horizontal[0]).height);
    assert.ok(horizontal[3].position.y-horizontal[0].position.y<1000,'external controls must not stretch the cabinet rows');
    assert.ok(xt1.position.y>byRole('fr').position.y+core.componentSize(byRole('fr')).height);
    assert.equal(byRole('qf').type,'breaker3');
    if(!wired)assert.equal(doc.wires.length,0);
    else for(const component of controls)for(const wire of doc.wires.filter(w=>w.from.componentId===component.id||w.to.componentId===component.id))assert.ok([wire.from,wire.to].some(ref=>ref.componentId===(component.type==='limit-switch'?xt2.id:xt1.id)&&ref.terminalId.startsWith('B')));
  }
});
