import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundled = await build({
  stdin: { contents: 'export { createSimulationSession } from "./simulation-session"; export { default as DeviceNode } from "./DeviceNode"; export { createLessonDocument } from "../core/lessons";', resolveDir: fileURLToPath(new URL("../app/simulator/editor/", import.meta.url)) },
  bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent", define: { "import.meta.env.BASE_URL": '"/"' }, loader: { ".css": "empty" },
  plugins: [{ name: "node-ui-handles", setup(build) {
    // React Flow's DOM handle is outside this test; DeviceNode's real pointer/keyboard callbacks remain intact.
    build.onResolve({ filter: /^react$/ }, () => ({ path: "hooks", namespace: "test-react" }));
    build.onLoad({ filter: /.*/, namespace: "test-react" }, () => ({ contents: 'export const useRef=value=>({current:value}),useCallback=value=>value;' }));
    build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: "jsx", namespace: "test-jsx" }));
    build.onLoad({ filter: /.*/, namespace: "test-jsx" }, () => ({ contents: 'export const Fragment=Symbol.for("react.fragment"),jsx=(type,props,key)=>({type,props,key}),jsxs=jsx;' }));
    build.onResolve({ filter: /^@xyflow\/react$/ }, () => ({ path: "handles", namespace: "test-flow" }));
    build.onLoad({ filter: /.*/, namespace: "test-flow" }, () => ({ contents: 'export const Position={Top:"top",Bottom:"bottom",Left:"left",Right:"right"};export function Handle(){return null;}export function NodeResizer(){return null;}', loader: "js" }));
  } }],
});
const { createSimulationSession, DeviceNode, createLessonDocument } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

function controls(document, session) {
  const generation = session.generation;
  // Deliberately keep the initial rendered props: rapid events need not wait for a React render.
  const initial = session.current;
  return Object.fromEntries(document.components.map(component => {
    const element = DeviceNode({ selected: false, data: { component, running: true, runtime: initial.runtime, result: initial.components[component.id], terminalStates: initial.terminals, diagnostics: [], action: action => session.dispatch(action, generation), readOnly: false, linkedComponents: [], configure() {} } });
    const button = element.props.children.flat().find(child => child?.type === "button");
    return [component.id, button?.props];
  }));
}
const pointer = () => ({ pointerId: 1, preventDefault() {}, currentTarget: { setPointerCapture() {} } });
function tap(button) { button.onPointerDown(pointer()); button.onPointerUp(pointer()); }

test("editor: course 06 rapid real pointer callbacks retain every transition before rendering", () => {
  const document = createLessonDocument("motor-course-06", { wired: true });
  const session = createSimulationSession(); session.start(document);
  const buttons = controls(document, session);
  buttons.qf.onClick();
  tap(buttons.sb1); assert.equal(session.current.components.m.direction, "forward");
  tap(buttons.sq1); assert.equal(session.current.components.m.direction, "reverse");
  tap(buttons.sq2); assert.equal(session.current.components.m.direction, "forward");
  tap(buttons.sq3); assert.equal(session.current.components.m.state, "stopped");
  // Browsers may emit lost-capture/cancel/blur after pointerup; none may restore the old latch.
  buttons.sq3.onLostPointerCapture(); buttons.sq3.onPointerCancel(); buttons.sq3.onBlur();
  assert.equal(session.current.components.m.state, "stopped");
  assert.equal(session.current.runtime.contactors.km1, false);
  assert.equal(session.current.runtime.contactors.km2, false);
  const stopPress = session.trace.find(event => event.action.type === "press" && event.action.componentId === "sq3");
  assert.deepEqual(stopPress.pressed, ["sq3"]);
  assert.equal(stopPress.motors.m.state, "stopped");
  assert.equal(session.trace.at(-1).motors.m.state, "stopped");
});

test("editor: trace distinguishes a still-held reversing limit from a completed tap without forcing a stop", () => {
  const document = createLessonDocument("motor-course-06", { wired: true });
  const session = createSimulationSession(); session.start(document);
  const buttons = controls(document, session);
  buttons.qf.onClick(); tap(buttons.sb1); tap(buttons.sq1);
  buttons.sq2.onPointerDown(pointer());
  tap(buttons.sq3);
  // If an input release really arrives late, the active NO is a real restart feed.
  // Preserve that electrical result and expose the ordering for browser diagnosis.
  assert.deepEqual(session.trace.at(-1).pressed, ["sq2"]);
  assert.equal(session.trace.at(-1).motors.m.direction, "forward");
  buttons.sq2.onPointerUp(pointer());
  assert.deepEqual(session.trace.at(-1).pressed, []);
  assert.equal(session.current.components.m.state, "running");
});

test("editor: keyboard release and blur release use the latest held-button state", () => {
  const document = createLessonDocument("motor-course-06", { wired: true });
  const session = createSimulationSession(); session.start(document);
  const buttons = controls(document, session); buttons.qf.onClick(); tap(buttons.sb1);
  buttons.sq3.onKeyDown({ key: " ", repeat: false, preventDefault() {} });
  assert.equal(session.current.components.m.state, "stopped");
  buttons.sq3.onKeyUp({ key: " ", preventDefault() {} });
  assert.equal(session.current.components.m.state, "stopped");
  tap(buttons.sb1); buttons.sq3.onPointerDown(pointer()); buttons.sq3.onBlur();
  assert.equal(session.current.runtime.pressed.sq3, false);
  assert.equal(session.current.components.m.state, "stopped");
});

test("editor: late pointer releases or clock ticks cannot change a stopped or replaced session", () => {
  const document = createLessonDocument("motor-course-06", { wired: true });
  const session = createSimulationSession(); session.start(document);
  const old = controls(document, session); const oldGeneration = session.generation;
  session.clear(); old.sq3.onPointerUp(pointer());
  assert.equal(session.current, null);
  assert.equal(session.dispatch({ type: "advance-time", ms: 100 }, oldGeneration), null);
  session.start(document); const fresh = controls(document, session);
  fresh.qf.onClick(); tap(fresh.sb1); fresh.sq3.onPointerDown(pointer());
  old.sq3.onPointerUp(pointer());
  assert.equal(session.current.runtime.pressed.sq3, true);
  assert.equal(session.current.components.m.state, "stopped");
  fresh.sq3.onPointerUp(pointer()); assert.equal(session.current.runtime.pressed.sq3, false);
});
