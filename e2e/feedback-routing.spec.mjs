import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
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
async function clearDuctPoint(locator) {
  // Pick a genuinely exposed part of the duct, regardless of the wire ID's lane.
  // Normal hover/click still verifies the hit; no forced pointer actions.
  return locator.evaluate(element => {
    const box=element.getBoundingClientRect();
    for(const y of [0.02,0.98,0.2,0.8])for(const x of [0.25,0.5,0.75]){
      const hit=document.elementFromPoint(box.x+box.width*x,box.y+box.height*y);
      if(hit&&element.contains(hit))return {x,y};
    }
    throw new Error('The duct has no exposed drag point');
  });
}
async function geometry(page){
  const wire=page.locator('.sim-wire');const values=await wire.evaluate(element=>({from:element.dataset.fromTerminal,to:element.dataset.toTerminal,a:JSON.parse(element.dataset.fromWorld),b:JSON.parse(element.dataset.toWorld),path:element.querySelector('.react-flow__edge-path').getAttribute('d')}));
  for(const [key,point] of [[values.from,values.a],[values.to,values.b]]){
    expect(await page.locator(`[data-terminal-key="${key}"]`).evaluate(e=>({x:Number(e.dataset.worldX),y:Number(e.dataset.worldY)}))).toEqual(point);
  }
  const points=[...values.path.matchAll(/[ML]\s*([\d.e+-]+)[, ]+([\d.e+-]+)/g)].map(match=>({x:Number(match[1]),y:Number(match[2])}));
  expect(points.length).toBeGreaterThanOrEqual(2);
  for(let i=1;i+1<points.length;i++){
    const a=points[i-1],b=points[i],c=points[i+1];
    expect((a.x===b.x&&b.x===c.x&&(b.y-a.y)*(c.y-b.y)<0)||(a.y===b.y&&b.y===c.y&&(b.x-a.x)*(c.x-b.x)<0),'rendered path must not fold back at a duct entrance').toBe(false);
  }
  return values;
}
test('duct routing follows real drag, movement, resize, disconnect, save and reload',async({page})=>{
  await test.step('routing: open and import',async()=>{await open(page);await page.getByLabel('线条样式',{exact:true}).selectOption('duct');});
  await test.step('routing: connect terminals',async()=>{
  const a=page.locator('[data-terminal-key="route-a::A"]'),b=page.locator('[data-terminal-key="route-b::A"]');await a.hover();await b.hover();const aa=await a.boundingBox(),bb=await b.boundingBox();
  await page.mouse.move(aa.x+aa.width/2,aa.y+aa.height/2);await page.mouse.down();await page.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2,{steps:20});await page.mouse.up();
  const wire=page.locator('.sim-wire');await expect(wire).toHaveCount(1);await expect(wire).toHaveAttribute('data-routing','duct');await expect(wire).toHaveAttribute('data-routing-status','routed');
  });
  const wire=page.locator('.sim-wire');
  const first=await geometry(page);expect(first.path.split('L').length).toBeGreaterThan(2);
  await test.step('routing: move terminal',async()=>{await drag(page,page.locator('[data-device-id="route-b"]'),20,35);await expect.poll(()=>wire.getAttribute('data-to-world')).not.toBe(JSON.stringify(first.b));});
  const moved=await geometry(page),viewport=page.locator('.react-flow__viewport'),beforeZoom=await viewport.getAttribute('style');
  await test.step('routing: zoom and preserve geometry',async()=>{await page.locator('.react-flow__controls-zoomout').click();await expect.poll(()=>viewport.getAttribute('style')).not.toBe(beforeZoom);expect(await geometry(page)).toEqual(moved);});
  // Stable parallel lanes can occupy either side of the center.
  // Grab an exposed area and require a real pointer hit on the duct.
  // Open a horizontal gap while each terminal still has its own nearest duct.
  // Moving the right duct far downward can legitimately route both ends via the left duct.
  await test.step('routing: disconnect duct',async()=>{const right=page.locator('[data-device-id="route-right"]');await drag(page,right,60,0,await clearDuctPoint(right));await expect(wire).toHaveAttribute('data-routing-status','disconnected');await expect(page.locator('.sim-routing-notice')).toContainText('未连通');await geometry(page);});
  await test.step('routing: undo disconnection',async()=>{await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(wire).toHaveAttribute('data-routing-status','routed');expect(await geometry(page)).toEqual(moved);});
  await test.step('routing: resize duct',async()=>{
  const left=page.locator('[data-device-id="route-left"]'),box=await left.boundingBox(),point=await clearDuctPoint(left);await left.click({position:{x:box.width*point.x,y:box.height*point.y}});const resize=page.locator('[data-id="route-left"] .sim-duct-resize-handle.bottom.right');await expect(resize).toBeVisible();await drag(page,resize,24,16);
  await expect.poll(async()=>(await geometry(page)).path).not.toBe(moved.path);await expect(wire).toHaveAttribute('data-routing-status','routed');
  });
  const resized=await geometry(page);
  await test.step('routing: save new draft',async()=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/circuits')&&r.request().method()==='POST');await page.getByRole('button',{name:'保存草稿',exact:true}).click();const saved=await response;expect(saved.status()).toBe(201);expect((await saved.json()).circuit.document.wires[0]).toMatchObject({style:'orthogonal',routing:'duct'});});
  await test.step('routing: reload saved geometry',async()=>{await page.reload();await expect(wire).toHaveAttribute('data-routing-status','routed');expect(await geometry(page)).toEqual(resized);});
});

