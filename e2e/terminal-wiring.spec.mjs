import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const fixture = JSON.parse(await readFile(process.env.DIANTUO_BROWSER_FIXTURE, 'utf8'));

async function login(page) {
  await page.goto('/');
  await page.getByLabel('账号', {exact:true}).fill(fixture.accounts[0].username);
  await page.getByLabel('密码', {exact:true}).fill(fixture.accounts[0].password);
  await page.getByRole('button', {name:'登录',exact:true}).click();
  await expect(page.getByRole('button', {name:'开始仿真',exact:true})).toBeVisible();
}
async function open(page, draft) {
  await page.getByRole('link',{name:'个人中心',exact:true}).click();
  await page.getByRole('button',{name:'草稿箱',exact:true}).click();
  await page.getByLabel('每页草稿数量').selectOption('50');
  await page.getByRole('row').filter({has:page.getByText(draft.title,{exact:true})}).getByRole('button',{name:'编辑',exact:true}).click();
  const collapse=page.getByRole('button',{name:'收起图纸',exact:true}); if(await collapse.isVisible())await collapse.click();
  await page.locator('.react-flow__controls-fitview').click();
}
const ref = (componentId,terminalId)=>({componentId,terminalId});
function practice(title) {
  return {schemaVersion:1,title,components:[
    {id:'source',type:'supply',label:'电源',position:{x:80,y:470}},
    {id:'xt',type:'terminal-strip16',label:'XT1',position:{x:120,y:150}},
    {id:'a',type:'terminal',label:'A',position:{x:870,y:80}},
    {id:'b',type:'terminal',label:'B',position:{x:870,y:330}},
  ],wires:[]};
}
async function create(page,document) {
  const response=await page.request.post('/api/circuits',{headers:{origin:new URL(page.url()).origin},data:{title:document.title,document}});
  expect(response.status()).toBe(201); const body=await response.json();return {title:document.title,id:body.circuit.id,document};
}
async function drag(page,from,to) {
  const first=page.locator(`[data-terminal-key="${from}"]`),last=page.locator(`[data-terminal-key="${to}"]`);
  await first.hover(); await last.hover();const a=await first.boundingBox(),b=await last.boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:20});await page.mouse.up();
}
async function exported(page) {
  await page.getByRole('button',{name:'导出图纸到本地',exact:true}).click();
  const document=JSON.parse(await page.getByLabel('导出的电路 JSON',{exact:true}).inputValue());
  await page.getByRole('button',{name:'关闭电路文件窗口',exact:true}).click();return document;
}
async function endpoints(page) {
  const wires=await page.locator('.sim-wire').evaluateAll(elements=>elements.map(element=>({from:element.dataset.fromTerminal,to:element.dataset.toTerminal,fromWorld:JSON.parse(element.dataset.fromWorld),toWorld:JSON.parse(element.dataset.toWorld)})));
  for(const wire of wires)for(const [key,point] of [[wire.from,wire.fromWorld],[wire.to,wire.toWorld]]){
    expect(await page.locator(`[data-terminal-key="${key}"]`).evaluate(el=>({x:Number(el.dataset.worldX),y:Number(el.dataset.worldY)}))).toEqual(point);
  }
  return wires;
}
async function selectWire(page, id) {
  const position=await page.locator(`[data-wire-id="${id}"] > .react-flow__edge-path`).evaluate(path=>{
    const point=path.getPointAtLength(path.getTotalLength()*0.55); const screen=new DOMPoint(point.x,point.y).matrixTransform(path.getScreenCTM());return {x:screen.x,y:screen.y};
  }); await page.mouse.click(position.x,position.y);
  await expect(page.locator(`[data-wire-id="${id}"]`)).toHaveClass(/is-selected/);
}
test('terminal color: top-bottom, reverse dragging, whole group undo, rotation and reload',async({page})=>{
  await login(page);const draft=await create(page,practice('Terminal color browser'));await open(page,draft);
  await drag(page,'source::L3','xt::T2');await expect(page.locator('.sim-wire')).toHaveCount(1);
  await drag(page,'a::A','xt::B2');await expect(page.locator('.sim-wire')).toHaveCount(2);
  await drag(page,'xt::B4','source::L3');await drag(page,'xt::T4','b::A');await expect(page.locator('.sim-wire')).toHaveCount(4);
  let document=await exported(page);expect(document.wires.map(w=>w.color)).toEqual(Array(4).fill('#f04452'));
  await expect(page.locator('[data-terminal-key="xt::T2"]')).toHaveCSS('border-color','rgb(240, 68, 82)');
  await expect(page.locator('[data-terminal-key="xt::B2"]')).toHaveCSS('border-color','rgb(240, 68, 82)');
  await selectWire(page,document.wires[0].id);
  await expect(page.locator('.sim-wire.is-selected .sim-wire-outline')).toBeVisible();
  await expect(page.locator('.sim-wire.is-selected .sim-wire-selected-endpoint')).toHaveCount(2);
  await page.getByRole('button',{name:'设置导线颜色',exact:true}).click();
  await page.getByRole('button',{name:'选择导线颜色 #3478f6',exact:true}).click();
  expect((await exported(page)).wires.map(w=>w.color)).toEqual(Array(4).fill('#3478f6'));
  await page.getByRole('button',{name:'撤销',exact:true}).click();expect((await exported(page)).wires.map(w=>w.color)).toEqual(Array(4).fill('#f04452'));
  await page.getByRole('button',{name:'重做',exact:true}).click();expect((await exported(page)).wires.map(w=>w.color)).toEqual(Array(4).fill('#3478f6'));
  const before=await endpoints(page);await page.locator('[data-device-id="xt"]').click({position:{x:35,y:40}});
  for(let i=0;i<3;i++)await page.getByRole('button',{name:'旋转90°',exact:true}).click();
  await page.locator('.react-flow__controls-fitview').click();document=await exported(page);expect(document.components.find(c=>c.id==='xt').rotation).toBe(270);
  expect(await endpoints(page)).not.toEqual(before);
  const movedBox=await page.locator('[data-device-id="xt"]').boundingBox();
  await page.mouse.move(movedBox.x+35,movedBox.y+50);await page.mouse.down();await page.mouse.move(movedBox.x+70,movedBox.y+80,{steps:15});await page.mouse.up();
  const moved=await endpoints(page);await page.locator('.react-flow__controls-zoomout').click();expect(await endpoints(page)).toEqual(moved);
  const saved=page.waitForResponse(r=>r.url().endsWith(`/api/circuits/${draft.id}`)&&r.request().method()==='PUT');
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();expect((await saved).status()).toBe(200);
  await page.reload();await expect(page.locator('.sim-wire')).toHaveCount(4);expect(await endpoints(page)).toEqual(moved);
  expect((await exported(page)).wires.map(w=>w.color)).toEqual(Array(4).fill('#3478f6'));
  await page.screenshot({path:path.join(process.env.DIANTUO_BROWSER_PRIVATE_OUTPUT,'terminal-colors-rotated.png')});
});
test('legacy draft retains mixed colors until the user resolves its group',async({page})=>{
  await login(page);const document=practice('Legacy terminal colors');document.wires=[
    {id:'red',from:ref('source','L3'),to:ref('xt','T2'),color:'#f04452'},
    {id:'green',from:ref('xt','B2'),to:ref('a','A'),color:'#20b963'},
  ];const draft=await create(page,document);await open(page,draft);
  expect((await exported(page)).wires).toEqual(document.wires);
  await drag(page,'xt::B2','b::A');await expect(page.locator('.sim-toast')).toContainText('不同线色');
  await selectWire(page,'red');await page.getByRole('button',{name:'设置导线颜色',exact:true}).click();
  await page.getByRole('button',{name:'选择导线颜色 #f04452',exact:true}).click();
  expect((await exported(page)).wires.map(w=>w.color)).toEqual(Array(3).fill('#f04452'));
});
test('server reports terminal bypass separately from electrical lesson status',async({page})=>{
  await login(page);const draft=fixture.drafts['motor-course-01:correct'];const document=structuredClone(draft.document);
  const external=document.wires.find(w=>[w.from,w.to].some(ref=>ref.componentId===document.roles.source&&ref.terminalId==='L1'));
  const internal=document.wires.find(w=>w.from.componentId===document.roles.xt16&&w.from.terminalId==='T1'||w.to.componentId===document.roles.xt16&&w.to.terminalId==='T1');
  const target=internal.from.componentId===document.roles.xt16?internal.to:internal.from;
  document.wires=document.wires.filter(w=>w.id!==external.id&&w.id!==internal.id);
  document.wires.push({id:'bypass',from:ref(document.roles.source,'L1'),to:target,color:external.color});
  const response=await page.request.post('/api/assess',{headers:{origin:new URL(page.url()).origin},data:{document,lessonId:document.lessonId}});
  expect(response.status()).toBe(200);const body=await response.json();
  expect(body.assessment.status).toBe('passed');expect(body.workmanship.status).toBe('incomplete');
  expect(body.workmanship.diagnostics.some(d=>d.code==='TERMINAL_BOUNDARY_BYPASS')).toBe(true);
});
test('same-color phase fault retains its electrical diagnosis and all rendered wires',async({page})=>{
  await login(page);const document=structuredClone(fixture.drafts['motor-course-01:correct'].document);document.title='Same-color phase fault';
  document.wires.push({id:'phase-fault',from:ref(document.roles.xt16,'T1'),to:ref(document.roles.xt16,'T2'),color:'#56616f',routing:'duct',style:'orthogonal'});
  document.wires=document.wires.map(w=>({...w,color:'#56616f'}));const draft=await create(page,document);await open(page,draft);
  const assessment=await page.request.post('/api/assess',{headers:{origin:new URL(page.url()).origin},data:{document,lessonId:document.lessonId}});
  expect(assessment.status()).toBe(200);const body=await assessment.json();expect(body.assessment.status).not.toBe('passed');
  expect(body.workmanship.diagnostics.some(d=>d.code==='WIRE_GROUP_SOURCE_CONFLICT')).toBe(true);
  const paths=()=>page.locator('.sim-wire > .react-flow__edge-path').evaluateAll(elements=>elements.map(p=>({d:p.getAttribute('d'),stroke:p.style.stroke,display:getComputedStyle(p).display,opacity:getComputedStyle(p).opacity})));
  const before=await paths();expect(before).toHaveLength(document.wires.length);
  await page.getByRole('button',{name:'开始仿真',exact:true}).click();
  await expect(page.locator('.sim-canvas-heading i')).toHaveText('故障中止');expect(await paths()).toEqual(before);
  await page.screenshot({path:path.join(process.env.DIANTUO_BROWSER_PRIVATE_OUTPUT,'phase-fault-wires-visible.png')});
  await page.getByRole('alertdialog',{name:'短路警告',exact:true}).getByRole('button',{name:'确定',exact:true}).click();
  await page.getByRole('button',{name:'结束仿真',exact:true}).click();expect(await paths()).toEqual(before);
});

