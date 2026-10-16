import { loadWorkspaceFixture, readWorkspaceDocument } from './workspace-fixtures.mjs';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const fixture = JSON.parse(await readFile(process.env.DIANTUO_BROWSER_FIXTURE, 'utf8'));
const ref = (componentId, terminalId) => ({ componentId, terminalId });
const wire = (id, a, at, b, bt, wireNumber) => ({ id, from:ref(a,at), to:ref(b,bt), color:'#3478f6', style:'straight', ...(wireNumber ? {wireNumber} : {}) });
const branch = () => ({
  schemaVersion:1, title:'Equipotential browser fixture', components:[
    {id:'a',type:'terminal',label:'A',position:{x:80,y:100}},
    {id:'b',type:'terminal',label:'B',position:{x:350,y:100}},
    {id:'c',type:'terminal',label:'C',position:{x:650,y:100}},
    {id:'d',type:'terminal',label:'D',position:{x:350,y:380}},
    {id:'e',type:'terminal',label:'E',position:{x:650,y:380}},
  ], wires:[wire('ab','a','A','b','A'),wire('bc','b','B','c','A'),wire('ad','a','B','d','A'),wire('isolated','c','A2','d','A2','9')],
});
async function login(page, account=0) {
  await page.goto('/');
  await page.getByLabel('账号',{exact:true}).fill(fixture.accounts[account].username);
  await page.getByLabel('密码',{exact:true}).fill(fixture.accounts[account].password);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page.getByRole('button',{name:'开始仿真',exact:true})).toBeVisible();
}
async function importDocument(page, document) { await loadWorkspaceFixture(page, document); }
async function exported(page) { return readWorkspaceDocument(page); }
async function clearTrace(page) {
  await page.locator('.sim-canvas').focus(); await page.keyboard.press('Escape');
  await expect(page.locator('[data-wire-traced="true"].sim-wire')).toHaveCount(0);
}
async function selectWire(page,id) {
  // Fit View animates; a device hover waits for the shared viewport to settle.
  await page.locator('[data-device-id]').first().hover();
  const point=await page.locator(`[data-wire-id="${id}"] > .react-flow__edge-path`).evaluate(p=>{
    for(const fraction of [.5,.35,.65,.2,.8]){
      const point=p.getPointAtLength(p.getTotalLength()*fraction),screen=new DOMPoint(point.x,point.y).matrixTransform(p.getScreenCTM());
      const hit=document.elementFromPoint(screen.x,screen.y);
      if(hit?.closest('[data-wire-id]')===p.closest('[data-wire-id]'))return {x:screen.x,y:screen.y};
    }
    throw new Error('No exposed target wire segment for a real pointer click');
  });
  await page.mouse.click(point.x,point.y);
  await expect(page.locator(`[data-wire-id="${id}"]`)).toHaveAttribute('data-wire-traced','true');
}
async function collapse(page) {
  const button=page.getByRole('button',{name:'收起图纸',exact:true}); if(await button.isVisible())await button.click();
}
async function dragTerminal(page,from,to) {
  const first=page.locator(`[data-terminal-key="${from}"]`),last=page.locator(`[data-terminal-key="${to}"]`);
  await first.hover();await last.hover();
  const a=await first.boundingBox(), b=await last.boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2); await page.mouse.down();
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:18}); await page.mouse.up();
}
async function endpoints(page) {
  const wires=await page.locator('.sim-wire').evaluateAll(items=>items.map(w=>({from:w.dataset.fromTerminal,to:w.dataset.toTerminal,fromWorld:JSON.parse(w.dataset.fromWorld),toWorld:JSON.parse(w.dataset.toWorld)})));
  for(const w of wires)for(const [key,point] of [[w.from,w.fromWorld],[w.to,w.toWorld]])expect(await page.locator(`[data-terminal-key="${key}"]`).evaluate(t=>({x:Number(t.dataset.worldX),y:Number(t.dataset.worldY)}))).toEqual(point);
  return wires;
}

