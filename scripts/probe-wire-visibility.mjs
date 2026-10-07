import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { createFixture } from './isolated-fixture.mjs';
import { TestClient } from './test-fixtures.mjs';

const release = process.argv[2];
if (!release) throw new Error('Pass an immutable release directory');
const output = path.resolve('.local/terminal-wiring-20261007/visibility', process.argv[3] || 'baseline');
await mkdir(output, { recursive: true });
const fixture = await createFixture({ release });
let browser;
try {
  const account = JSON.parse(await readFile(fixture.adminFile, 'utf8'));
  const client = new TestClient(fixture.origin); await client.login(account);
  let document = { schemaVersion: 1, title: 'Visibility probe', components: [
    { id:'source',type:'supply',label:'电源',position:{x:30,y:20} },
    { id:'a',type:'terminal',label:'A',position:{x:400,y:57.3765} },
    { id:'b',type:'terminal',label:'B',position:{x:165.62725,y:260} },
  ], wires: [
    { id:'horizontal',from:{componentId:'source',terminalId:'L1'},to:{componentId:'a',terminalId:'A'},color:'#e7b000',style:'straight' },
    { id:'vertical',from:{componentId:'source',terminalId:'N'},to:{componentId:'b',terminalId:'A'},color:'#3478f6',style:'straight' },
  ]};
  if (process.argv[4]) {
    const source = path.resolve(process.argv[5] === 'current' ? 'app/simulator/core/lessons.ts' : '.local/terminal-wiring-20261007/baseline-source/app/simulator/core/lessons.ts');
    const bundled = await build({entryPoints:[source],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
    const {createLessonDocument} = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
    document = {...createLessonDocument(process.argv[4],{wired:true}),title:'Visibility probe'};
  }
  assert.equal((await client.call('/circuits','POST',{title:document.title,document})).status,201);
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1500,height:1000}});
  await page.goto(fixture.origin);
  await page.getByLabel('账号',{exact:true}).fill(account.username);
  await page.getByLabel('密码',{exact:true}).fill(account.password);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('link',{name:'个人中心',exact:true}).click();
  await page.getByRole('button',{name:'草稿箱',exact:true}).click();
  await page.getByRole('row').filter({has:page.getByText('Visibility probe',{exact:true})}).getByRole('button',{name:'编辑',exact:true}).click();
  const collapse=page.getByRole('button',{name:'收起图纸',exact:true});if(await collapse.isVisible())await collapse.click();
  await page.locator('.react-flow__controls-fitview').click();
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.wireObservations = [];
    const sample = () => {
      const count = document.querySelectorAll('.sim-wire').length;
      const previous = window.wireObservations.at(-1);
      if (!previous || previous.count !== count) window.wireObservations.push({ time:performance.now(),count,nodes:document.querySelectorAll('.react-flow__node').length,hiddenNodes:[...document.querySelectorAll('.react-flow__node')].filter(n=>getComputedStyle(n).visibility==='hidden').length });
    };
    new MutationObserver(sample).observe(document.querySelector('.react-flow'), {childList:true,subtree:true,attributes:true});
    sample();
  });
  const capture = async name => {
    await page.waitForTimeout(600);
    await page.screenshot({path:path.join(output,`${name}.png`)});
    return page.locator('.sim-wire').evaluateAll(elements => elements.map(element => {
      const p=element.querySelector('.react-flow__edge-path'),s=getComputedStyle(p),b=p.getBBox();
      const parents=[];for(let a=p.parentElement;a && parents.length<6;a=a.parentElement){const cs=getComputedStyle(a),r=a.getBoundingClientRect();parents.push({tag:a.tagName,class:a.getAttribute('class'),display:cs.display,overflow:cs.overflow,filter:cs.filter,width:r.width,height:r.height});}
      return {id:element.dataset.wireId,energized:element.classList.contains('is-energized'),d:p.getAttribute('d'),bbox:{x:b.x,y:b.y,width:b.width,height:b.height},filter:s.filter,stroke:s.stroke,opacity:s.opacity,visibility:s.visibility,parents};
    }));
  };
  const before=await capture('before');
  await page.getByRole('button',{name:'开始仿真',exact:true}).click();
  const running=await capture('running');
  let closed;
  const breaker=document.roles?.qf;
  if(breaker){await page.locator(`[data-device-id="${breaker}"] .sim-toggle-actuator`).click();closed=await capture('closed');}
  for(let cycle=0;cycle<Number(process.argv[6] ?? 0);cycle++){
    await page.getByRole('button',{name:'结束仿真',exact:true}).click();
    await page.getByRole('button',{name:'开始仿真',exact:true}).click();
    if(breaker)await page.locator(`[data-device-id="${breaker}"] .sim-toggle-actuator`).click();
    await page.waitForTimeout(250);
  }
  const observations=await page.evaluate(()=>window.wireObservations);
  await page.addStyleTag({content:'.sim-wire .react-flow__edge-path {filter:none!important}'});
  await capture('no-filter');
  await page.addStyleTag({content:'.react-flow__edge {pointer-events:all!important}'});
  await capture('pointer');
  await page.addStyleTag({content:'.react-flow__edges svg {overflow:visible!important}'});
  await capture('overflow');
  await writeFile(path.join(output,'probe.json'),JSON.stringify({before,running,closed,observations},null,2));
  console.log(JSON.stringify({output,wireCount:before.length,pathsUnchanged:before.every((wire,i)=>wire.d===running[i].d),filteredAfterStart:running.filter(w=>w.filter!=='none').length,zeroWireObservations:observations.filter(o=>o.count===0).length,minimumWireCount:Math.min(...observations.map(o=>o.count))}));
} finally { await browser?.close(); await fixture.stop(); }
