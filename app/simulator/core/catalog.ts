import type { CircuitComponent, CircuitDocument, ComponentDefinition, ComponentSize, ComponentType, Terminal, TerminalRef } from "./types";
import { terminalKey } from "./types";

// Illustration coordinates from the circles in matching /sim-assets/*.svg files.
// These are local model coordinates, not DOM positions or physical millimetres.
const pin = (id: string, x: number, y: number, side: Terminal["side"], electrical: Terminal["electrical"] = "contact", label = id): Terminal => ({ id, label, x, y, side, electrical });
// Automatic cabinet leads use these exits without moving the drawn screw or changing manual wiring.
const routingExits: Partial<Record<ComponentType, Record<string, Terminal["side"]>>> = {
  contactor220: { "13": "top", "14": "bottom" },
  contactor380: { "13": "top", "14": "bottom" },
  overload: { "95": "top", "96": "top", "97": "bottom", "98": "bottom" },
  relay380: { "13": "bottom", "14": "top", "21": "bottom" },
};
const threeContacts = (control: "switch" | "coil") => ([ ["1", "2"], ["3", "4"], ["5", "6"] ] as [string,string][]).map((terminals, i) => ({ id: `pole-${i + 1}`, terminals, control }));
// Scale artwork and its local electrical anchors together; IDs and internal bridges stay stable.
const compactTerminal = (definition: ComponentDefinition): ComponentDefinition => ({ ...definition, width: definition.width * 0.75, height: definition.height * 0.75, terminals: definition.terminals.map(terminal => ({ ...terminal, x: terminal.x * 0.75, y: terminal.y * 0.75 })) });
export const TIMER_MIN_MS=1;
export const TIMER_MAX_MS=300000;
export const TIMER_DEFAULT_MS=3000;
export const TIMER_LEGACY_MAX_MS=3600000;
export const DUCT_MIN_SIZE = 24;
export const DUCT_MAX_SIZE = 4000;
export const isTimer = (type: string) => type === "timer380" || type === "timer380-8pin";
export const isRelay = (type: string) => type === "relay380" || type === "relay380-jzc1-22";
export const isLayoutObject = (type: string) => isWireDuct(type) || type === "din-rail";
export const canRotate = (type: string) => type === "supply" || type === "terminal-strip16";
export const isWireDuct = (type: string) => type === "wire-duct" || type === "wire-duct-vertical";
const contactor = (ratedVoltage: 220 | 380): ComponentDefinition => ({
  type: ratedVoltage === 220 ? "contactor220" : "contactor380", name: `交流接触器（${ratedVoltage}V）`, category: "industrial", width: 151.5, height: 191.5,
  terminals: [pin("1",17.497,31.498,"top","contact","1/L1"),pin("3",56.497,31.498,"top","contact","3/L2"),pin("5",94.497,31.498,"top","contact","5/L3"),pin("2",17.497,159.498,"bottom","contact","2/T1"),pin("4",56.497,159.498,"bottom","contact","4/T2"),pin("6",94.497,159.498,"bottom","contact","6/T3"),pin("A1",37.497,10.498,"top","coil"),pin("A2_top",114.498,10.498,"top","coil","A2"),pin("A2",114.498,180.498,"bottom","coil"),pin("13",134.497,41.499,"right","contact","13NO"),pin("14",134.497,148.498,"right","contact","14NO"),pin("21",136.497,10.498,"top","contact","21NC"),pin("22",136.497,180.498,"bottom","contact","22NC")],
  fixedConnections: [["A2_top","A2"]],
  contacts: [...threeContacts("coil"), { id: "aux-no", terminals: ["13", "14"], control: "coil" }, { id: "aux-nc", terminals: ["21", "22"], control: "coil", normallyClosed: true }],
  load: { kind: "coil", terminals: ["A1", "A2"], ratedVoltage }, description: `${ratedVoltage}V 交流线圈；三组主触点与常开/常闭辅助触点同步动作，上下 A2 内部相连。`,
});
const pushButton = (type: "push-no" | "push-nc" | "push-latching-red" | "push-latching-green"): ComponentDefinition => ({
  type, name: `${type.startsWith("push-latching-") ? "自锁按钮" : "复位按钮"}（${type === "push-no" || type === "push-latching-green" ? "绿色" : "红色"}）`, category:"industrial", width:101.5, height:183.5,
  terminals:[pin("11",11.498,118.499,"left"),pin("12",89.498,118.499,"right"),pin("23",11.498,166.499,"left"),pin("24",89.498,166.499,"right")],
  contacts:[{id:"nc",terminals:["11","12"],control:type.startsWith("push-latching-") ? "switch" : "push",normallyClosed:true},{id:"no",terminals:["23","24"],control:type.startsWith("push-latching-") ? "switch" : "push"}],
  description:type.startsWith("push-latching-") ? "保持型复合按钮：11-12 常闭，23-24 常开；点击按下后保持，第二次点击弹起。颜色不改变触点类型。" : "瞬时复合按钮：11-12 常闭，23-24 常开；按下先断开常闭再接通常开，松开恢复。颜色不改变触点类型。",
});