test('wiring improvements: top numbering labels the whole net while style, color and deletion stay selected',async({page})=>{
  await login(page); await importDocument(page,branch()); await collapse(page); await page.locator('.react-flow__controls-fitview').click();
  await expect(page.getByRole('button',{name:'标注线号 1',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'等电位',exact:true}).click(); await selectWire(page,'ab');
  await expect(page.locator('.sim-wire[data-wire-traced="true"]')).toHaveCount(3);
  await expect(page.locator('.sim-wire.is-selected')).toHaveCount(1);
  for(let value=1;value<=10;value++){
    await page.getByRole('button',{name:'标注线号 '+value,exact:true}).click();
    const doc=await exported(page);expect(doc.wires.slice(0,3).map(w=>w.wireNumber)).toEqual(Array(3).fill(String(value)));expect(doc.wires[3].wireNumber).toBe('9');
    await expect(page.locator('[data-terminal-key="b::B"]')).toHaveAttribute('data-wire-number',String(value));
  }
  for(const value of ['0','U1']){await page.getByLabel('自定义线号',{exact:true}).fill(value);await page.getByRole('button',{name:'标注',exact:true}).click();expect((await exported(page)).wires.slice(0,3).map(w=>w.wireNumber)).toEqual(Array(3).fill(value));}
  await page.getByLabel('显示线号',{exact:true}).uncheck();await expect(page.locator('.sim-wire-number')).toHaveCount(0);await page.getByLabel('显示线号',{exact:true}).check();
  await page.getByRole('button',{name:'清除',exact:true}).click();expect((await exported(page)).wires.slice(0,3).every(w=>!Object.hasOwn(w,'wireNumber'))).toBe(true);
  await page.getByRole('button',{name:'标注线号 4',exact:true}).click();
  await page.getByLabel('线条样式',{exact:true}).selectOption('curve');
  let doc=await exported(page);expect(doc.wires.find(w=>w.id==='ab').style).toBe('curve');expect(doc.wires.filter(w=>w.id!=='ab').every(w=>w.style==='straight')).toBe(true);
  await page.getByRole('button',{name:'设置导线颜色',exact:true}).click();await page.getByRole('button',{name:'选择导线颜色 #f04452',exact:true}).click();
  doc=await exported(page);expect(doc.wires.find(w=>w.id==='ab').color).toBe('#f04452');expect(doc.wires.filter(w=>w.id!=='ab').every(w=>w.color==='#3478f6')).toBe(true);
  await page.getByRole('button',{name:'开始仿真',exact:true}).click();await expect(page.getByLabel('自定义线号',{exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'标注线号 4',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'结束仿真',exact:true}).click();await page.getByRole('button',{name:'删除选中',exact:true}).click();expect((await exported(page)).wires.map(w=>w.id)).toEqual(['bc','ad','isolated']);
  await selectWire(page,'bc');await page.locator('.sim-canvas').focus();await page.keyboard.press('Escape');await expect(page.getByLabel('巡线与线号',{exact:true})).toHaveCount(0);
});

test('wiring improvements: real drag inherits labels, reports conflicts and preserves world endpoints through save and reload',async({page})=>{
  await login(page); const doc=branch(); for(const w of doc.wires.slice(0,3))w.wireNumber='4';
  await importDocument(page,doc); await collapse(page); await page.locator('.react-flow__controls-fitview').click(); await clearTrace(page);
  await page.getByLabel('线条样式',{exact:true}).selectOption('straight');
  await dragTerminal(page,'a::B','e::A'); await expect(page.locator('.sim-wire')).toHaveCount(5);
  expect((await exported(page)).wires.at(-1).wireNumber).toBe('4'); await clearTrace(page);
  await dragTerminal(page,'e::B','c::A2'); await expect(page.locator('.sim-wire')).toHaveCount(6);
  const current=await exported(page);
  expect(current.wires.at(-1).wireNumber).toBeUndefined();
  expect(current.wires.slice(0,4).map(w=>w.wireNumber)).toEqual(['4','4','4','9']);
  await expect(page.getByText(/同一接线节点有多个线号/)).toBeVisible();
  await endpoints(page);
  const device=page.locator('[data-device-id="e"] .sim-device-caption'), box=await device.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down(); await page.mouse.move(box.x+50,box.y+30,{steps:12}); await page.mouse.up();
  await endpoints(page); await page.locator('.react-flow__controls-zoomin').click(); await endpoints(page);
  const savedResponse=page.waitForResponse(r=>/\/api\/circuits(?:\/[^/]+)?$/.test(r.url())&&['POST','PUT'].includes(r.request().method()));
  await page.getByRole('button',{name:'保存草稿',exact:true}).click(); const response=await savedResponse; expect([200,201]).toContain(response.status());
  const saved=(await response.json()).circuit; expect(saved.document.wires).toEqual((await exported(page)).wires);
  const publishedResponse=page.waitForResponse(r=>r.url().endsWith(`/api/circuits/${saved.id}/publish`)&&r.request().method()==='POST');
  await page.getByRole('button',{name:'发布电路',exact:true}).click(); const published=await publishedResponse; expect(published.status()).toBe(201);
  expect((await published.json()).publication.document.wires).toEqual(saved.document.wires);
  await page.goto('/'); await expect(page.getByRole('button',{name:'开始仿真',exact:true})).toBeVisible(); await collapse(page);
  const recovered=await exported(page); expect(recovered.wires).toEqual(saved.document.wires); await endpoints(page);
  await importDocument(page,recovered); expect((await exported(page)).wires).toEqual(saved.document.wires);
  await importDocument(page,branch()); expect((await exported(page)).wires.slice(0,3).every(w=>!Object.hasOwn(w,'wireNumber'))).toBe(true);
});

test('wiring improvements: checked and normally released coils appear in runtime without a safety badge',async({page})=>{
  await login(page); await importDocument(page,fixture.drafts['motor-course-02:correct'].document); await collapse(page);
  await page.getByRole('button',{name:'检查接线',exact:true}).click();
  await page.getByRole('button',{name:'运行状态',exact:true}).click();
  await expect(page.getByText(/当前未得电，控制回路未导通/)).toBeVisible();
  await expect(page.getByRole('button',{name:'安全诊断',exact:true}).locator('i')).toHaveCount(0);
  await expect(page.locator('.sim-device-node.has-diagnostic,.sim-terminal.has-diagnostic')).toHaveCount(0);
  await page.getByRole('button',{name:'开始仿真',exact:true}).click();
  const tap=async id=>{const b=page.locator(`[data-device-id="${id}"] .sim-actuator`);await b.focus();await b.press('Enter');};
  await tap('qf'); await tap('sb2'); await expect(page.locator('[data-device-id="m"]')).toHaveClass(/is-active/);
  await tap('sb1'); await expect(page.locator('[data-device-id="m"]')).not.toHaveClass(/is-active/);
  await page.getByRole('button',{name:'运行状态',exact:true}).click(); await expect(page.getByText(/当前未得电，控制回路未导通/)).toBeVisible();
  await page.getByRole('button',{name:'安全诊断',exact:true}).click(); await expect(page.getByText('当前状态未检出安全故障',{exact:true})).toBeVisible();
});

async function openProjectDrawing(page) {
  const panel=page.locator('.sim-diagram');
  await panel.getByRole('button',{name:'选择项目图纸',exact:true}).click();
  await panel.getByLabel('选择训练项目图纸',{exact:true}).selectOption(fixture.modalCourse.id);
  await expect(panel.getByRole('button',{name:'用于当前练习',exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'用于当前练习',exact:true}).click();
  await expect.poll(()=>panel.locator('img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
  return panel;
}
async function moveWindow(page,panel,left,top) {
  const rect=await panel.boundingBox(), grip=await panel.getByRole('button',{name:'拖动图纸窗口',exact:true}).boundingBox();
  const x=grip.x+grip.width/2,y=grip.y+grip.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+left-rect.x,y+top-rect.y,{steps:15});await page.mouse.up();
}

test('drawing improvements: fixed window reaches the whole page, all resize handles work and viewport changes keep its title reachable',async({page})=>{
  await login(page); const panel=await openProjectDrawing(page);
  // Hover waits for the initial Fit View animation before taking its baseline.
  await page.locator('[data-device-id]').first().hover();
  const viewport=await page.locator('.react-flow__viewport').getAttribute('style');
  await moveWindow(page,panel,24,20); let rect=await panel.boundingBox();
  expect(rect.x).toBeCloseTo(24,0);expect(rect.y).toBeCloseTo(20,0);
  expect(await panel.evaluate(p=>getComputedStyle(p).position)).toBe('fixed');
  expect(await page.locator('.react-flow__viewport').getAttribute('style')).toBe(viewport);
  for(const edge of ['n','ne','e','se','s','sw','w','nw']) {
    await panel.getByRole('button',{name:'复位图纸窗口',exact:true}).click();
    const before=await panel.boundingBox(),handle=await panel.locator(`[data-resize-edge="${edge}"]`).boundingBox();
    const x=handle.x+handle.width/2,y=handle.y+handle.height/2;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+20,y+20,{steps:8});await page.mouse.up();
    const after=await panel.boundingBox();expect(Math.abs(after.width-before.width)+Math.abs(after.height-before.height)).toBeGreaterThan(10);
  }
  await moveWindow(page,panel,28,18);await page.setViewportSize({width:390,height:520});
  await expect.poll(()=>panel.locator('.sim-diagram-header').evaluate(h=>{const r=h.getBoundingClientRect();return r.left>=7&&r.right<=innerWidth-7&&r.top>=7&&r.top<=innerHeight-36;})).toBe(true);
  await panel.getByRole('button',{name:'收起图纸',exact:true}).click(); await expect(panel.getByRole('button',{name:'展开图纸',exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'展开图纸',exact:true}).click();await panel.getByRole('button',{name:'全屏查看图纸',exact:true}).click();
  await expect(panel).toHaveClass(/is-fullscreen/);await page.keyboard.press('Escape');await expect(panel).not.toHaveClass(/is-fullscreen/);
});

function pdfFixture() {
  const stream='BT /F1 12 Tf 20 80 Td (Popup private PDF) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let content='%PDF-1.4\n';
  const offsets=objects.map((o,i)=>{const offset=Buffer.byteLength(content);content+=`${i+1} 0 obj\n${o}\nendobj\n`;return offset;});const xref=Buffer.byteLength(content);
  content+=`xref\n0 6\n0000000000 65535 f \n${offsets.map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}
test('drawing improvements: one popup follows images and PDF, pins, survives navigation and closes for account changes',async({page,context})=>{
  await login(page);
  const origin=new URL(page.url()).origin;
  const upload=async(buffer,name,mimeType)=>{const r=await page.request.post('/api/media',{headers:{origin},multipart:{file:{buffer,name,mimeType}}});expect(r.status()).toBe(201);return(await r.json()).media;};
  const image=await upload(await readFile(path.resolve('public/schematic.png')),'popup-owned.png','image/png');
  const pdf=await upload(pdfFixture(),'popup-owned.pdf','application/pdf');
  const doc={schemaVersion:1,title:'Popup media fixture',components:[],wires:[],drawingMediaId:image.id,drawingMediaType:'image/png',drawingKind:'schematic',projectDrawings:{schematic:{mediaId:image.id,type:'image/png'},layout:{mediaId:pdf.id,type:'application/pdf'}}};
  await importDocument(page,doc); const panel=page.locator('.sim-diagram');await expect(panel.locator('img')).toBeVisible();
  let popupPromise=page.waitForEvent('popup');await panel.getByRole('button',{name:'独立窗口查看图纸',exact:true}).click();let popup=await popupPromise;
  await expect(popup.getByLabel('独立图纸窗口',{exact:true})).toBeVisible();
  await expect.poll(()=>popup.locator('img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
  await popup.getByRole('button',{name:'放大原图',exact:true}).click();
  await expect(popup.locator('.dt-drawing-viewer')).toHaveAttribute('data-drawing-zoom','1.25');
  await expect(panel.locator('.dt-drawing-viewer')).toHaveAttribute('data-drawing-zoom','1');
  await popup.getByRole('button',{name:'锁定当前图纸',exact:true}).click();
  await panel.getByRole('tab',{name:'元件布置图',exact:true}).click();
  await expect(panel.locator('[data-pdf-state="ready"]')).toBeVisible();
  await expect(popup.locator('img')).toHaveAttribute('src',`/api/media/${image.id}`);
  await popup.getByRole('button',{name:'恢复跟随',exact:true}).click();
  await expect(popup.locator('[data-pdf-state="ready"]')).toBeVisible();
  expect(await popup.locator('canvas').evaluate(c=>c.width>0&&c.height>0)).toBe(true);
  await panel.getByRole('button',{name:'独立窗口查看图纸',exact:true}).click();expect(context.pages()).toHaveLength(2);
  await page.getByRole('link',{name:'图纸集',exact:true}).click();expect(popup.isClosed()).toBe(false);await expect(popup.locator('[data-pdf-state="ready"]')).toBeVisible();
  await page.getByRole('link',{name:'模拟电路',exact:true}).click();await expect(panel).toBeVisible();
  await panel.getByRole('tab',{name:'原理图',exact:true}).click();await expect(popup.locator('img')).toBeVisible();
  await popup.close();popupPromise=page.waitForEvent('popup');await panel.getByRole('button',{name:'独立窗口查看图纸',exact:true}).click();popup=await popupPromise;
  await expect(popup.locator('img')).toBeVisible();
  await page.getByRole('link',{name:'个人中心',exact:true}).click();
  await page.getByRole('button',{name:'退出登录',exact:true}).click();await expect.poll(()=>popup.isClosed()).toBe(true);
  await page.getByLabel('账号',{exact:true}).fill(fixture.accounts[1].username);await page.getByLabel('密码',{exact:true}).fill(fixture.accounts[1].password);await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page.getByRole('button',{name:'开始仿真',exact:true})).toBeVisible();
  expect((await page.request.get(`/api/media/${image.id}`)).status()).toBe(404);
  expect((await page.request.get(`/api/media/${pdf.id}`)).status()).toBe(404);
  expect(context.pages()).toHaveLength(1);
});

test('drawing improvements: blocked popup keeps the in-page viewer and closing the main page closes its popup',async({page})=>{
  await login(page);const panel=await openProjectDrawing(page);
  await page.evaluate(()=>{window.__realOpen=window.open;window.open=()=>null;});
  await panel.getByRole('button',{name:'独立窗口查看图纸',exact:true}).click();
  await expect(page.getByText(/浏览器未允许打开独立图纸窗口/)).toBeVisible();await expect(panel.locator('img')).toBeVisible();
  await page.evaluate(()=>{window.open=window.__realOpen;delete window.__realOpen;});
  const popupPromise=page.waitForEvent('popup');await panel.getByRole('button',{name:'独立窗口查看图纸',exact:true}).click();const popup=await popupPromise;
  await expect(popup.getByLabel('独立图纸窗口',{exact:true})).toBeVisible();await page.close({runBeforeUnload:true});await expect.poll(()=>popup.isClosed()).toBe(true);
});
