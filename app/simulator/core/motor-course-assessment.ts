import { getDefinition, equivalentComponentType } from "./catalog";
import { createMotorCourseDocument } from "./motor-courses";
import { buildCircuitNetwork, initialRuntime, networkVoltage, simulate } from "./engine";
import { terminalKey } from "./types";
import type { CircuitDocument, ComponentRuntime, Diagnostic, LessonAssessment, LessonCheck, LessonTrace, SimulationAction, SimulationResult } from "./types";
import { validateDocument } from "./validation";

const key = (componentId: string, terminalId: string) => terminalKey({ componentId, terminalId });
const phase = (value: string) => ["L1", "L2", "L3"].includes(value);
const unique = (items: Diagnostic[]) => [...new Map(items.map(item => [`${item.code}:${item.event || ""}:${item.terminalIds.join("|")}:${item.message}`, item])).values()];
const issue = (code: string, message: string, componentIds: string[] = [], severity: Diagnostic["severity"] = "error"): Diagnostic => ({ code, message, severity, componentIds, terminalIds: [], wireIds: [] });

type ExpectedMotor = { role: string; direction?: "forward" | "reverse"; connection?: "star" | "delta" | "double-star"; speed?: "low" | "high" };
type Mode = { name: string; start: () => void; expected: ExpectedMotor[]; held?: string[] };