export const CATALOG: ComponentDefinition[] = [
  { type:"supply",name:"三相五线电源",category:"power",width:230,height:70,terminals:[pin("L1",25,58,"bottom","phase"),pin("L2",70,58,"bottom","phase"),pin("L3",115,58,"bottom","phase"),pin("N",160,58,"bottom","neutral"),pin("PE",205,58,"bottom","earth")],description:"教学电源：相间 380V，相对中性线 220V，50Hz；N 与 PE 独立。" },
  { type:"breaker3",name:"三极断路器",category:"power",width:149.5,height:187.5,terminals:[pin("1",25.498,20.499,"top"),pin("3",74.498,20.499,"top"),pin("5",123.498,20.499,"top"),pin("2",25.498,166.498,"bottom"),pin("4",74.498,166.498,"bottom"),pin("6",123.498,166.498,"bottom")],contacts:threeContacts("switch"),description:"三极同步分合的教学断路器；不模拟真实脱扣曲线。" },
  { type:"breaker1",name:"单极断路器",category:"power",width:51.5,height:187.5,terminals:[pin("1",25.499,20.499,"top"),pin("2",25.499,166.499,"bottom")],contacts:[{id:"pole",terminals:["1","2"],control:"switch"}],description:"单极开关保护示意，用于照明回路的相线。" },
  // Use the exact terminal-circle centers of the original SVG; the old source handle table is vertically offset.
  { type:"knife-switch3",name:"三极刀开关（QS）",category:"industrial",width:208.5,height:292,terminals:[pin("1",30.499,21.999,"top","contact","L1"),pin("3",106.499,21.999,"top","contact","L2"),pin("5",182.499,21.999,"top","contact","L3"),pin("2",30.499,280.999,"bottom","contact","T1"),pin("4",106.499,280.999,"bottom","contact","T2"),pin("6",182.499,280.999,"bottom","contact","T3")],contacts:threeContacts("switch"),description:"三组独立主触点同步分合的教学刀开关；端子 L1/T1、L2/T2、L3/T3 配对，不带自动脱扣模型。" },
  { type:"fuse",name:"熔断器",category:"power",width:51.5,height:187.5,terminals:[pin("1",25.499,20.499,"top"),pin("2",25.499,166.499,"bottom")],fixedConnections:[["1","2"]],description:"完整熔芯的导通示意；短路由教学电源中止，不模拟熔断时间。" },
  { type:"fuse3",name:"三联熔断器（FU）",category:"power",width:149.5,height:187.5,terminals:[pin("1",25.499,20.499,"top","contact","L1"),pin("3",74.499,20.499,"top","contact","L2"),pin("5",123.499,20.499,"top","contact","L3"),pin("2",25.499,166.499,"bottom","contact","T1"),pin("4",74.499,166.499,"bottom","contact","T2"),pin("6",123.499,166.499,"bottom","contact","T3")],fixedConnections:[["1","2"],["3","4"],["5","6"]],description:"三只完整熔芯分别连接 L1/T1、L2/T2、L3/T3，各相互相绝缘；短路由教学电源中止，不模拟熔断时间。" },
  contactor(220),contactor(380),
  { type:"fuse2",name:"双联熔断器（教学）",category:"power",width:100.5,height:187.5,terminals:[pin("1",25.499,20.499,"top","contact","L1"),pin("2",25.499,166.499,"bottom","contact","T1"),pin("3",74.499,20.499,"top","contact","L2"),pin("4",74.499,166.499,"bottom","contact","T2")].map(terminal=>({...terminal,color:"#84909c"})),fixedConnections:[["1","2"],["3","4"]],description:"由原站熔断器素材派生的双联教学图，默认中性灰；1-2、3-4 两个完整熔芯独立导通，不模拟真实熔断时间。"},
  { type:"auxiliary-no",name:"关联常开辅助触点",category:"industrial",width:59.25,height:205.5,terminals:[pin("13",33.7455,15.7485,"top","contact","13 NO"),pin("14",33.7455,176.247,"bottom","contact","14 NO")],contacts:[{id:"aux-no",terminals:["13","14"],control:"coil"}],description:"使用原接触器辅助触点区域；选择所关联的 KM 或 KA，随其线圈动作。未关联时不参与有效仿真。" },
  { type:"relay380",name:"中间继电器 KA（380V 教学）",category:"industrial",width:121,height:241,terminals:[pin("A1",46.5,218.5,"bottom","coil","A1"),pin("A2",74.5,218.5,"bottom","coil","A2"),pin("13",102.5,190.5,"right","contact","13 NO"),pin("14",102.5,47.5,"right","contact","14 NO"),pin("21",46.5,190.5,"left","contact","21 NC"),pin("22",46.5,19.5,"top","contact","22 NC")],contacts:[{id:"no",terminals:["13","14"],control:"coil"},{id:"nc",terminals:["21","22"],control:"coil",normallyClosed:true}],load:{kind:"coil",terminals:["A1","A2"],ratedVoltage:380},description:"通用 AC 原图放大 2.5 倍；380V 为本教学模型额定值。两组隔离触点；未开放针脚不参与接线。" },
  { type:"timer380",name:"通电延时继电器 KT（380V）",category:"industrial",width:201.5,height:201.5,terminals:[pin("A1",16.498,187.499,"bottom","coil","A1"),pin("A2",184.498,187.499,"bottom","coil","A2"),pin("15",72.499,187.499,"bottom","contact","15 COM"),pin("16",72.499,13.499,"top","contact","16 NC"),pin("25",128.498,187.499,"bottom","contact","25 COM"),pin("28",184.498,13.499,"top","contact","28 NO")],contacts:[{id:"delay-nc",terminals:["15","16"],control:"timer",normallyClosed:true},{id:"delay-no",terminals:["25","28"],control:"timer"}],load:{kind:"coil",terminals:["A1","A2"],ratedVoltage:380},description:"教学双延时模型：380V 线圈得电并达到设定时间后，隔离的15-16断开、25-28闭合；失电立即复位。保留六个稳定教学端子，不增加或改变旧文档的触点关系。" },
  { type:"relay380-jzc1-22", name:"中间继电器 KA（JZC1-22 风格 · 380V 教学）", category:"industrial", width:151.5,height:191.5,
    terminals:[pin("A1",32,14,"top","coil"),pin("A2",119.5,14,"top","coil"),...["13","21","31","43"].map((id,i)=>pin(id,19+i*38,45,"top","contact",`${id} ${i===0||i===3?"NO":"NC"}`)),...["14","22","32","44"].map((id,i)=>pin(id,19+i*38,171,"bottom","contact",`${id} ${i===0||i===3?"NO":"NC"}`))],
    contacts:[{id:"no",terminals:["13","14"],control:"coil"},{id:"no-2",terminals:["43","44"],control:"coil"},{id:"nc",terminals:["21","22"],control:"coil",normallyClosed:true},{id:"nc-2",terminals:["31","32"],control:"coil",normallyClosed:true}],load:{kind:"coil",terminals:["A1","A2"],ratedVoltage:380}, description:"JZC1-22 风格二维教学示意；380V线圈，两常开13-14/43-44、两常闭21-22/31-32，组间隔离。不表示厂家安装尺寸。" },
  { type:"timer380-8pin", name:"通电延时继电器 KT（八端子 · 380V 教学）", category:"industrial",width:201.5,height:201.5,
    terminals:[pin("6",16.5,13.5,"top","contact","6 NO"),pin("5",72.5,13.5,"top","contact","5 NC"),pin("4",128.5,13.5,"top","contact","4 NC"),pin("3",184.5,13.5,"top","contact","3 NO"),pin("7",16.5,187.5,"bottom","coil","7/A2"),pin("8",72.5,187.5,"bottom","contact","8 COM"),pin("1",128.5,187.5,"bottom","contact","1 COM"),pin("2",184.5,187.5,"bottom","coil","2/A1")],
    contacts:[{id:"delay-nc",terminals:["1","4"],control:"timer",normallyClosed:true},{id:"delay-no-1",terminals:["1","3"],control:"timer"},{id:"delay-nc-2",terminals:["8","5"],control:"timer",normallyClosed:true},{id:"delay-no",terminals:["8","6"],control:"timer"}],load:{kind:"coil",terminals:["2","7"],ratedVoltage:380},description:"八端子双延时教学模型：1为公共端，1-4常闭/1-3常开；8为公共端，8-5常闭/8-6常开。2/7为380V线圈；两组到时转换、失电复位，上限300秒。" },
  { type:"din-rail",name:"安装导轨（二维教学）",category:"terminals",width:420,height:24,terminals:[],description:"预布的二维安装示意，可移动、调整长度、删除；无电气连接，不强制器件吸附。" },
  { type:"limit-switch",name:"限位开关 SQ（复合）",category:"industrial",width:85.5,height:226.5,terminals:[pin("11",11.498,127.498,"left","contact","11 NC"),pin("12",73.498,127.498,"right","contact","12 NC"),pin("23",11.498,193.498,"left","contact","23 NO"),pin("24",73.498,193.498,"right","contact","24 NO")],contacts:[{id:"nc",terminals:["11","12"],control:"push",normallyClosed:true},{id:"no",terminals:["23","24"],control:"push"}],description:"按住表示机械压下限位杆：11-12先断开、23-24再闭合；释放后恢复。未模拟机械位移。" },
  { type:"overload",name:"热过载继电器",category:"industrial",width:181.5,height:166.5,terminals:[pin("1",24.498,39.499,"top"),pin("3",62.498,39.499,"top"),pin("5",100.499,39.499,"top"),pin("2",24.498,105.499,"bottom"),pin("4",62.498,105.499,"bottom"),pin("6",100.499,105.499,"bottom"),pin("95",135.490,99.490,"right"),pin("96",163.490,99.490,"right"),pin("97",135.490,122.490,"right"),pin("98",163.490,122.490,"right")],fixedConnections:[["1","2"],["3","4"],["5","6"]],contacts:[{id:"nc",terminals:["95","96"],control:"overload",normallyClosed:true},{id:"no",terminals:["97","98"],control:"overload"}],description:"TEST 锁存动作：95-96 断开、97-98 闭合；RESET 复位。主回路检测通道不直接断开。" },
  pushButton("push-no"),pushButton("push-nc"),pushButton("push-latching-red"),pushButton("push-latching-green"),
  { type:"switch1",name:"单控开关",category:"lighting",width:141.5,height:201.5,terminals:[pin("1",70.499,10.499,"top","contact","L"),pin("2",70.498,190.499,"bottom","contact","L1")],contacts:[{id:"switch",terminals:["1","2"],control:"switch"}],description:"保持型单刀单掷开关，L 为进线，L1 为受控出线。" },
  { type:"switch2",name:"双控开关",category:"lighting",width:141.5,height:201.5,terminals:[pin("C",70.499,10.499,"top","contact","L"),pin("1",30.499,190.499,"bottom","contact","L1"),pin("2",110.499,190.499,"bottom","contact","L2")],contacts:[{id:"throw-1",terminals:["C","1"],control:"switch",throw:false},{id:"throw-2",terminals:["C","2"],control:"switch",throw:true}],description:"公共端 L 在两个联络端 L1、L2 之间切换。" },
  { type:"lamp",name:"照明灯（220V）",category:"lighting",width:84.5,height:159.5,terminals:[pin("L",40.498,148.499,"bottom","load"),pin("N",73.499,107.499,"right","neutral")],load:{kind:"lamp",terminals:["L","N"],ratedVoltage:220},description:"220V 示意灯；相线应经过开关，中性线直接返回。" },
  { type:"motor",name:"三相异步电机",category:"industrial",width:280.5,height:191.5,terminals:[pin("U",135.499,10.499,"top","load"),pin("V",193.499,10.499,"top","load"),pin("W",251.499,10.499,"top","load"),pin("PE",269.499,109.499,"right","earth")],load:{kind:"motor",terminals:["U","V","W"],ratedVoltage:380},description:"380V 三相电机与独立 PE 端子；只表现受电、缺相和相序，不模拟转矩或温升。" },
  ...(["motor-star-delta","motor-dahlander"] as const).map(type => ({type,name:type === "motor-star-delta" ? "六端子电机（Y / Δ）" : "双速电机（Δ / YY 教学）",category:"industrial" as const,width:280.5,height:211.5,terminals:[pin("U1",135.498,10.499,"top","load"),pin("V1",193.498,10.499,"top","load"),pin("W1",251.498,10.499,"top","load"),pin("U2",135.498,200.500,"bottom","load"),pin("V2",193.498,200.500,"bottom","load"),pin("W2",251.498,200.500,"bottom","load"),pin("PE",269.498,109.499,"right","earth")],load:{kind:"motor" as const,terminals:["U1","V1","W1","U2","V2","W2"],ratedVoltage:380 as const,motorModel:type === "motor-star-delta" ? "star-delta" as const : "dahlander" as const},description:type === "motor-star-delta" ? "原站六端子电机外观；独立的三组绕组用于星形/三角形教学拓扑判定，PE单独检查。" : "复用原站通用六端子电机外观，电气模型为 Δ / YY 双速教学定义；没有宣称源站存在独立双速型号。"})),
  compactTerminal({ type:"terminal",name:"双极接线端子",category:"terminals",width:121.5,height:101.5,terminals:[pin("A",32.497,27.498,"top","contact","1上"),pin("B",32.497,73.498,"bottom","contact","1下"),pin("A2",88.497,27.498,"top","contact","2上"),pin("B2",88.497,73.498,"bottom","contact","2下")],fixedConnections:[["A","B"],["A2","B2"]],description:"左列 A/B 相通，右列 A2/B2 相通；两极互相绝缘。" }),
  compactTerminal({ type:"pe-terminal",name:"保护接地端子",category:"terminals",width:60.75,height:101.5,terminals:[{...pin("A",32.497,27.498,"top","earth"),routingRole:"internal"},{...pin("B",32.497,73.498,"bottom","earth"),routingRole:"external"}],fixedConnections:[["A","B"]],description:"永久保护连接示意，不能代替 N 返回导体。" }),
  { type:"terminal-strip16",name:"16位端子排（教学）",category:"terminals",width:729,height:76.125,terminals:Array.from({length:16},(_,i)=>[pin(`T${i+1}`,(i*60.75+32.497)*0.75,27.498*0.75,"top","contact",`${i+1}上`),pin(`B${i+1}`,(i*60.75+32.497)*0.75,73.498*0.75,"bottom","contact",`${i+1}下`)]).flat().map(t=>({...t,routingRole:t.side==="top"?"internal" as const:"external" as const})),fixedConnections:Array.from({length:16},(_,i)=>[`T${i+1}`,`B${i+1}`] as [string,string]),description:"由原站端子素材派生的16位教学图，共32个稳定接线端子；每位上下相通，不同位互相绝缘。世界单位不代表安装尺寸。"},
  { type:"wire-duct",name:"横向线槽",category:"terminals",width:420,height:60,terminals:[],description:"可移动的二维导线整理对象，无电气端子、无负载；沿线槽调整导线折点，不改变电气连接。" },
  { type:"wire-duct-vertical",name:"纵向线槽",category:"terminals",width:60,height:420,terminals:[],description:"可移动的二维导线整理对象，无电气端子、无负载；沿线槽调整导线折点，不改变电气连接。" },
];
for (const definition of CATALOG) {
  const exits = routingExits[definition.type];
  if (exits) definition.terminals = definition.terminals.map(terminal => exits[terminal.id] ? { ...terminal, routingSide: exits[terminal.id] } : terminal);
}
export function getDefinition(type: ComponentType | string): ComponentDefinition {
  const definition = CATALOG.find((entry) => entry.type === type);
  if (!definition) throw new Error(`未知元件类型：${type}`);
  return definition;
}
/** World-space footprint shared by the editor, framing and read-only previews. */
export function componentSize(component: CircuitComponent): ComponentSize {
  const definition = getDefinition(component.type);
  const size = isLayoutObject(component.type) && component.size ? component.size : { width: definition.width, height: definition.height };
  return component.rotation === 90 || component.rotation === 270 ? {width:size.height,height:size.width} : size;
}
export function resolveTerminal(document: CircuitDocument, ref: TerminalRef) {
  const component = document.components.find((item) => item.id === ref.componentId);
  if (!component) throw new Error(`未找到元件：${ref.componentId}`);
  const terminal = getDefinition(component.type).terminals.find((item) => item.id === ref.terminalId);
  if (!terminal) throw new Error(`未找到端子：${terminalKey(ref)}`);
  const local = transformedTerminal(component, terminal);
  return { component, terminal: local, world: { x: component.position.x + local.x, y: component.position.y + local.y } };
}

