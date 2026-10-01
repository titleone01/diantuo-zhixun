import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Run the actual form callbacks without a DOM or network. Renders are explicit,
// so duplicate submits also exercise the interval before React renders busy=true.
const hooks = `let slots=[],cursor=0,effects=[];
export function reset(){unmount();slots=[];cursor=0;effects=[];}
export function begin(){cursor=0;}
export function flush(){for(const run of effects.splice(0))run();}
export function unmount(){for(const slot of slots)slot?.cleanup?.();}
export function useState(initial){const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,next=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;}];}
export function useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});}
export function useId(){return useRef('password-test').current;}
export function useEffect(effect,deps){const i=cursor++;const old=slots[i];if(!old||deps.some((value,index)=>value!==old.deps[index])){slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=effect();});}}`;
const bundled = await build({
  stdin: { contents: 'export {default as ChangePassword} from "./ChangePassword"; export * from "./change-password"; export {reset,begin,flush,unmount} from "react";', resolveDir: fileURLToPath(new URL('../app/simulator/profile/', import.meta.url)) },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent', loader: { '.css': 'empty' },
  plugins: [{ name: 'password-form-hooks', setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: 'react-hooks', namespace: 'test-password' }));
    build.onLoad({ filter: /react-hooks/, namespace: 'test-password' }, () => ({ contents: hooks }));
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: 'jsx', namespace: 'test-password' }));
    build.onLoad({ filter: /jsx/, namespace: 'test-password' }, () => ({ contents: 'export const Fragment=Symbol.for("react.fragment");export const jsx=(type,props)=>({type,props});export const jsxs=jsx;' }));
    build.onResolve({ filter: /^lucide-react$/ }, () => ({ path: 'icons', namespace: 'test-password' }));
    build.onLoad({ filter: /icons/, namespace: 'test-password' }, () => ({ contents: 'export const KeyRound=()=>null;export const X=()=>null;' }));
  } }],
});
const { ChangePassword, validatePasswordChange, passwordChangeError, reset, begin, flush, unmount } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const fixture = () => ({ currentPassword: 'old-demo-value', newPassword: 'new-demo-value', confirmation: 'new-demo-value' });
const event = () => ({ preventDefault() {} });
function all(element, predicate) {
  if (!element || typeof element !== 'object') return [];
  if (Array.isArray(element)) return element.flatMap(child => all(child, predicate));
  return [...(predicate(element) ? [element] : []), ...all(element.props?.children, predicate)];
}
function text(element) {
  if (Array.isArray(element)) return element.map(text).join('');
  if (typeof element === 'string') return element;
  return element?.props ? text(element.props.children) : '';
}
function mount(request, onChanged = () => {}) {
  reset();
  let tree;
  const render = () => { begin(); tree = ChangePassword({ request, onChanged }); flush(); return tree; };
  const find = predicate => all(tree, predicate)[0];
  const button = label => find(node => node.type === 'button' && text(node) === label);
  const input = suffix => find(node => node.type === 'input' && node.props.id?.endsWith(`-${suffix}`));
  const open = () => { button('修改密码').props.onClick(); render(); };
  const fill = (values = fixture()) => {
    for (const [suffix, value] of [['current', values.currentPassword], ['new', values.newPassword], ['confirmation', values.confirmation]]) {
      input(suffix).props.onChange({ target: { value } }); render();
    }
  };
  render();
  return { render, find, button, input, open, fill, submit: () => find(node => node.type === 'form').props.onSubmit(event()), alert: () => text(find(node => node.props?.role === 'alert')), tree: () => tree };
}

test('password form enforces the current 12–128 policy and matching confirmation before any request', async () => {
  const valid = fixture();
  assert.equal(validatePasswordChange(valid), null);
  assert.ok(validatePasswordChange({ ...valid, newPassword: 'x'.repeat(11), confirmation: 'x'.repeat(11) }));
  assert.equal(validatePasswordChange({ ...valid, newPassword: 'x'.repeat(12), confirmation: 'x'.repeat(12) }), null);
  assert.equal(validatePasswordChange({ ...valid, newPassword: 'x'.repeat(128), confirmation: 'x'.repeat(128) }), null);
  assert.ok(validatePasswordChange({ ...valid, newPassword: 'x'.repeat(129), confirmation: 'x'.repeat(129) }));
  assert.equal(validatePasswordChange({ ...valid, currentPassword: 'legacy' }), null, 'old accounts may have a shorter current password');
  let calls = 0;
  const ui = mount(async () => { calls++; }); ui.open();
  await ui.submit(); ui.render(); assert.equal(ui.alert(), '请输入当前密码');
  ui.fill({ ...valid, confirmation: 'does-not-match' });
  await ui.submit(); ui.render(); assert.equal(ui.alert(), '两次输入的新密码不一致'); assert.equal(calls, 0);
});