/** Representative course scenarios and graph-cut safety checks, not an exhaustive state-space proof. */
export function assessMotorCourse(document: CircuitDocument, lessonId: string): LessonAssessment {
  const checked = validateDocument(document);
  if (!checked.valid) return { status: "unsupported", passed: 0, total: 0, checks: [], diagnostics: checked.errors.map(message => issue("INVALID_DOCUMENT", message)) };
  if (!/^motor-course-(0[1-9]|10)$/.test(lessonId)) return { status: "unsupported", passed: 0, total: 0, checks: [], diagnostics: [issue("LESSON_UNSUPPORTED", "尚未定义此电机课程的行为评估")] };
  const number = Number(lessonId.slice(-2));
  const standard = createMotorCourseDocument(lessonId);
  const roles: Record<string, string> = {};
  const diagnostics: Diagnostic[] = [], checks: LessonCheck[] = [], trace: LessonTrace[] = [];
  const combinedFuse = document.components.find(component => component.id === (document.roles?.fu2 ?? "fu2") && component.type === "fuse2");
  for (const [role, standardId] of Object.entries(standard.roles || {})) {
    if (combinedFuse && /^fu2[ab]$/.test(role)) { roles.fu2 = combinedFuse.id; continue; }
    const expected = standard.components.find(component => component.id === standardId)!;
    const id = document.roles?.[role] || (!document.roles && document.components.some(component => component.id === standardId) ? standardId : undefined);
    const actual = document.components.find(component => component.id === id);
    // Existing member snapshots used three independent FU1 instances. Accept
    // those without rewriting their IDs, wiring, layout or stored roles.
    if (role === "fu1" && !actual && !document.roles?.fu1) {
      for (const legacyRole of ["fu1a", "fu1b", "fu1c"]) {
        const legacyId = document.roles?.[legacyRole] || legacyRole;
        const legacy = document.components.find(component => component.id === legacyId);
        if (legacy?.type === "fuse") roles[legacyRole] = legacy.id;
        else diagnostics.push(issue("LESSON_ROLE_MISSING", `${legacyRole.toUpperCase()} 缺少单极熔断器，或改用一个 FU1 三联熔断器`, legacy ? [legacy.id] : [], "warning"));
      }
      continue;
    }
    const momentaryColorEquivalent = actual && ["push-no", "push-nc"].includes(actual.type) && ["push-no", "push-nc"].includes(expected.type);
    if (!actual || !equivalentComponentType(actual.type,expected.type) && !momentaryColorEquivalent) diagnostics.push(issue("LESSON_ROLE_MISSING", `${expected.label} 缺少类型匹配的课程角色绑定`, id ? [id] : [], "warning"));
    else roles[role] = actual.id;
  }
  if (new Set(Object.values(roles)).size !== Object.values(roles).length) diagnostics.push(issue("LESSON_ROLE_DUPLICATED", "不同图内位号不能绑定到同一个器件实例", [], "warning"));
  if (diagnostics.length) return { status: "incomplete", passed: 0, total: 1, checks: [{ id: "roles", label: "课程器件角色完整且类型正确", passed: false }], diagnostics };
  const assigned = new Set(Object.values(roles));
  // The user's star-delta placement drawing includes a spare SB3. It is outside
  // the two-button electrical schematic and accepted only while fully unwired.
  const spare = number === 9 && document.components.find(component => component.id === document.roles?.sb3);
  if (spare && spare.type === "push-no" && !document.wires.some(wire => wire.from.componentId === spare.id || wire.to.componentId === spare.id)) assigned.add(spare.id);
  const uncovered = document.components.filter(component => !assigned.has(component.id) && (getDefinition(component.type).load || getDefinition(component.type).contacts?.some(contact => ["switch", "push", "overload"].includes(contact.control)) || component.type === "fuse" || component.type === "fuse3" || component.type === "fuse2"));
  if (uncovered.length) return { status: "unsupported", passed: 0, total: 1, checks: [{ id: "coverage", label: "所声明的负载、开关和保护器件均在课程评估范围内", passed: false }], diagnostics: [issue("UNASSESSED_COMPONENTS", "存在未被本课程动作与保护检查覆盖的额外负载、控制或保护器件", uncovered.map(component => component.id))] };
  const motorRoles = Object.keys(roles).filter(role => getDefinition(document.components.find(component => component.id === roles[role])!.type).load?.kind === "motor");
  const frRoles = Object.keys(roles).filter(role => /^fr\d*$/.test(role));
  const mainContactors = Object.keys(roles).filter(role => /^km/.test(role));
  const samples: SimulationResult[] = [];
  const sampleEvents = new WeakMap<SimulationResult, { event: string; actions: SimulationAction[] }>();
  let result = simulate(document, initialRuntime(document, false)), event = "初始断电", unsupported = false;
  let actions: SimulationAction[] = [];
  function capture(label: string, action?: SimulationAction) {
    event = label;
    unsupported ||= !result.supported;
    trace.push({ event, ...(action ? { action } : {}), powerOn: result.runtime.powerOn, faultLatched: result.runtime.faultLatched, components: result.components, diagnosticCodes: result.diagnostics.map(item => item.code) });
    diagnostics.push(...result.diagnostics.filter(item => item.severity === "error" || ["PE_MISSING", "MOTOR_PHASE_MISSING", "MOTOR_WINDING_OPEN", "AUXILIARY_OWNER_MISSING"].includes(item.code)).map(item => ({ ...item, event, actionSequence: [...actions] })));
    samples.push(result);
    sampleEvents.set(result, { event, actions: [...actions] });
  }
  function step(action: SimulationAction, label: string) { actions.push(action); result = simulate(document, result.runtime, action); capture(label, action); }
  const press = (role: string) => step({ type: "press", componentId: roles[role] }, `按下 ${role.toUpperCase()}`);
  const release = (role: string) => step({ type: "release", componentId: roles[role] }, `松开 ${role.toUpperCase()}`);
  const tap = (role: string) => { press(role); release(role); };
  const on = (role: string) => !!result.components[roles[role]]?.active;
  const allStopped = () => motorRoles.every(role => !on(role));
  const allReleased = () => Object.keys(roles).filter(role => getDefinition(document.components.find(component => component.id === roles[role])!.type).load?.kind === "coil").every(role => !on(role));
  function add(id: string, label: string, passed: boolean, code = "COURSE_BEHAVIOR_MISMATCH", componentRoles: string[] = motorRoles, severity: Diagnostic["severity"] = "warning") {
    checks.push({ id, label, passed });
    if (!passed) diagnostics.push({ ...issue(code, label, componentRoles.map(role => roles[role]).filter(Boolean), severity), event, actionSequence: [...actions] });
  }
  const motorMatches = ({ role, ...expected }: ExpectedMotor) => {
    const motor: ComponentRuntime | undefined = result.components[roles[role]];
    return !!motor?.active && Object.entries(expected).every(([property, value]) => motor[property as keyof ComponentRuntime] === value);
  };
  function fresh(label: string) {
    actions = []; result = simulate(document, initialRuntime(document, false)); capture(`${label}：断电初始化`);
    step({ type: "power", enabled: true }, `${label}：教学电源接通`);
    step({ type: "toggle", componentId: roles.qf }, `${label}：QF 合闸`);
  }
  const delayMs = document.components.find(component => component.id === roles.kt)?.settings?.delayMs ?? 3000;
  const wait = (ms = delayMs) => step({ type: "advance-time", ms }, `推进教学时间 ${ms} ms`);
  const forward: ExpectedMotor[] = [{ role: "m", direction: "forward" }], reverse: ExpectedMotor[] = [{ role: "m", direction: "reverse" }];
  const basic: ExpectedMotor[] = [{ role: "m" }];
  const modes: Mode[] = [];
  const stopRole = number === 1 ? undefined : [2, 3, 10].includes(number) ? "sb1" : [4, 5, 6].includes(number) ? "sb3" : [8, 9].includes(number) ? "sb2" : undefined;
  capture(event);
  add("initial-off", "初始断电时所有电机和线圈均停止", allStopped() && allReleased(), "UNEXPECTED_RUN", motorRoles, "error");
  fresh("课程主序列");
  add("power-no-start", "仅接通电源与 QF 时不会自行启动", allStopped() && allReleased(), "UNEXPECTED_RUN", motorRoles, "error");

  if (number === 1) {
    press("sb"); add("jog-pressed", "点动按钮按住时电机运行", on("m"));
    release("sb"); add("jog-release", "松开点动按钮后立即停止", allStopped(), "JOG_LATCHED", ["m", "km", "sb"], "error");
    modes.push({ name: "点动", start: () => press("sb"), expected: basic, held: ["sb"] });
  } else if (number === 2 || number === 3) {
    if (number === 3) {
      press("sb3"); add("compound-jog-on", "复合点动按钮按住时电机运行", on("m"));
      release("sb3"); add("compound-jog-off", "松开复合点动按钮不形成自锁", allStopped(), "JOG_LATCHED", ["sb3", "km"], "error");
    }
    tap("sb2"); add("self-hold", "连续启动按钮松开后电机保持运行", on("m"), "SELF_HOLD_MISSING");
    if (number === 3) {
      press("sb3"); add("running-jog-on", "连续运行中按住点动按钮仍运行", on("m"));
      release("sb3"); add("running-jog-release", "点动切断保持支路后松开按钮会停机", allStopped(), "JOG_LATCHED", ["sb3", "km"], "error");
      modes.push({ name: "复合点动", start: () => press("sb3"), expected: basic, held: ["sb3"] });
    }
    modes.push({ name: "连续运行", start: () => tap("sb2"), expected: basic });
  } else if (number >= 4 && number <= 6) {
    tap("sb1"); add("forward-hold", "正转启动后松开按钮保持正转", forward.every(motorMatches));
    press("sb2");
    add("reverse-request", number !== 5 ? "接触器互锁阻止运行中直接反向抢占" : "按钮双重联锁可从正转安全切换反转", (number !== 5 ? forward : reverse).every(motorMatches), "INTERLOCK_INEFFECTIVE", ["km1", "km2"], "error");
    release("sb2"); tap("sb3"); tap("sb2"); add("reverse-hold", "停机后反转启动并保持", reverse.every(motorMatches));
    press("sb1"); add("forward-request", number === 5 ? "反转中正转按钮安全切换到正转" : "反转中正转按钮不能抢占", (number === 5 ? forward : reverse).every(motorMatches), "INTERLOCK_INEFFECTIVE", ["km1", "km2"], "error"); release("sb1");
    if (number === 6) {
      press("sq2"); add("return-sq2", "SQ2 触发时由反转换为正转", forward.every(motorMatches)); release("sq2");
      press("sq1"); add("return-sq1", "SQ1 触发时由正转换为反转", reverse.every(motorMatches)); release("sq1");
      press("sq3"); add("sq3-direction", "SQ3 不阻断反转支路", reverse.every(motorMatches)); release("sq3");
      press("sq4"); add("sq4-limit", "SQ4 附加限位切断反转", allStopped(), "LIMIT_INEFFECTIVE", ["sq4", "km2"], "error");
      release("sq4"); add("sq4-reset", "SQ4 释放后不会自行重新启动", allStopped(), "UNEXPECTED_RESTART", ["sq4", "m"], "error");
      tap("sb1"); press("sq4"); add("sq4-direction", "SQ4 不阻断正转支路", forward.every(motorMatches)); release("sq4");
      press("sq3"); add("sq3-limit", "SQ3 附加限位切断正转", allStopped(), "LIMIT_INEFFECTIVE", ["sq3", "km1"], "error");
      release("sq3"); add("sq3-reset", "SQ3 释放后不会自行重新启动", allStopped(), "UNEXPECTED_RESTART", ["sq3", "m"], "error");
      modes.push({ name: "SQ1 持续触发反转", start: () => { tap("sb1"); press("sq1"); }, expected: reverse, held: ["sq1"] }, { name: "SQ2 持续触发正转", start: () => { tap("sb2"); press("sq2"); }, expected: forward, held: ["sq2"] });
    }
    modes.push({ name: "正转", start: () => tap("sb1"), expected: forward }, { name: "反转", start: () => tap("sb2"), expected: reverse });
  } else if (number === 7) {
    tap("sb4"); add("sequence-permission", "M1 未运行时 M2 不能先启动", allStopped(), "SEQUENCE_PERMISSION_MISSING", ["m1", "m2", "km1", "km2"], "error");
    tap("sb3"); add("first-motor", "先启动 M1 后只有 M1 运行", on("m1") && !on("m2"));
    tap("sb4"); add("second-motor", "M1 运行后允许启动 M2 并保持", on("m1") && on("m2"));
    tap("sb1"); add("reverse-stop-lock", "M2 运行期间停止 M1 被联锁阻止", on("m1") && on("m2"), "STOP_SEQUENCE_INEFFECTIVE", ["km2", "sb1", "m1"], "error");
    tap("sb2"); add("stop-second", "先停止 M2，M1 继续运行", on("m1") && !on("m2"));
    tap("sb1"); add("stop-first", "M2 停机后允许停止 M1", allStopped(), "STOP_INEFFECTIVE", ["m1", "m2"], "error");
    modes.push({ name: "单台 M1", start: () => tap("sb3"), expected: [{ role: "m1" }] }, { name: "两台顺序运行", start: () => { tap("sb3"); tap("sb4"); }, expected: [{ role: "m1" }, { role: "m2" }] });
  } else if (number === 8) {
    tap("sb1"); add("delay-hold", "启动后 KA 与 KT 保持受电，KM 尚未启动", on("ka") && on("kt") && !on("km") && allStopped());
    wait(Math.max(0, delayMs - 1)); add("before-delay", "设定延时到达前电机仍停止", allStopped(), "TIMER_BYPASS", ["kt", "km"], "error");
    wait(1); add("delay-transfer", "延时到达后 KM 自锁并切断 KA、KT 支路", on("m") && on("km") && !on("ka") && !on("kt"));
    wait(1); add("delay-after-boundary", "到时后一毫秒仍由 KM 保持运行", on("m") && !on("ka") && !on("kt"));
    modes.push({ name: "延时后运行", start: () => { tap("sb1"); wait(); }, expected: basic });
    fresh("延时取消"); tap("sb1"); wait(Math.max(0, delayMs - 1)); tap("sb2"); wait();
    add("timer-cancel", "延时中停止会清除计时且不会延后自行启动", allStopped() && allReleased(), "TIMER_RESET_INEFFECTIVE", ["ka", "kt", "km"], "error");
  } else if (number === 9) {
    tap("sb1"); add("star-start", "启动时总接触器和星接触器吸合，电机呈星形连接", on("km") && on("kmy") && !on("kmd") && motorMatches({ role: "m", connection: "star" }));
    const initialDirection = result.components[roles.m]?.direction;
    wait(Math.max(0, delayMs - 1)); add("star-before-delay", "延时前保持星形且三角接触器未吸合", on("kmy") && !on("kmd") && motorMatches({ role: "m", connection: "star" }));
    wait(1); add("delta-transfer", "延时后断开星形并转为三角，方向保持一致且 KT 失电复位", on("km") && !on("kmy") && on("kmd") && !on("kt") && motorMatches({ role: "m", connection: "delta" }) && result.components[roles.m]?.direction === initialDirection);
    wait(1); add("delta-after-boundary", "到时后一毫秒保持三角形运行", on("kmd") && !on("kmy") && !on("kt") && motorMatches({ role: "m", connection: "delta" }));
    modes.push({ name: "星形起动", start: () => tap("sb1"), expected: [{ role: "m", connection: "star" }] }, { name: "三角运行", start: () => { tap("sb1"); wait(); }, expected: [{ role: "m", connection: "delta" }] });
  } else if (number === 10) {
    tap("sb2"); add("low-speed", "低速按钮使 KM1 吸合，电机进入低速档", on("km1") && !on("km2") && !on("km3") && motorMatches({ role: "m", speed: "low" }));
    const initialDirection = result.components[roles.m]?.direction;
    tap("sb3"); add("high-speed", "高速按钮使 KM2、KM3 同时吸合并切除 KM1", !on("km1") && on("km2") && on("km3") && motorMatches({ role: "m", speed: "high" }) && result.components[roles.m]?.direction === initialDirection);
    tap("sb2"); add("return-low", "切回低速时释放高速组并保持转向", on("km1") && !on("km2") && !on("km3") && motorMatches({ role: "m", speed: "low" }) && result.components[roles.m]?.direction === initialDirection);
    modes.push({ name: "低速", start: () => tap("sb2"), expected: [{ role: "m", speed: "low" }] }, { name: "高速", start: () => tap("sb3"), expected: [{ role: "m", speed: "high" }] });
  }

  if (number === 2 || number === 3) {
    fresh("同时启动与停止"); press("sb2"); press("sb1");
    add("stop-dominates-start", "启动按钮保持时停止按钮仍优先", allStopped() && allReleased(), "STOP_INEFFECTIVE", ["sb1", "sb2", "km"], "error");
    release("sb2"); release("sb1"); add("both-release", "启动和停止都松开后不自行重启", allStopped(), "UNEXPECTED_RESTART", ["km", "m"], "error");
  }
  if (number === 5 || number === 10) {
    const first = number === 5 ? "sb1" : "sb2", second = number === 5 ? "sb2" : "sb3";
    fresh("两种运行请求同时保持"); press(first); press(second);
    add("conflicting-buttons", "两种互斥运行按钮同时保持时全部电机停止", allStopped() && allReleased(), "INTERLOCK_INEFFECTIVE", mainContactors, "error");
  }
  if (number === 8 || number === 9) {
    const interruptions: { name: string; interrupt: SimulationAction; reset: SimulationAction }[] = [
      { name: "停止", interrupt: { type: "press", componentId: roles.sb2 }, reset: { type: "release", componentId: roles.sb2 } },
      { name: "QF", interrupt: { type: "toggle", componentId: roles.qf }, reset: { type: "toggle", componentId: roles.qf } },
      { name: "断电", interrupt: { type: "power", enabled: false }, reset: { type: "power", enabled: true } },
      ...frRoles.map(fr => ({ name: fr, interrupt: { type: "trip-overload", componentId: roles[fr] } as SimulationAction, reset: { type: "reset-overload", componentId: roles[fr] } as SimulationAction })),
    ];
    for (const interruption of interruptions) {
      fresh(`计时中${interruption.name}`); tap("sb1"); wait(Math.max(0, delayMs - 1)); step(interruption.interrupt, `计时中${interruption.name}动作`);
      add(`timer-${interruption.name}-off`, `${interruption.name}动作取消计时并释放线圈`, allStopped() && allReleased(), "TIMER_RESET_INEFFECTIVE", ["kt", ...motorRoles], "error");
      // Keep each action within the engine's one-hour limit, including a legal
      // one-hour timer setting; the following millisecond still probes after expiry.
      step(interruption.reset, `${interruption.name}恢复`); wait(delayMs); wait(1);
      add(`timer-${interruption.name}-reset`, `${interruption.name}恢复后旧期限不能使电机启动`, allStopped() && allReleased(), "UNEXPECTED_RESTART", ["kt", ...motorRoles], "error");
    }
  }

  for (const [index, mode] of modes.entries()) {
    const prefix = `mode-${index}`;
    fresh(`${mode.name}保护验证`); mode.start();
    add(`${prefix}-run`, `${mode.name}模式可以启动并达到目标状态`, mode.expected.every(motorMatches));
    if (stopRole) {
      press(stopRole); add(`${prefix}-stop`, `${mode.name}模式下停止按钮有效`, allStopped() && allReleased(), "STOP_INEFFECTIVE", [stopRole, ...motorRoles], "error");
      for (const held of mode.held || []) release(held);
      release(stopRole); add(`${prefix}-stop-reset`, `${mode.name}停止按钮释放后不自行重启`, allStopped(), "UNEXPECTED_RESTART", motorRoles, "error");
    }
    fresh(`${mode.name}QF验证`); mode.start(); step({ type: "toggle", componentId: roles.qf }, "QF 断开");
    add(`${prefix}-qf`, `${mode.name}断开 QF 切断电机和线圈`, allStopped() && allReleased(), "PROTECTION_BYPASS", ["qf", ...motorRoles], "error");
    for (const held of mode.held || []) release(held);
    step({ type: "toggle", componentId: roles.qf }, "QF 重新合闸"); add(`${prefix}-qf-reset`, `${mode.name}重新合闸不自行重启`, allStopped(), "UNEXPECTED_RESTART", motorRoles, "error");
    fresh(`${mode.name}失压验证`); mode.start(); step({ type: "power", enabled: false }, "教学电源断电");
    add(`${prefix}-power-off`, `${mode.name}断电后电机和线圈全部释放`, allStopped() && allReleased(), "UNEXPECTED_RUN", motorRoles, "error");
    for (const held of mode.held || []) release(held);
    step({ type: "power", enabled: true }, "教学电源恢复"); add(`${prefix}-power-reset`, `${mode.name}失压恢复后不自行重启`, allStopped(), "UNEXPECTED_RESTART", motorRoles, "error");
    for (const fr of frRoles) {
      fresh(`${mode.name}${fr.toUpperCase()}验证`); mode.start(); step({ type: "trip-overload", componentId: roles[fr] }, `${fr.toUpperCase()} 过载动作`);
      add(`${prefix}-${fr}-trip`, `${mode.name}下 ${fr.toUpperCase()} 动作切断全部电机`, allStopped() && allReleased(), "OVERLOAD_INEFFECTIVE", [fr, ...motorRoles], "error");
      for (const held of mode.held || []) release(held);
      step({ type: "reset-overload", componentId: roles[fr] }, `${fr.toUpperCase()} 复位`);
      add(`${prefix}-${fr}-reset`, `${mode.name}下 ${fr.toUpperCase()} 复位不自行重启`, allStopped(), "UNEXPECTED_RESTART", [fr, ...motorRoles], "error");
    }
  }

  // Inspect electrical paths at observed conducting states. Removing one device's
  // internal edges must break its protected source path; wire geometry and color
  // are irrelevant, and fixed terminal-block intermediates remain acceptable.
  const protective = buildCircuitNetwork(document, initialRuntime(document), { protectiveOnly: true });
  add("permanent-pe", "每台电机具有永久 PE 通路", motorRoles.every(role => protective.connected(key(roles[role], "PE"), key(roles.source, "PE"))), "PE_MISSING", motorRoles, "error");
  const fuseRoles = Object.keys(roles).filter(role => /^fu1[abc]?$/.test(role));
  const fusePoles = fuseRoles.flatMap(role => getDefinition(document.components.find(component => component.id === roles[role])!.type).fixedConnections!.map(terminals => ({role, terminals, id:`${roles[role]}:${terminals.join("-")}`})));
  const controlFuses = Object.keys(roles).filter(role => /^fu2[ab]?$/.test(role));
  const controlFusePoles = controlFuses.flatMap(role => getDefinition(document.components.find(component => component.id === roles[role])!.type).fixedConnections!.map(terminals => ({role,terminals,id:`${roles[role]}:${terminals.join("-")}`})));
  const usedFuses = new Set<string>(), usedFr = new Set<string>();
  const pathReported = new Set<string>();
  function pathFailure(code: string, label: string, probe: ReturnType<typeof buildCircuitNetwork>, terminal: string, guardedRoles: string[], sample: SimulationResult) {
    const id = `${code}:${terminal}`;
    if (pathReported.has(id)) return;
    const potential = probe.potentials(terminal).find(phase);
    if (!potential) return;
    pathReported.add(id);
    const sourceTerminal = key(roles.source, potential), path = probe.path(sourceTerminal, terminal), captured = sampleEvents.get(sample);
    diagnostics.push({ code, message: label, severity: "error", componentIds: [...new Set([...guardedRoles.map(role => roles[role]).filter(Boolean), ...path.flatMap(edge => edge.componentId ? [edge.componentId] : [])])], terminalIds: [...new Set([sourceTerminal, ...path.flatMap(edge => [edge.a, edge.b]), terminal])], wireIds: [...new Set(path.flatMap(edge => edge.wireId ? [edge.wireId] : []))], event: captured?.event, actionSequence: captured?.actions, expected: label, actual: `所排除保护触点断开后，${terminal} 仍与 ${potential} 相通` });
  }
  let mainProtected = true, fuseProtected = true, overloadProtected = true, contactorControlled = true, controlProtected = true, controlStopsEffective = true, controlOverloadsEffective = true, sawMotor = false, sawCoil = false;
  for (const sample of samples) {
    const net = buildCircuitNetwork(document, sample.runtime);
    const cuts = new Map<string, ReturnType<typeof buildCircuitNetwork>>();
    const cut = (role: string, mainOnly = false) => {
      const id = `${role}:${mainOnly}`;
      if (!cuts.has(id)) cuts.set(id, buildCircuitNetwork(document, sample.runtime, mainOnly ? { excludeMainContacts: roles[role] } : { excludeComponent: roles[role] }));
      return cuts.get(id)!;
    };
    const cutFusePole = (pole: typeof fusePoles[number]) => {
      const id = `fuse-pole:${pole.id}`;
      if (!cuts.has(id)) cuts.set(id, buildCircuitNetwork(document, sample.runtime, { excludeFixedConnection: { componentId: roles[pole.role], terminals: pole.terminals } }));
      return cuts.get(id)!;
    };
    const fromPhase = (probe: ReturnType<typeof buildCircuitNetwork>, terminal: string) => probe.potentials(terminal).some(phase);
    const pathGuard = (guards: string[], terminal: string) => {
      const potential = net.potentials(terminal).find(phase);
      const path = potential ? net.path(key(roles.source, potential), terminal) : [];
      return guards.find(guard => path.some(edge => edge.componentId === roles[guard]));
    };
    for (const role of motorRoles) {
      if (!sample.components[roles[role]]?.active) continue;
      sawMotor = true;
      const definition = getDefinition(document.components.find(component => component.id === roles[role])!.type);
      for (const terminal of definition.load!.terminals.map(id => key(roles[role], id)).filter(id => fromPhase(net, id))) {
        if (fromPhase(cut("qf"), terminal)) { mainProtected = false; pathFailure("PROTECTION_BYPASS", "主回路相路绕过 QF", cut("qf"), terminal, ["qf", role], sample); }
        // Test one fuse channel at a time. Cutting the whole 3P device would
        // erase evidence of a bypass on just one pole behind a shared housing.
        const necessaryFuses = fusePoles.filter(pole => !fromPhase(cutFusePole(pole), terminal));
        necessaryFuses.forEach(pole => usedFuses.add(pole.id)); fuseProtected &&= necessaryFuses.length > 0;
        if (!necessaryFuses.length) {
          const potential = net.potentials(terminal).find(phase);
          const path = potential ? net.path(key(roles.source, potential), terminal) : [];
          const bypassed = fusePoles.find(pole => path.some(edge => edge.componentId === roles[pole.role] && [edge.a, edge.b].every(endpoint => pole.terminals.some(port => key(roles[pole.role], port) === endpoint))));
          pathFailure("FUSE_BYPASS", "此主回路相路没有必要的 FU1 分极保护", bypassed ? cutFusePole(bypassed) : net, terminal, [...fuseRoles, role], sample);
        }
        const necessaryFr = frRoles.filter(fr => !fromPhase(cut(fr), terminal));
        necessaryFr.forEach(fr => usedFr.add(fr)); overloadProtected &&= !frRoles.length || necessaryFr.length > 0;
        if (frRoles.length && !necessaryFr.length) { const bypassed = pathGuard(frRoles, terminal); pathFailure("OVERLOAD_MAIN_BYPASS", "此主回路相路绕过 FR 检测通道", bypassed ? cut(bypassed) : net, terminal, [...frRoles, role], sample); }
        const activeMain = mainContactors.filter(km => sample.components[roles[km]]?.active);
        const controlled = activeMain.some(km => !fromPhase(cut(km, true), terminal));
        contactorControlled &&= controlled;
        if (!controlled) { const bypassed = pathGuard(activeMain, terminal); pathFailure("CONTACTOR_BYPASS", "此主回路相路不受接触器主触点控制", bypassed ? cut(bypassed, true) : net, terminal, [...activeMain, role], sample); }
      }
    }
    for (const component of document.components.filter(item => getDefinition(item.type).load?.kind === "coil" && sample.components[item.id]?.active)) {
      sawCoil = true;
      controlProtected &&= sample.components[component.id].voltage === 380;
      // Inspect every observed energized branch, including maintained limit
      // requests. A nominal button-only stop test cannot detect a limit branch
      // fed upstream of STOP/FR. Course 07 deliberately permits KM2 to bypass
      // M1's stop, while SB2 only controls the second motor's coil.
      const stopGuards = number === 7
        ? component.id === roles.km2 ? ["sb2"] : component.id === roles.km1 && !sample.components[roles.km2]?.active ? ["sb1"] : []
        : stopRole ? [stopRole] : [];
      for (const guard of [...stopGuards, ...frRoles]) {
        const isOverload = frRoles.includes(guard);
        // TEST opens FR's 95-96 control contact but leaves its fixed main
        // channels intact. Removing the whole device would incorrectly credit
        // a control feed taken through a main channel as overload protection.
        // Likewise STOP must use its real pressed contacts, including its NO.
        const guardId = roles[guard], cacheKey = `actuated:${guardId}`;
        if (!cuts.has(cacheKey)) cuts.set(cacheKey, buildCircuitNetwork(document, isOverload
          ? { ...sample.runtime, overloads: { ...sample.runtime.overloads, [guardId]: true } }
          : { ...sample.runtime, pressed: { ...sample.runtime.pressed, [guardId]: true } }));
        const actuated = cuts.get(cacheKey)!;
        if (networkVoltage(actuated, key(component.id, getDefinition(component.type).load!.terminals[0]), key(component.id, getDefinition(component.type).load!.terminals[1])).value !== 380) continue;
        if (isOverload) controlOverloadsEffective = false; else controlStopsEffective = false;
        pathFailure(isOverload ? "OVERLOAD_CONTROL_BYPASS" : "STOP_CONTROL_BYPASS", `${guard.toUpperCase()} 保护接点动作后此线圈仍有供电通路`, actuated, key(component.id, getDefinition(component.type).load!.terminals[0]), [guard], sample);
      }
      for (const terminal of [key(component.id, getDefinition(component.type).load!.terminals[0]), key(component.id, getDefinition(component.type).load!.terminals[1])]) {
        const qfProtected = !fromPhase(cut("qf"), terminal), hasFuse = controlFusePoles.some(pole => !fromPhase(cutFusePole(pole), terminal));
        controlProtected &&= fromPhase(net, terminal) && qfProtected && hasFuse;
        if (!qfProtected) pathFailure("CONTROL_PROTECTION_BYPASS", "控制导体绕过 QF", cut("qf"), terminal, ["qf"], sample);
        if (!hasFuse) { const bypassed = pathGuard(controlFuses, terminal); pathFailure("CONTROL_PROTECTION_BYPASS", "控制导体没有必要的 FU2 保护", bypassed ? cut(bypassed) : net, terminal, controlFuses, sample); }
      }
    }
  }
  add("main-qf-path", "电机所有受电相路均经过 QF", sawMotor && mainProtected, "PROTECTION_BYPASS", ["qf", ...motorRoles], "error");
  add("main-fuses-path", "三路 FU1 均参与主回路且每条相路受到独立熔断极保护", sawMotor && fuseProtected && fusePoles.length === 3 && usedFuses.size === 3, "FUSE_BYPASS", [...fuseRoles, ...motorRoles], "error");
  add("main-contactor-path", "电机受电相路由实际吸合接触器主触点控制", sawMotor && contactorControlled, "CONTACTOR_BYPASS", mainContactors, "error");
  if (frRoles.length) add("main-overload-path", "每台电机的主回路经过课程热继电器，所有 FR 均参与保护", sawMotor && overloadProtected && usedFr.size === frRoles.length, "OVERLOAD_MAIN_BYPASS", frRoles, "error");
  add("control-fuses-path", "控制线圈使用 380V 相间电源且两侧均经 QF 与 FU2 保护", sawCoil && controlProtected, "CONTROL_PROTECTION_BYPASS", ["qf", ...controlFuses], "error");
  if (stopRole || number === 7) add("control-stop-path", "所有已观测受电支路均受该课程允许的停止链控制", sawCoil && controlStopsEffective, "STOP_CONTROL_BYPASS", number === 7 ? ["sb1", "sb2"] : [stopRole!], "error");
  if (frRoles.length) add("control-overload-path", "每个 FR 常闭保护触点均是所有受电线圈的必要控制通路", sawCoil && controlOverloadsEffective, "OVERLOAD_CONTROL_BYPASS", frRoles, "error");
  // A correct timer or button sequence can conceal a bridged redundant NC.
  // In a real running sample its opposite KM is released, so removing that
  // component removes its closed NC only (its NO/main poles are already open).
  // The running target's coil must then lose the source-to-source supply path.
  const interlocks: [string, string][] = number >= 4 && number <= 6 ? [["km1", "km2"], ["km2", "km1"]]
    : number === 9 ? [["kmy", "kmd"], ["kmd", "kmy"]] : number === 10 ? [["km1", "km2"], ["km2", "km1"]] : [];
  const buttonInterlocks: [string, string][] = number === 5 ? [["km1", "sb2"], ["km2", "sb1"]] : number === 10 ? [["km1", "sb3"], ["km2", "sb2"]] : [];
  for (const [target, guard] of [...interlocks, ...buttonInterlocks]) {
    const running = samples.filter(sample => sample.components[roles[target]]?.active && !sample.components[roles[guard]]?.active);
    const effective = running.length > 0 && running.every(sample => {
      const removed = buildCircuitNetwork(document, sample.runtime, { excludeComponent: roles[guard] });
      const blocked = networkVoltage(removed, key(roles[target], "A1"), key(roles[target], "A2")).value !== 380;
      if (!blocked) pathFailure("INTERLOCK_BYPASS", `${guard.toUpperCase()} 常闭互锁被旁路`, removed, key(roles[target], "A1"), [target, guard], sample);
      return blocked;
    });
    add(`interlock-path-${target}-${guard}`, `${guard.toUpperCase()} 常闭互锁是 ${target.toUpperCase()} 线圈供电的必要通路`, effective, "INTERLOCK_BYPASS", [target, guard], "error");
  }
  if (number >= 4 && number <= 6) add("direction-exclusive", "代表性操作序列中正反转接触器不同时吸合", samples.every(sample => !(sample.components[roles.km1]?.active && sample.components[roles.km2]?.active)), "INTERLOCK_INEFFECTIVE", ["km1", "km2"], "error");
  if (number === 9) add("star-delta-exclusive", "代表性操作序列中星形与三角接触器不同时吸合", samples.every(sample => !(sample.components[roles.kmy]?.active && sample.components[roles.kmd]?.active)), "INTERLOCK_INEFFECTIVE", ["kmy", "kmd"], "error");
  if (number === 10) add("speed-exclusive", "代表性操作序列中高低速组互斥，KM2 与 KM3 同步", samples.every(sample => !(sample.components[roles.km1]?.active && (sample.components[roles.km2]?.active || sample.components[roles.km3]?.active)) && !!sample.components[roles.km2]?.active === !!sample.components[roles.km3]?.active), "INTERLOCK_INEFFECTIVE", ["km1", "km2", "km3"], "error");
  add("safety", "所测操作未发现短路、错电压、缺相或保护接地问题", !diagnostics.some(item => item.severity === "error" || ["PE_MISSING", "MOTOR_PHASE_MISSING", "MOTOR_WINDING_OPEN", "AUXILIARY_OWNER_MISSING"].includes(item.code)), "COURSE_SAFETY_FAILURE", motorRoles, "error");
  const passed = checks.filter(check => check.passed).length;
  return { status: unsupported ? "unsupported" : passed === checks.length ? "passed" : !document.wires.length ? "incomplete" : diagnostics.some(item => item.severity === "error") ? "failed" : "incomplete", passed, total: checks.length, checks, diagnostics: unique(diagnostics), trace };
}
