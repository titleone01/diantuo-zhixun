import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const fixture=JSON.parse(await readFile(process.env.DIANTUO_BROWSER_FIXTURE,'utf8'));
const ids=Array.from({length:10},(_,i)=>`motor-course-${String(i+1).padStart(2,'0')}`);
async function login(page){
  await page.goto('/');await page.getByLabel('账号',{exact:true}).fill(fixture.accounts[0].username);await page.getByLabel('密码',{exact:true}).fill(fixture.accounts[0].password);
  await page.getByRole('button',{name:'登录',exact:true}).click();await expect(page.getByRole('button',{name:'开始仿真',exact:true})).toBeVisible();
}
async function controls(page){const details=page.locator('.dt-document-disclosure');if(await details.getAttribute('open')===null)await details.locator('summary').click();}
async function exported(page){await page.getByRole('button',{name:'导出图纸到本地',exact:true}).click();const doc=JSON.parse(await page.getByLabel('导出的电路 JSON',{exact:true}).inputValue());await page.getByRole('button',{name:'关闭电路文件窗口',exact:true}).click();return doc;}
async function open(page,draft){
  await page.getByRole('link',{name:'个人中心',exact:true}).click();await page.getByRole('button',{name:'草稿箱',exact:true}).click();await page.getByLabel('每页草稿数量').selectOption('50');
  await page.getByRole('row').filter({has:page.getByText(draft.title,{exact:true})}).getByRole('button',{name:'编辑',exact:true}).click();await expect(page.locator('.sim-canvas-heading b')).toHaveText(draft.title);
}
async function catalog(page){
  await expect(page.locator('.dt-reference-card')).toHaveCount(10);await expect(page.getByRole('tab',{name:'工业控制',exact:true})).toHaveCount(0);await expect(page.getByRole('tab',{name:'课程项目',exact:true})).toHaveCount(0);
}
test('ten-course scope: member default, floating selector, demonstration and practice share the catalog',async({page})=>{
  await login(page);expect((await exported(page)).lessonId).toBe(ids[0]);await controls(page);
  expect(await page.getByLabel('选择训练课程',{exact:true}).locator('option').evaluateAll(items=>items.map(item=>item.value))).toEqual(['',...ids]);
  await page.getByRole('button',{name:'选择图纸',exact:true}).click();await catalog(page);
  await page.locator('.dt-reference-card').nth(5).click();await page.getByRole('button',{name:'查看示范接线',exact:true}).click();await expect(page.getByRole('button',{name:'开始仿真',exact:true})).toBeVisible();
  let doc=await exported(page);expect(doc.lessonId).toBe(ids[5]);expect(doc.wires.length).toBeGreaterThan(0);
  await page.getByRole('button',{name:'选择图纸',exact:true}).click();await catalog(page);await page.locator('.dt-reference-card').nth(8).click();await page.getByRole('button',{name:'进入电路配置',exact:true}).click();await page.getByRole('button',{name:'创建练习',exact:true}).click();
  doc=await exported(page);expect(doc.lessonId).toBe(ids[8]);expect(doc.wires).toEqual([]);expect(doc.components.some(c=>c.label==='SB3')).toBe(false);
});
for(const id of ['motor-jog','motor-self-hold','lighting-single','lighting-two-way'])test(`ten-course scope: historical ${id} retains exact document, assessment, save and retired-link recovery`,async({page})=>{
  await login(page);const draft=fixture.drafts[`legacy:${id}`];await open(page,draft);await expect(page.getByText('历史练习 · 已有接线和图纸保留，可继续编辑与保存。',{exact:true})).toBeVisible();
  expect(await exported(page)).toEqual(draft.document);await controls(page);const select=page.getByLabel('选择训练课程',{exact:true});await expect(select).toHaveValue(id);await expect(select.locator(`option[value="${id}"]`)).toBeDisabled();
  await expect(page.getByRole('button',{name:'清空接线练习',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'载入示范接线',exact:true})).toBeDisabled();
  const assess=await page.request.post('/api/assess',{headers:{origin:new URL(page.url()).origin},data:{document:draft.document,lessonId:id}});expect(assess.status()).toBe(200);expect((await assess.json()).assessment.status).toBe('passed');
  const changed={...draft.document,title:`${draft.title} preserved`};await page.getByLabel('电路标题',{exact:true}).fill(changed.title);
  const saving=page.waitForResponse(r=>r.url().endsWith(`/api/circuits/${draft.id}`)&&r.request().method()==='PUT');await page.getByRole('button',{name:'保存草稿',exact:true}).click();expect((await saving).status()).toBe(200);
  await page.goto('/circuit?diagram=32');await expect(page.getByRole('button',{name:'开始仿真',exact:true})).toBeVisible();await expect(page.getByText(/原站参考图的新建入口已停用/)).toBeVisible();expect(await exported(page)).toEqual(changed);
  const readback=await page.request.get(`/api/circuits/${draft.id}`);expect((await readback.json()).circuit.document).toEqual(changed);
});
test('ten-course scope: built Pages provides ten practices and examples without private API requests',async({page})=>{
  test.skip(!process.env.DIANTUO_STATIC_URL,'No built Pages fixture');const calls=[];page.on('request',r=>{if(new URL(r.url()).pathname.includes('/api/'))calls.push(r.url());});
  await page.goto(process.env.DIANTUO_STATIC_URL);await expect(page.getByRole('button',{name:'开始仿真',exact:true})).toBeVisible();expect((await exported(page)).lessonId).toBe(ids[0]);
  await controls(page);expect(await page.getByLabel('选择训练课程',{exact:true}).locator('option').evaluateAll(items=>items.map(item=>item.value))).toEqual(['',...ids]);
  await page.getByRole('button',{name:'选择图纸',exact:true}).click();await catalog(page);await expect(page.getByText('静态演示支持十课接线练习和示范。课程原图需登录成员站查看。',{exact:true})).toBeVisible();
  await page.locator('.dt-reference-card').nth(5).click();await expect(page.getByText('课程原图需登录成员站查看',{exact:true})).toBeVisible();await page.getByRole('button',{name:'查看示范接线',exact:true}).click();expect((await exported(page)).lessonId).toBe(ids[5]);
  await page.getByRole('button',{name:'选择图纸',exact:true}).click();await page.locator('.dt-reference-card').last().click();await page.getByRole('button',{name:'进入电路配置',exact:true}).click();await page.getByRole('button',{name:'创建练习',exact:true}).click();expect((await exported(page)).wires).toEqual([]);
  const before=await exported(page);await page.reload();await expect(page.getByRole('button',{name:'开始仿真',exact:true})).toBeVisible();expect(await exported(page)).toEqual(before);expect(calls).toEqual([]);
});