test('password form sends the verified API schema once, locks pending controls, and clears values after success', async () => {
  let resolve, calls = 0, changes = 0;
  const ui = mount((path, init) => {
    calls++;
    assert.equal(path, '/auth/change-password'); assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body), values = fixture();
    assert.equal(body.currentPassword === values.currentPassword && body.newPassword === values.newPassword, true);
    assert.deepEqual(Object.keys(body).sort(), ['currentPassword', 'newPassword', 'revokeOtherSessions']);
    assert.equal(body.revokeOtherSessions, true);
    return new Promise(done => { resolve = done; });
  }, () => { changes++; });
  ui.open(); ui.fill(); const pending = ui.submit(); await ui.submit();
  assert.equal(calls, 1, 'duplicate events before a re-render cannot send twice'); ui.render();
  assert.equal(ui.find(node => node.type === 'form').props['aria-busy'], true);
  assert.equal(all(ui.tree(), node => node.type === 'input').every(node => node.props.disabled), true);
  ui.button('取消').props.onClick(); ui.render(); assert.ok(ui.find(node => node.props?.role === 'dialog'));
  resolve({}); await pending; ui.render(); assert.equal(changes, 1); assert.equal(ui.find(node => node.props?.role === 'dialog'), undefined);
  ui.open(); for (const field of ['current', 'new', 'confirmation']) assert.equal(ui.input(field).props.value.length, 0);
});

test('wrong-current-password feedback stays in the dialog, clears only the current value and supports retry', async () => {
  let calls = 0;
  const ui = mount(async () => { if (++calls === 1) throw { code: 'INVALID_PASSWORD', status: 400 }; });
  ui.open(); ui.fill(); await ui.submit(); ui.render();
  assert.equal(ui.alert(), '当前密码不正确，请重新输入');
  assert.equal(ui.input('current').props.value.length, 0); assert.equal(ui.input('new').props.value.length > 0, true);
  assert.equal(ui.button('确认修改').props.disabled, false);
  ui.fill(); await ui.submit(); ui.render(); assert.equal(calls, 2); assert.equal(ui.find(node => node.props?.role === 'dialog'), undefined);
});

test('password API errors are localized without reflecting arbitrary auth payloads', () => {
  assert.equal(passwordChangeError({ code: 'UNAUTHORIZED', status: 401 }), '登录已过期，请重新登录后修改密码');
  assert.equal(passwordChangeError({ code: 'PASSWORD_TOO_SHORT' }), '新密码须为 12–128 个字符');
  assert.equal(passwordChangeError({ code: 'PASSWORD_TOO_LONG' }), '新密码须为 12–128 个字符');
  assert.equal(passwordChangeError({ status: 429 }), '操作过于频繁，请稍后再试');
  assert.equal(passwordChangeError(new TypeError('Failed to fetch')), '网络连接失败，请检查连接后重试');
  assert.equal(passwordChangeError(new Error('arbitrary server details')), '修改密码失败，请稍后重试');
});

test('cancel clears all fields and the session-revocation checkbox is reflected in the request', async () => {
  let revoke;
  const ui = mount(async (_path, init) => { revoke = JSON.parse(init.body).revokeOtherSessions; });
  ui.open(); ui.fill(); ui.button('取消').props.onClick(); ui.render(); ui.open();
  for (const field of ['current', 'new', 'confirmation']) assert.equal(ui.input(field).props.value.length, 0);
  ui.fill(); ui.find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: false } }); ui.render();
  await ui.submit(); assert.equal(revoke, false);
});

test('a pending password request cannot show a success message after its profile unmounts', async () => {
  let resolve, changes = 0;
  const ui = mount(() => new Promise(done => { resolve = done; }), () => { changes++; });
  ui.open(); ui.fill(); const pending = ui.submit(); unmount(); resolve({}); await pending;
  assert.equal(changes, 0);
});