test('simulation visibility: timer ticks and ten stop-restart cycles never remove wire SVGs',async({page})=>{
  await login(page);const draft=fixture.drafts['motor-course-08:correct'];await open(page,draft);
  await expect(page.locator('.sim-wire')).toHaveCount(draft.document.wires.length);
  await page.evaluate(expected=>{
    window.wireVisibilitySamples=[];
    new MutationObserver(()=>{
      const count=document.querySelectorAll('.sim-wire').length;
      if(count!==expected)window.wireVisibilitySamples.push({count,time:performance.now()});
    }).observe(document.querySelector('.react-flow'),{childList:true,subtree:true,attributes:true});
  },draft.document.wires.length);
  for(let i=0;i<10;i++){
    await page.getByRole('button',{name:'开始仿真',exact:true}).click();
    await page.locator(`[data-device-id="${draft.document.roles.qf}"] .sim-toggle-actuator`).click();
    await page.locator(`[data-device-id="${draft.document.roles.sb1}"] .sim-actuator`).press('Enter');
    await expect(page.locator('.sim-wire')).toHaveCount(draft.document.wires.length);
    await page.waitForTimeout(250);
    await page.getByRole('button',{name:'推进 1 秒',exact:true}).click();
    await page.getByRole('button',{name:'结束仿真',exact:true}).click();
  }
  expect(await page.evaluate(()=>window.wireVisibilitySamples)).toEqual([]);
});
test('twenty revised drawings: both member browsers read matching PNGs and anonymous is denied',async({page,browser})=>{
  test.skip(!fixture.drawingEntries?.length,'This run has no private revised drawing directory configured');
  await login(page);expect(fixture.drawingEntries).toHaveLength(20);
  const memberB=await browser.newContext(); const second=await memberB.newPage(); const anonymous=await browser.newContext();
  try {
    await second.goto('/'); await second.getByLabel('账号',{exact:true}).fill(fixture.accounts[1].username);await second.getByLabel('密码',{exact:true}).fill(fixture.accounts[1].password);await second.getByRole('button',{name:'登录',exact:true}).click();
    await expect(second.getByRole('button',{name:'开始仿真',exact:true})).toBeVisible();
    for(const entry of fixture.drawingEntries){
      for(const member of [page,second]){
        const response=await member.request.get(`/api/media/${entry.mediaId}`);expect(response.status()).toBe(200);expect(response.headers()['content-type']).toBe('image/png');
        expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(entry.sha256);
      }
      expect((await anonymous.request.get(`/api/media/${entry.mediaId}`)).status()).toBe(401);
    }
  }finally{await memberB.close();await anonymous.close();}
});
