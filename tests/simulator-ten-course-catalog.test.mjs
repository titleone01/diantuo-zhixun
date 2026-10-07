import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

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

test('course 06 follows the updated XT2/SQ layout in both blank and wired practices',()=>{
  for(const wired of [false,true]){
    const doc=core.createLessonDocument('motor-course-06',{wired});
    const byRole=role=>doc.components.find(component=>component.id===doc.roles[role]);
    const xt2=byRole('xt2'),xt1=byRole('xt16'),sq=['sq1','sq2','sq3','sq4'].map(byRole),sb=['sb1','sb2','sb3'].map(byRole);
    assert.equal(xt2.rotation,270);
    assert.equal(core.getDefinition(xt2.type).fixedConnections.length,16);
    for(const component of [...sq,...sb])assert.ok(component.position.x>=xt2.position.x+core.componentSize(xt2).width);
    for(const group of [sq,sb])for(let i=1;i<group.length;i++)assert.ok(group[i].position.y>group[i-1].position.y+core.componentSize(group[i-1]).height);
    assert.ok(sb[0].position.y>sq[3].position.y+core.componentSize(sq[3]).height);
    assert.ok(xt1.position.y>byRole('fr').position.y+core.componentSize(byRole('fr')).height);
    assert.equal(byRole('qf').type,'breaker3');
    if(!wired)assert.equal(doc.wires.length,0);
  }
});
