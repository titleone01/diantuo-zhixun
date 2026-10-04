import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const fixture=JSON.parse(await readFile(process.env.DIANTUO_BROWSER_FIXTURE,'utf8'));
const document={schemaVersion:1,title:'Browser duct feedback',components:[
  {id:'route-a',type:'terminal',label:'XT1',position:{x:80,y:220}},
  {id:'route-b',type:'terminal',label:'XT2',position:{x:600,y:220}},
  {id:'route-left',type:'wire-duct',label:'WD1',position:{x:0,y:100},size:{width:350,height:50}},
  {id:'route-right',type:'wire-duct',label:'WD2',position:{x:350,y:100},size:{width:400,height:50}},
],wires:[]};
async function open(page){
  await page.goto('/');await page.getByLabel('账号',{exact:true}).fill(fixture.accounts[0].username);await page.getByLabel('密码',{exact:true}).fill(fixture.accounts[0].password);
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('button',{name:'开始仿真',exact:true})).toBeVisible();
  await page.locator('.dt-document-disclosure summary').click();await page.getByRole('button',{name:'新建电路',exact:true}).click();
  await page.getByRole('button',{name:'导入本地保存的图纸',exact:true}).click();await page.getByLabel('待导入的电路 JSON',{exact:true}).fill(JSON.stringify(document));await page.getByRole('button',{name:'导入粘贴内容',exact:true}).click();
  await expect(page.locator('[data-device-id]')).toHaveCount(4);
  const disclosure=page.locator('.dt-document-disclosure');if(await disclosure.getAttribute('open')!==null)await disclosure.locator('summary').click();
  const collapse=page.getByRole('button',{name:'收起图纸',exact:true});if(await collapse.isVisible())await collapse.click();
  await page.locator('.react-flow__controls-fitview').click();
}
async function drag(page,locator,dx,dy,fraction={x:0.5,y:0.5}){
  const axis=dy?'y':'x',before=await locator.getAttribute(`data-world-${axis}`);
  const initial=await locator.boundingBox();await locator.hover({position:{x:initial.width*fraction.x,y:initial.height*fraction.y}});
  const box=await locator.boundingBox(),x=box.x+box.width*fraction.x,y=box.y+box.height*fraction.y;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:16});await page.mouse.up();
  if(before!==null&&(dx||dy))await expect.poll(()=>locator.getAttribute(`data-world-${axis}`)).not.toBe(before);
}
async function geometry(page){
  const wire=page.locator('.sim-wire');const values=await wire.evaluate(element=>({from:element.dataset.fromTerminal,to:element.dataset.toTerminal,a:JSON.parse(element.dataset.fromWorld),b:JSON.parse(element.dataset.toWorld),path:element.querySelector('.react-flow__edge-path').getAttribute('d')}));
  for(const [key,point] of [[values.from,values.a],[values.to,values.b]]){
    expect(await page.locator(`[data-terminal-key="${key}"]`).evaluate(e=>({x:Number(e.dataset.worldX),y:Number(e.dataset.worldY)}))).toEqual(point);
  }return values;
}
test('duct routing follows real drag, movement, resize, disconnect, save and reload',async({page})=>{
  await open(page);await page.getByLabel('线条样式',{exact:true}).selectOption('duct');
  const a=page.locator('[data-terminal-key="route-a::A"]'),b=page.locator('[data-terminal-key="route-b::A"]');await a.hover();await b.hover();const aa=await a.boundingBox(),bb=await b.boundingBox();
  await page.mouse.move(aa.x+aa.width/2,aa.y+aa.height/2);await page.mouse.down();await page.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2,{steps:20});await page.mouse.up();
  const wire=page.locator('.sim-wire');await expect(wire).toHaveCount(1);await expect(wire).toHaveAttribute('data-routing','duct');await expect(wire).toHaveAttribute('data-routing-status','routed');
  const first=await geometry(page);expect(first.path.split('L').length).toBeGreaterThan(2);
  await drag(page,page.locator('[data-device-id="route-b"]'),20,35);await expect.poll(()=>wire.getAttribute('data-to-world')).not.toBe(JSON.stringify(first.b));
  const moved=await geometry(page),viewport=page.locator('.react-flow__viewport'),beforeZoom=await viewport.getAttribute('style');await page.locator('.react-flow__controls-zoomout').click();await expect.poll(()=>viewport.getAttribute('style')).not.toBe(beforeZoom);expect(await geometry(page)).toEqual(moved);
  // The wire owns the duct center line; grab the visible upper part of the duct.
  // Open a horizontal gap while each terminal still has its own nearest duct.
  // Moving the right duct far downward can legitimately route both ends via the left duct.
  await drag(page,page.locator('[data-device-id="route-right"]'),60,0,{x:0.25,y:0.15});await expect(wire).toHaveAttribute('data-routing-status','disconnected');await expect(page.locator('.sim-routing-notice')).toContainText('未连通');await geometry(page);
  await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(wire).toHaveAttribute('data-routing-status','routed');expect(await geometry(page)).toEqual(moved);
  const left=page.locator('[data-device-id="route-left"]'),box=await left.boundingBox();await left.click({position:{x:box.width*0.25,y:box.height*0.15}});const resize=page.locator('[data-id="route-left"] .sim-duct-resize-handle.bottom.right');await expect(resize).toBeVisible();await drag(page,resize,24,16);
  await expect.poll(async()=>(await geometry(page)).path).not.toBe(moved.path);await expect(wire).toHaveAttribute('data-routing-status','routed');const resized=await geometry(page);
  const response=page.waitForResponse(r=>r.url().endsWith('/api/circuits')&&r.request().method()==='POST');await page.getByRole('button',{name:'保存草稿',exact:true}).click();expect((await response).status()).toBe(201);
  await page.reload();await expect(wire).toHaveAttribute('data-routing-status','routed');expect(await geometry(page)).toEqual(resized);
});
test('repeated group paste and undo preserve a stable editable document',async({page})=>{
  await open(page);await page.locator('[data-device-id="route-a"]').click();await page.locator('[data-device-id="route-b"]').click({modifiers:['Shift']});
  await page.getByRole('button',{name:'复制选中对象',exact:true}).focus();await page.keyboard.press('Control+c');
  for(let index=0;index<8;index++)await page.keyboard.press('Control+v');await expect(page.locator('[data-device-id]')).toHaveCount(20);
  for(let index=0;index<8;index++)await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('[data-device-id]')).toHaveCount(4);
  for(let index=0;index<8;index++)await page.getByRole('button',{name:'重做',exact:true}).click();await expect(page.locator('[data-device-id]')).toHaveCount(20);
  await page.getByRole('button',{name:'开始仿真',exact:true}).click();await expect(page.getByRole('button',{name:'粘贴对象',exact:true})).toBeDisabled();await page.getByRole('button',{name:'结束仿真',exact:true}).click();
});
