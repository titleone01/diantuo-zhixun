"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type WireKind = "main" | "control" | "earth";
type Wire = { from: string; to: string; kind: WireKind };
type Point = { x: number; y: number };
type DeviceId = "QF" | "FU1" | "FU2" | "KM" | "FR" | "BUTTONS" | "M" | "XT";
type DevicePositions = Record<DeviceId, Point>;
type DragState = {
  id: DeviceId;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

const assetUrl = (path: string) => `${import.meta.env.BASE_URL ?? "/"}${path}`;

const photoDevices = [
  { code: "QF", name: "断路器", model: "NXB-125 3P", image: "components/breaker.png", pins: [
    ["QF-L1", "L1", 22, 8], ["QF-L2", "L2", 50, 8], ["QF-L3", "L3", 78, 8],
    ["QF-U11", "U11", 22, 91], ["QF-V11", "V11", 50, 91], ["QF-W11", "W11", 78, 91],
  ] },
  { code: "FU1", name: "主电路熔断器", model: "RT18-32 3P", image: "components/fuse.jpg", pins: [
    ["FU1-U11", "U11", 20, 8], ["FU1-V11", "V11", 50, 8], ["FU1-W11", "W11", 80, 8],
    ["FU1-U21", "U21", 20, 92], ["FU1-V21", "V21", 50, 92], ["FU1-W21", "W21", 80, 92],
  ] },
  { code: "KM", name: "交流接触器", model: "NC1-0910", image: "components/contactor.jpg", pins: [
    ["KM-U21", "U21", 42, 27], ["KM-V21", "V21", 59, 27], ["KM-W21", "W21", 75, 27],
    ["KM-U31", "U31", 42, 84], ["KM-V31", "V31", 59, 84], ["KM-W31", "W31", 75, 84],
    ["KM-13", "13", 89, 28], ["KM-14", "14", 88, 84], ["KM-A1", "A1", 25, 42], ["KM-A2", "A2", 25, 72],
  ] },
  { code: "FR", name: "热继电器", model: "NR2-36", image: "components/overload.jpg", pins: [
    ["FR-U31", "U31", 31, 11], ["FR-V31", "V31", 51, 9], ["FR-W31", "W31", 73, 9],
    ["FR-U", "U", 28, 91], ["FR-V", "V", 50, 91], ["FR-W", "W", 72, 91],
    ["FR-95", "95", 88, 69], ["FR-96", "96", 68, 69],
  ] },
];

const expected: Wire[] = [
  ["XT-L1", "QF-L1", "main"], ["XT-L2", "QF-L2", "main"], ["XT-L3", "QF-L3", "main"],
  ["QF-U11", "FU1-U11", "main"], ["QF-V11", "FU1-V11", "main"], ["QF-W11", "FU1-W11", "main"],
  ["FU1-U21", "KM-U21", "main"], ["FU1-V21", "KM-V21", "main"], ["FU1-W21", "KM-W21", "main"],
  ["KM-U31", "FR-U31", "main"], ["KM-V31", "FR-V31", "main"], ["KM-W31", "FR-W31", "main"],
  ["FR-U", "M-U", "main"], ["FR-V", "M-V", "main"], ["FR-W", "M-W", "main"],
  ["XT-L1", "FU2-1", "control"], ["FU2-2", "FR-95", "control"], ["FR-96", "SB1-11", "control"],
  ["SB1-12", "SB2-13", "control"], ["SB2-14", "KM-A1", "control"], ["KM-A2", "XT-L2", "control"],
  ["KM-13", "SB2-13", "control"], ["KM-14", "SB2-14", "control"],
  ["XT-PE", "M-PE", "earth"],
].map(([from, to, kind]) => ({ from, to, kind: kind as WireKind }));

const normalize = (a: string, b: string) => [a, b].sort().join("::");
const expectedKeys = new Set(expected.map((wire) => normalize(wire.from, wire.to)));

const defaultDevicePositions: DevicePositions = {
  XT: { x: 55, y: 86 },
  QF: { x: 55, y: 230 },
  FU1: { x: 55, y: 535 },
  FU2: { x: 520, y: 230 },
  KM: { x: 285, y: 535 },
  FR: { x: 295, y: 835 },
  BUTTONS: { x: 730, y: 485 },
  M: { x: 535, y: 835 },
};

const deviceNames: Record<DeviceId, string> = {
  QF: "QF 断路器",
  FU1: "FU1 主电路熔断器",
  FU2: "FU2 控制电路熔断器",
  KM: "KM 交流接触器",
  FR: "FR 热继电器",
  BUTTONS: "SB1 / SB2 按钮站",
  M: "M 三相异步电动机",
  XT: "XT 接线端子排",
};

const cloneDefaultPositions = (): DevicePositions => Object.fromEntries(
  Object.entries(defaultDevicePositions).map(([id, point]) => [id, { ...point }]),
) as DevicePositions;

const wirePath = (a: Point, b: Point, index: number) => {
  const laneOffset = ((index % 7) - 3) * 9;
  if (Math.abs(a.y - b.y) >= Math.abs(a.x - b.x)) {
    const middleY = Math.round((a.y + b.y) / 2 + laneOffset);
    return `M ${a.x} ${a.y} V ${middleY} H ${b.x} V ${b.y}`;
  }
  const middleX = Math.round((a.x + b.x) / 2 + laneOffset);
  return `M ${a.x} ${a.y} H ${middleX} V ${b.y} H ${b.x}`;
};

export default function Home() {
  const boardRef = useRef<HTMLDivElement>(null);
  const terminalRefs = useRef(new Map<string, HTMLButtonElement>());
  const dragRef = useRef<DragState | null>(null);
  const [wires, setWires] = useState<Wire[]>([]);
  const [wireKind, setWireKind] = useState<WireKind>("main");
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedWire, setSelectedWire] = useState<number | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [points, setPoints] = useState<Record<string, Point>>({});
  const [devicePositions, setDevicePositions] = useState<DevicePositions>(cloneDefaultPositions);
  const [draggingDevice, setDraggingDevice] = useState<DeviceId | null>(null);
  const [isolateCurrentKind, setIsolateCurrentKind] = useState(false);
  const [message, setMessage] = useState("拖动元器件标题可调整位置；从一个端子拖到另一个端子接线");
  const [result, setResult] = useState<"idle" | "error" | "success">("idle");
  const [showHint, setShowHint] = useState(false);
  const [energized, setEnergized] = useState(false);

  const refreshPoints = useCallback(() => {
    const board = boardRef.current?.getBoundingClientRect();
    if (!board) return;
    const next: Record<string, Point> = {};
    terminalRefs.current.forEach((element, id) => {
      const rect = element.getBoundingClientRect();
      next[id] = { x: rect.left - board.left + rect.width / 2, y: rect.top - board.top + rect.height / 2 };
    });
    setPoints(next);
  }, []);

  useEffect(() => {
    refreshPoints();
    const observer = new ResizeObserver(refreshPoints);
    if (boardRef.current) observer.observe(boardRef.current);
    window.addEventListener("resize", refreshPoints);
    return () => { observer.disconnect(); window.removeEventListener("resize", refreshPoints); };
  }, [refreshPoints]);

  useEffect(() => {
    const frame = requestAnimationFrame(refreshPoints);
    return () => cancelAnimationFrame(frame);
  }, [devicePositions, refreshPoints]);

  const validCount = useMemo(() => wires.filter((wire) => expectedKeys.has(normalize(wire.from, wire.to))).length, [wires]);
  const wrongCount = wires.length - validCount;

  const finishWire = (target: string | null) => {
    if (!selected || !target || selected === target) {
      setPointer(null);
      return;
    }
    const key = normalize(selected, target);
    if (wires.some((wire) => normalize(wire.from, wire.to) === key)) {
      setMessage("这两个端子已经连接");
    } else {
      setWires((current) => [...current, { from: selected, to: target, kind: wireKind }]);
      setMessage(`${selected} → ${target} 已连接`);
      setSelectedWire(null);
      setResult("idle");
      setEnergized(false);
    }
    setSelected(null);
    setPointer(null);
    requestAnimationFrame(refreshPoints);
  };

  const removeWire = (index: number) => {
    const wire = wires[index];
    if (!wire) return;
    setWires((current) => current.filter((_, wireIndex) => wireIndex !== index));
    setSelectedWire(null);
    setResult("idle");
    setEnergized(false);
    setMessage(`已删除 ${wire.from} → ${wire.to}`);
  };

  const startDeviceDrag = (id: DeviceId, event: React.PointerEvent<HTMLButtonElement>) => {
    const article = event.currentTarget.closest<HTMLElement>("[data-device]");
    if (!article || !boardRef.current) return;
    const rect = article.getBoundingClientRect();
    event.preventDefault();
    dragRef.current = {
      id,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    setDraggingDevice(id);
    setSelected(null);
    setPointer(null);
    setSelectedWire(null);
    setMessage(`正在移动 ${deviceNames[id]}`);
  };

  const moveDevice = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const board = boardRef.current?.getBoundingClientRect();
    if (!drag || !board) return;
    const x = Math.min(Math.max(event.clientX - board.left - drag.offsetX, 24), board.width - drag.width - 24);
    const y = Math.min(Math.max(event.clientY - board.top - drag.offsetY, 74), board.height - drag.height - 24);
    setDevicePositions((current) => ({
      ...current,
      [drag.id]: { x: Math.round(x), y: Math.round(y) },
    }));
  };

  const finishDeviceDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDraggingDevice(null);
    setMessage(`${deviceNames[drag.id]} 已移动，导线已自动跟随`);
    requestAnimationFrame(refreshPoints);
  };

  const moveDeviceWithKeyboard = (id: DeviceId, event: React.KeyboardEvent<HTMLButtonElement>) => {
    const direction: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const delta = direction[event.key];
    if (!delta) return;
    event.preventDefault();
    const step = event.shiftKey ? 30 : 10;
    const article = event.currentTarget.closest<HTMLElement>("[data-device]");
    const board = boardRef.current;
    setDevicePositions((current) => {
      const width = article?.offsetWidth ?? 180;
      const height = article?.offsetHeight ?? 200;
      const boardWidth = board?.clientWidth ?? 1000;
      const boardHeight = board?.clientHeight ?? 1150;
      return {
        ...current,
        [id]: {
          x: Math.min(Math.max(current[id].x + delta.x * step, 24), boardWidth - width - 24),
          y: Math.min(Math.max(current[id].y + delta.y * step, 74), boardHeight - height - 24),
        },
      };
    });
    setMessage(`${deviceNames[id]} 已用方向键移动`);
  };

  const dragHandle = (id: DeviceId, code: string, name: string, model: string) => (
    <button
      type="button"
      className="photo-heading drag-handle"
      aria-label={`移动 ${code} ${name}，可拖动或使用方向键`}
      title="拖动调整位置；方向键微调，Shift + 方向键快速移动"
      onPointerDown={(event) => startDeviceDrag(id, event)}
      onKeyDown={(event) => moveDeviceWithKeyboard(id, event)}
    >
      <strong>{code}</strong><span>{name}</span><small>{model}</small>
    </button>
  );

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!selected) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>("[data-terminal]");
    finishWire(hit?.dataset.terminal ?? null);
  };

  const handleKey = (id: string, event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (!selected) { setSelected(id); setMessage(`已选择 ${id}，请选择目标端子`); }
    else finishWire(id);
  };

  const terminal = (id: string, label: string, className = "", style?: { left: string; top: string }) => (
    <button
      key={id}
      ref={(node) => { if (node) terminalRefs.current.set(id, node); else terminalRefs.current.delete(id); }}
      className={`terminal ${className} ${selected === id ? "selected" : ""}`}
      data-terminal={id}
      aria-label={`端子 ${id}`}
      title={id}
      style={style}
      onPointerDown={(event) => {
        event.preventDefault();
        if (!selected) {
          const board = boardRef.current?.getBoundingClientRect();
          setSelected(id);
          if (board) setPointer({ x: event.clientX - board.left, y: event.clientY - board.top });
          setMessage(`已选择 ${id}，拖向目标端子`);
        }
      }}
      onKeyDown={(event) => handleKey(id, event)}
    >{label}</button>
  );

  const checkCircuit = () => {
    const missing = expected.filter((item) => !wires.some((wire) => normalize(wire.from, wire.to) === normalize(item.from, item.to)));
    const wrong = wires.filter((wire) => !expectedKeys.has(normalize(wire.from, wire.to)));
    if (!missing.length && !wrong.length) {
      setResult("success"); setEnergized(true); setMessage("接线正确，KM 已吸合，电动机连续运行");
    } else {
      setResult("error"); setEnergized(false);
      setMessage(wrong.length ? `发现 ${wrong.length} 处错接，请检查红色标记的导线` : `还有 ${missing.length} 处未接，可查看提示`);
    }
  };

  const nextMissing = expected.find((item) => !wires.some((wire) => normalize(wire.from, wire.to) === normalize(item.from, item.to)));

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">E</div>
        <div className="brand-copy"><strong>电拓智训</strong><span>电气控制虚拟实训平台</span></div>
        <div className="lesson-chip"><span>01 / 06</span><b>三相异步电动机自锁控制</b></div>
        <button className="outline-button">保存进度</button>
      </header>

      <section className="workspace">
        <aside className="lesson-panel">
          <p className="eyebrow">PRACTICE TASK</p>
          <h1>完成连续运行<br />控制电路接线</h1>
          <p className="description">按照原理图连接主电路与控制电路，完成后通电检查。</p>
          <div className="schematic" aria-label="三相异步电动机自锁控制原理图">
            <div className="schematic-title">实训原理图 <span>点击可查看大图</span></div>
            <button className="schematic-image" onClick={() => window.open(assetUrl("schematic.png"), "_blank")} aria-label="放大查看原理图">
              <img src={assetUrl("schematic.png")} alt="三相异步电动机连续运行与自锁控制原理图" />
            </button>
          </div>
          <div className="task-progress">
            <span>正确连接</span><strong>{validCount} / {expected.length}</strong>
            <div><i style={{ width: `${(validCount / expected.length) * 100}%` }} /></div>
          </div>
          <div className="learning-goals">
            <b>本节要点</b>
            <span>• 主电路三相相序</span>
            <span>• KM 辅助常开触点自锁</span>
            <span>• FR 常闭触点过载保护</span>
          </div>
          <button className="hint-button" onClick={() => setShowHint(true)}>查看下一步提示</button>
        </aside>

        <section className="training-area">
          <div className="training-toolbar">
            <div className={energized ? "power-state on" : "power-state"}><span /> {energized ? "实训电源已接通" : "实训电源已断开"}</div>
            <div className="wire-picker" aria-label="导线类型">
              <button aria-pressed={wireKind === "main"} className={wireKind === "main" ? "active" : ""} onClick={() => setWireKind("main")}><span className="yellow" />主电路</button>
              <button aria-pressed={wireKind === "control"} className={wireKind === "control" ? "active" : ""} onClick={() => setWireKind("control")}><span className="red" />控制电路</button>
              <button aria-pressed={wireKind === "earth"} className={wireKind === "earth" ? "active" : ""} onClick={() => setWireKind("earth")}><span className="green" />保护接地</button>
            </div>
            <button
              className={`tool-button ${isolateCurrentKind ? "active" : ""}`}
              aria-pressed={isolateCurrentKind}
              onClick={() => {
                setIsolateCurrentKind((current) => !current);
                setMessage(isolateCurrentKind ? "已显示全部导线" : `已聚焦${wireKind === "main" ? "主电路" : wireKind === "control" ? "控制电路" : "保护接地"}导线`);
              }}
            >{isolateCurrentKind ? "显示全部" : "仅看当前"}</button>
            <button className="tool-button" onClick={() => { setDevicePositions(cloneDefaultPositions()); setMessage("元器件已恢复为推荐布局"); }}>一键整理</button>
            <button className="tool-button" disabled={!wires.length} onClick={() => { setWires((current) => current.slice(0, -1)); setSelectedWire(null); setResult("idle"); setEnergized(false); setMessage("已撤销上一根导线"); }}>撤销</button>
            <button className="tool-button danger" disabled={selectedWire === null} onClick={() => selectedWire !== null && removeWire(selectedWire)}>删除所选</button>
            <button className="tool-button" disabled={!wires.length} onClick={() => { setWires([]); setSelectedWire(null); setResult("idle"); setEnergized(false); setMessage("接线已清空"); }}>清空</button>
          </div>

          <div
            className="board-wrap"
            ref={boardRef}
            onPointerMove={(event) => {
              if (dragRef.current) {
                moveDevice(event);
                return;
              }
              if (!selected) return;
              const board = event.currentTarget.getBoundingClientRect();
              setPointer({ x: event.clientX - board.left, y: event.clientY - board.top });
            }}
            onPointerUp={(event) => {
              if (dragRef.current) {
                finishDeviceDrag();
                return;
              }
              handlePointerUp(event);
            }}
            onPointerCancel={() => {
              finishDeviceDrag();
              setSelected(null);
              setPointer(null);
            }}
          >
            <svg className="wire-layer" role="group" aria-label="已连接导线">
              {wires.map((wire, index) => {
                const a = points[wire.from], b = points[wire.to];
                if (!a || !b) return null;
                const wrong = result === "error" && !expectedKeys.has(normalize(wire.from, wire.to));
                const path = wirePath(a, b, index);
                const isSelected = selectedWire === index;
                const isDimmed = isolateCurrentKind && wire.kind !== wireKind;
                return (
                  <g key={`${wire.from}-${wire.to}-${index}`} className={`wire-group ${isDimmed ? "dimmed" : ""}`} aria-hidden={isDimmed || undefined}>
                    <path d={path} className={`wire-underlay ${isSelected ? "selected" : ""}`} />
                    <path d={path} className={`wire ${wire.kind} ${wrong ? "wrong" : ""} ${isSelected ? "selected" : ""}`} />
                    <path
                      d={path}
                      className="wire-hit"
                      role="button"
                      tabIndex={isDimmed ? -1 : 0}
                      aria-label={`导线 ${wire.from} 到 ${wire.to}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedWire(index);
                        setMessage(`已选择 ${wire.from} → ${wire.to}，可点击“删除所选”`);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedWire(index);
                          setMessage(`已选择 ${wire.from} → ${wire.to}，可点击“删除所选”`);
                        }
                        if (event.key === "Delete" || event.key === "Backspace") {
                          event.preventDefault();
                          removeWire(index);
                        }
                      }}
                    />
                  </g>
                );
              })}
              {selected && points[selected] && pointer && <path d={wirePath(points[selected], pointer, wires.length)} className={`wire preview ${wireKind}`} />}
            </svg>

            <div className="panel-title"><span>电气控制实训板</span><b>拖动元器件标题调整布局 · 从端子拖出导线</b></div>
            <div className="din-rail rail-top" />
            {photoDevices.map((device) => (
              <article
                className={`photo-device pos-${device.code.toLowerCase()} ${energized && device.code === "KM" ? "engaged" : ""} ${draggingDevice === device.code ? "is-dragging" : ""}`}
                data-device={device.code}
                key={device.code}
                style={{ left: devicePositions[device.code as DeviceId].x, top: devicePositions[device.code as DeviceId].y }}
              >
                {dragHandle(device.code as DeviceId, device.code, device.name, device.model)}
                <div className="photo-frame">
                  <img src={assetUrl(device.image)} alt={`${device.code} ${device.name}实物`} draggable="false" />
                  {device.pins.map(([id, label, x, y]) => terminal(String(id), String(label), "photo-pin", { left: `${x}%`, top: `${y}%` }))}
                </div>
              </article>
            ))}

            <article className={`photo-device pos-fu2 compact-photo ${draggingDevice === "FU2" ? "is-dragging" : ""}`} data-device="FU2" style={{ left: devicePositions.FU2.x, top: devicePositions.FU2.y }}>
              {dragHandle("FU2", "FU2", "控制电路熔断器", "RT18-32")}
              <div className="photo-frame"><img src={assetUrl("components/fuse.jpg")} alt="FU2 控制电路熔断器实物" draggable="false" />
                {terminal("FU2-1", "1", "photo-pin", { left: "36%", top: "8%" })}{terminal("FU2-2", "2", "photo-pin", { left: "36%", top: "92%" })}
              </div>
            </article>

            <article className={`button-station ${draggingDevice === "BUTTONS" ? "is-dragging" : ""}`} data-device="BUTTONS" style={{ left: devicePositions.BUTTONS.x, top: devicePositions.BUTTONS.y }}>
              {dragHandle("BUTTONS", "SB1 / SB2", "停止、启动按钮", "NP2")}
              <div className="photo-frame"><img src={assetUrl("components/buttons.jpg")} alt="红色停止按钮与绿色启动按钮实物" draggable="false" />
                <div className="button-label stop-label">SB1<br /><small>NC 常闭</small></div>
                <div className="button-label start-label">SB2<br /><small>NO 常开</small></div>
                {terminal("SB1-11", "11", "photo-pin", { left: "25%", top: "78%" })}{terminal("SB1-12", "12", "photo-pin", { left: "39%", top: "90%" })}
                {terminal("SB2-13", "13", "photo-pin", { left: "62%", top: "90%" })}{terminal("SB2-14", "14", "photo-pin", { left: "76%", top: "78%" })}
              </div>
            </article>

            <article className={`motor-photo ${energized ? "running" : ""} ${draggingDevice === "M" ? "is-dragging" : ""}`} data-device="M" style={{ left: devicePositions.M.x, top: devicePositions.M.y }}>
              {dragHandle("M", "M", "三相异步电动机", "Y系列 / 380V")}
              <div className="photo-frame"><img src={assetUrl("components/motor.jpg")} alt="三相异步电动机与打开的接线盒" draggable="false" />
                {terminal("M-U", "U", "photo-pin", { left: "41%", top: "58%" })}{terminal("M-V", "V", "photo-pin", { left: "49%", top: "58%" })}{terminal("M-W", "W", "photo-pin", { left: "57%", top: "58%" })}{terminal("M-PE", "PE", "photo-pin earth-pin", { left: "35%", top: "76%" })}
              </div>
              {energized && <div className="running-badge">电动机运行中</div>}
            </article>

            <article className={`xt-photo ${draggingDevice === "XT" ? "is-dragging" : ""}`} data-device="XT" style={{ left: devicePositions.XT.x, top: devicePositions.XT.y }}>
              {dragHandle("XT", "XT", "电源 / 接线端子排", "UK2.5B")}
              <div className="photo-frame"><img src={assetUrl("components/terminal-block.jpg")} alt="XT DIN 导轨式接线端子排实物" draggable="false" />
                {[["L1",8],["L2",24],["L3",40],["PE",56],["U",72],["V",84],["W",94]].map(([label, x]) => terminal(`XT-${label}`, String(label), `photo-pin ${label === "PE" ? "earth-pin" : ""}`, { left: `${x}%`, top: "60%" }))}
              </div>
            </article>
          </div>

          <footer className={`actionbar ${result}`}>
            <div className="guide-icon">{result === "success" ? "✓" : result === "error" ? "!" : "i"}</div>
            <p><b>{result === "success" ? "通电成功" : result === "error" ? "检查未通过" : "操作指引"}</b><span>{message}</span></p>
            <div className="wire-count"><span>已接 {wires.length}</span>{wrongCount > 0 && result === "error" && <b>{wrongCount} 处错误</b>}</div>
            <button className="check-button" onClick={checkCircuit}>{energized ? "再次检查" : "通电检查"}</button>
          </footer>
        </section>
      </section>

      {showHint && <div className="modal-backdrop">
        <section className="hint-modal" role="dialog" aria-modal="true" aria-labelledby="hint-title">
          <span className="hint-step">STEP {Math.min(wires.length + 1, expected.length)}</span>
          <h2 id="hint-title">下一步接线提示</h2>
          {nextMissing ? <><p>请将 <b>{nextMissing.from}</b> 与 <b>{nextMissing.to}</b> 连接，使用{nextMissing.kind === "main" ? "主电路导线" : nextMissing.kind === "control" ? "控制电路导线" : "黄绿保护线"}。</p><small>提示只显示下一步，不会直接完成接线。</small></> : <p>所有标准连接已完成，请点击“通电检查”。</p>}
          <button onClick={() => setShowHint(false)}>我知道了</button>
        </section>
      </div>}
    </main>
  );
}