test('motor-course-02: top and bottom duct entrances render without foldbacks',async({page})=>{
  await open(page);
  const document=fixture.drafts['motor-course-02:correct'].document;
  await page.getByRole('button',{name:'导入本地保存的图纸',exact:true}).click();
  await page.getByLabel('待导入的电路 JSON',{exact:true}).fill(JSON.stringify(document));
  await page.getByRole('button',{name:'导入粘贴内容',exact:true}).click();
  await expect(page.locator('.sim-wire')).toHaveCount(document.wires.length);
  for(const wire of await page.locator('.sim-wire').all()){
    await expect(wire).toHaveAttribute('data-routing-status','routed');
    const points=await wire.evaluate(element=>[...element.querySelector('.react-flow__edge-path').getAttribute('d').matchAll(/[ML]\s*([\d.e+-]+)[, ]+([\d.e+-]+)/g)].map(match=>({x:Number(match[1]),y:Number(match[2])})));
    expect(points.length).toBeGreaterThanOrEqual(2);
    for(let i=1;i+1<points.length;i++){
      const a=points[i-1],b=points[i],c=points[i+1];
      expect((a.x===b.x&&b.x===c.x&&(b.y-a.y)*(c.y-b.y)<0)||(a.y===b.y&&b.y===c.y&&(b.x-a.x)*(c.x-b.x)<0)).toBe(false);
    }
  }
  await page.locator('.react-flow__controls-fitview').click();
  // Hover waits for the animated fit to settle before recording the canvas.
  await page.locator('[data-device-id="qf"]').hover();
  await mkdir('.local/acceptance-public',{recursive:true});
  await page.locator('.react-flow').screenshot({path:'.local/acceptance-public/duct-entry-fixed.png'});
});