/** Clockwise quarter turns in world coordinates; the terminal identity never changes. */
export function transformedTerminal(component: CircuitComponent, terminal: Terminal): Terminal {
  const {width:w,height:h}=getDefinition(component.type), angle=component.rotation??0;
  const sides: Terminal["side"][]=["top","right","bottom","left"];
  const side=sides[(sides.indexOf(terminal.side)+angle/90)%4];
  const point=angle===90?{x:h-terminal.y,y:terminal.x}:angle===180?{x:w-terminal.x,y:h-terminal.y}:angle===270?{x:terminal.y,y:w-terminal.x}:{x:terminal.x,y:terminal.y};
  const routingSide=terminal.routingSide && sides[(sides.indexOf(terminal.routingSide)+angle/90)%4];
  return {...terminal,...point,side,...(routingSide?{routingSide}:{})};
}
export function rotateComponent(component: CircuitComponent): CircuitComponent {
  if(!canRotate(component.type))throw new Error("此元件不支持旋转");
  const before=componentSize(component),rotation=((component.rotation??0)+90)%360 as 0|90|180|270;
  const next={...component,rotation},after=componentSize(next);
  return {...next,position:{x:component.position.x+(before.width-after.width)/2,y:component.position.y+(before.height-after.height)/2}};
}
export const equivalentComponentType=(actual:string,expected:string)=>actual===expected || isRelay(actual)&&isRelay(expected) || isTimer(actual)&&isTimer(expected) || ["push-no","push-nc"].includes(actual)&&["push-no","push-nc"].includes(expected);