test('exterior motor leads stay separated after real terminal drag, motor movement, zoom and reload',async({page})=>{
  await open(page);
  const document=structuredClone(fixture.drafts['motor-course-09:correct'].document);
  document.wires=document.wires.filter(w=>!(w.to.componentId==='m'&&w.to.terminalId==='U1'));
  await page.getByRole('button',{name:'导入本地保存的图纸',exact:true}).click();
  await page.getByLabel('待导入的电路 JSON',{exact:true}).fill(JSON.stringify(document));
  await page.getByRole('button',{name:'导入粘贴内容',exact:true}).click();
  const disclosure=page.locator('.dt-document-disclosure');if(await disclosure.getAttribute('open')!==null)await disclosure.locator('summary').click();
  await page.getByLabel('线条样式',{exact:true}).selectOption('duct');
  await page.locator('.react-flow__controls-fitview').click();
  const a=page.locator('[data-terminal-key="xt16::B4"]'),b=page.locator('[data-terminal-key="m::U1"]');
  await a.hover();await b.hover();const aa=await a.boundingBox(),bb=await b.boundingBox();
  await page.mouse.move(aa.x+aa.width/2,aa.y+aa.height/2);await page.mouse.down();await page.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2,{steps:20});await page.mouse.up();
  await expect(page.locator('.sim-wire')).toHaveCount(document.wires.length+1);
  async function motorGeometry(){
    const values=await page.locator('.sim-wire').evaluateAll(elements=>elements.filter(e=>e.dataset.toTerminal.startsWith('m::')).map(e=>({
      to:e.dataset.toTerminal,status:e.dataset.routingStatus,a:JSON.parse(e.dataset.fromWorld),b:JSON.parse(e.dataset.toWorld),from:e.dataset.fromTerminal,
      points:[...e.querySelector('.react-flow__edge-path').getAttribute('d').matchAll(/[ML]\s*([\d.e+-]+)[, ]+([\d.e+-]+)/g)].map(m=>({x:Number(m[1]),y:Number(m[2])}))
    })));
    const edge=Math.max(...document.components.filter(c=>c.type.startsWith('wire-duct')).map(c=>c.position.y+c.size.height));
    for(const v of values){
      expect(v.status).toBe('routed');expect(v.points[0]).toEqual(v.a);expect(v.points.at(-1)).toEqual(v.b);
      for(const [key,point] of [[v.from,v.a],[v.to,v.b]])expect(await page.locator(`[data-terminal-key="${key}"]`).evaluate(e=>({x:Number(e.dataset.worldX),y:Number(e.dataset.worldY)}))).toEqual(point);
    }
    for(const [group,ids] of [['upper',['U1','V1','W1']],['lower',['U2','V2','W2']]]){
      const tails=ids.map(id=>values.find(v=>v.to===`m::${id}`).points).map(points=>points.slice(1).map((b,i)=>[points[i],b]).filter(([a,b])=>Math.max(a.y,b.y)>edge).map(([a,b])=>[a.y<=edge?{x:a.x,y:edge}:a,b.y<=edge?{x:b.x,y:edge}:b]));
      let crossings=0;
      for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)for(const [a,b] of tails[i])for(const [c,d] of tails[j]){
        const touches=Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))&&Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))<=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y));
        if(touches){crossings++;expect(a.x===b.x,'phase tails must never share parallel lengths').not.toBe(c.x===d.x);}
      }
      // Fixed B7/8/9 -> U2/V2/W2 outputs and motor lower screws face down
      // in the same order: bypassing the body permits isolated perpendicular
      // crossings. They are not electrical junctions. Facing upper screws
      // have no such constraint and must remain fully separated.
      expect(crossings).toBeLessThanOrEqual(group==='upper'?0:3);
      if(group==='lower')expect(ids.map(id=>values.find(v=>v.to===`m::${id}`).from)).toEqual(['xt16::B7','xt16::B8','xt16::B9']);
    }
    return values;
  }
  const before=await motorGeometry();
  await drag(page,page.locator('[data-device-id="m"]'),20,15,{x:0.45,y:0.65});
  const moved=await motorGeometry();expect(moved).not.toEqual(before);
  await page.locator('.react-flow__controls-zoomout').click();expect(await motorGeometry()).toEqual(moved);
  const response=page.waitForResponse(r=>r.url().endsWith('/api/circuits')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();expect((await response).status()).toBe(201);
  await page.reload();await expect(page.locator('.sim-wire')).toHaveCount(document.wires.length+1);expect(await motorGeometry()).toEqual(moved);
  await page.locator('.react-flow__controls-fitview').click();await page.locator('[data-device-id="m"]').hover();
  await mkdir('.local/acceptance-public',{recursive:true});await page.locator('.react-flow').screenshot({path:'.local/acceptance-public/exterior-motor-leads-fixed.png'});
});
test('repeated group paste and undo preserve a stable editable document',async({page})=>{
  await open(page);await page.locator('[data-device-id="route-a"]').click();await page.locator('[data-device-id="route-b"]').click({modifiers:['Shift']});
  await page.getByRole('button',{name:'复制选中对象',exact:true}).focus();await page.keyboard.press('Control+c');
  for(let index=0;index<8;index++)await page.keyboard.press('Control+v');await expect(page.locator('[data-device-id]')).toHaveCount(20);
  for(let index=0;index<8;index++)await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(page.locator('[data-device-id]')).toHaveCount(4);
  for(let index=0;index<8;index++)await page.getByRole('button',{name:'重做',exact:true}).click();await expect(page.locator('[data-device-id]')).toHaveCount(20);
  await page.getByRole('button',{name:'开始仿真',exact:true}).click();await expect(page.getByRole('button',{name:'粘贴对象',exact:true})).toBeDisabled();await page.getByRole('button',{name:'结束仿真',exact:true}).click();
});
