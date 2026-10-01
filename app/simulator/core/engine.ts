import { getDefinition } from "./catalog";
import { createLessonDocument, getLesson } from "./lessons";
import { validateDocument } from "./validation";
import { terminalKey } from "./types";
import { assessMotorCourse } from "./motor-course-assessment";
import type { CircuitComponent, CircuitDocument, ComponentRuntime, ContactDefinition, Diagnostic, LessonAssessment, LessonCheck, LessonTrace, Runtime, SimulationAction, SimulationResult, TerminalState } from "./types";

type Edge = { a: string; b: string; wireId?: string; componentId?: string; contactId?: string };
type SourcePotential = "L1" | "L2" | "L3" | "N" | "PE";
const phase = (value: string) => value === "L1" || value === "L2" || value === "L3";
const key = (componentId: string, terminalId: string) => terminalKey({componentId,terminalId});
const diagnostic = (code: string, message: string, severity: Diagnostic["severity"] = "error", terminalIds: string[] = [], wireIds: string[] = [], componentIds: string[] = []): Diagnostic => ({code,message,severity,terminalIds:[...new Set(terminalIds)],wireIds:[...new Set(wireIds)],componentIds:[...new Set([...componentIds,...terminalIds.map(id=>id.split("::")[0])])]});
const uniqueDiagnostics = (items: Diagnostic[]) => [...new Map(items.map(item=>[`${item.code}:${[...item.terminalIds].sort().join("|")}:${item.event??""}`,item])).values()];

class Network {
  parent = new Map<string,string>();
  adjacency = new Map<string,Array<{to:string;edge:Edge}>>();
  sources = new Map<string,SourcePotential[]>();
  edges: Edge[] = [];
  add(id: string) { if(!this.parent.has(id)) {this.parent.set(id,id);this.adjacency.set(id,[]);} }
  root(id: string): string { const parent=this.parent.get(id); if(!parent)return id; if(parent===id)return id; const root=this.root(parent);this.parent.set(id,root);return root; }
  connect(edge: Edge) { this.add(edge.a);this.add(edge.b); const a=this.root(edge.a),b=this.root(edge.b);if(a!==b)this.parent.set(b,a);this.edges.push(edge);this.adjacency.get(edge.a)!.push({to:edge.b,edge});this.adjacency.get(edge.b)!.push({to:edge.a,edge}); }
  connected(a:string,b:string) {return this.parent.has(a)&&this.parent.has(b)&&this.root(a)===this.root(b);}
  mark(id:string,potential:SourcePotential){const root=this.root(id);const values=this.sources.get(root)??[];if(!values.includes(potential))values.push(potential);this.sources.set(root,values);}
  potentials(id:string){return this.sources.get(this.root(id))??[];}
  path(a:string,b:string):Edge[]{
    const previous=new Map<string,{from:string;edge:Edge}>(),queue=[a],seen=new Set([a]);
    for(let index=0;index<queue.length;index++){const current=queue[index];if(current===b)break;for(const {to,edge} of this.adjacency.get(current)??[]){if(seen.has(to))continue;seen.add(to);previous.set(to,{from:current,edge});queue.push(to);}}
    if(!seen.has(b))return [];const edges:Edge[]=[];let current=b;while(current!==a){const step=previous.get(current);if(!step)break;edges.push(step.edge);current=step.from;}return edges.reverse();
  }
}

function contactClosed(component: CircuitComponent, contact: ContactDefinition, runtime: Runtime) {
  const owner=component.type==="auxiliary-no"?component.linkedTo??"":component.id;
  const active=contact.control==="switch"?!!runtime.switches[component.id]:contact.control==="push"?!!runtime.pressed[component.id]:contact.control==="coil"?!!runtime.contactors[owner]:contact.control==="timer"?!!runtime.timers?.[component.id]?.done:!!runtime.overloads[component.id];
  return contact.throw!==undefined?active===contact.throw:contact.normallyClosed?!active:active;
}
export type NetworkOptions={ permanentOnly?:boolean; protectiveOnly?:boolean; neutralOnly?:boolean; excludeComponent?:string; excludeMainContacts?:string; excludeFixedConnection?:{componentId:string;terminals:[string,string]}; openPushContacts?:string; openLatchingContacts?:string };
function network(document:CircuitDocument,runtime:Runtime, options: NetworkOptions = {}) {
  const net=new Network();
  for(const component of document.components){const def=getDefinition(component.type);for(const terminal of def.terminals)net.add(key(component.id,terminal.id));
    for(const [a,b] of def.fixedConnections??[]){
      const excluded=options.excludeFixedConnection;
      const cut=excluded?.componentId===component.id&&((excluded.terminals[0]===a&&excluded.terminals[1]===b)||(excluded.terminals[0]===b&&excluded.terminals[1]===a));
      if(!cut&&options.excludeComponent!==component.id&&(!options.protectiveOnly||component.type==="terminal"||component.type==="pe-terminal")&&(!options.neutralOnly||component.type==="terminal"))net.connect({a:key(component.id,a),b:key(component.id,b),componentId:component.id});
    }
    if(!options.permanentOnly&&!options.protectiveOnly&&!options.neutralOnly)for(const contact of def.contacts??[])if(options.excludeComponent!==component.id&&!(options.excludeMainContacts===component.id&&contact.id.startsWith("pole-"))&&!(options.openPushContacts===component.id&&contact.control==="push")&&!(options.openLatchingContacts===component.id&&["push-latching-red","push-latching-green"].includes(component.type)&&contact.control==="switch")&&contactClosed(component,contact,runtime))net.connect({a:key(component.id,contact.terminals[0]),b:key(component.id,contact.terminals[1]),componentId:component.id,contactId:contact.id});
  }
  for(const wire of document.wires)net.connect({a:terminalKey(wire.from),b:terminalKey(wire.to),wireId:wire.id});
  for(const supply of document.components.filter(item=>item.type==="supply")){for(const potential of ["N","PE"] as SourcePotential[])net.mark(key(supply.id,potential),potential);if(runtime.powerOn&&!runtime.faultLatched)for(const potential of ["L1","L2","L3"] as SourcePotential[])net.mark(key(supply.id,potential),potential);}
  return net;
}
function pathDiagnostic(net:Network,a:string,b:string,code:string,message:string,severity:Diagnostic["severity"]="error"){
  const path=net.path(a,b);return diagnostic(code,message,severity,[a,...path.flatMap(edge=>[edge.a,edge.b]),b],path.flatMap(edge=>edge.wireId?[edge.wireId]:[]),path.flatMap(edge=>edge.componentId?[edge.componentId]:[]));
}
function safety(document:CircuitDocument,runtime:Runtime,net:Network){
  const diagnostics:Diagnostic[]=[];
  const source=document.components.find(item=>item.type==="supply");if(!source)return diagnostics;
  if(runtime.powerOn&&!runtime.faultLatched){
    const potentials:SourcePotential[]=["L1","L2","L3","N","PE"];
    for(let a=0;a<3;a++)for(let b=a+1;b<potentials.length;b++){const left=potentials[a],right=potentials[b],at=key(source.id,left),bt=key(source.id,right);if(net.connected(at,bt))diagnostics.push(pathDiagnostic(net,at,bt,right==="PE"?"PHASE_EARTH_SHORT":right==="N"?"PHASE_NEUTRAL_SHORT":"PHASE_SHORT",`${left} 与 ${right} 经导线或闭合触点短接，教学电源已停止仿真`));}
  }
  if(net.connected(key(source.id,"N"),key(source.id,"PE")))diagnostics.push(pathDiagnostic(net,key(source.id,"N"),key(source.id,"PE"),"NEUTRAL_EARTH_BRIDGE","训练板下游 N 与 PE 被连接；两者须保持独立"));
  for(const component of document.components)for(const terminal of getDefinition(component.type).terminals){
    if(terminal.electrical!=="earth")continue;
    const id=key(component.id,terminal.id),live=net.potentials(id).find(phase);
    if(live)diagnostics.push(pathDiagnostic(net,key(source.id,live),id,"EARTH_TERMINAL_LIVE",`${component.label} 的保护地端子 ${terminal.label} 接入了 ${live}；保护地端子不能用于相线导通`));
    else if(net.potentials(id).includes("N"))diagnostics.push(pathDiagnostic(net,key(source.id,"N"),id,"EARTH_TERMINAL_NEUTRAL",`${component.label} 的保护地端子 ${terminal.label} 接入了 N；保护地端子不能作为工作中性线返回导体`));
  }
  const permanent=network(document,runtime,{protectiveOnly:true});
  for(const motor of document.components.filter(item=>getDefinition(item.type).load?.kind==="motor"))if(!permanent.connected(key(motor.id,"PE"),key(source.id,"PE")))diagnostics.push(diagnostic("PE_MISSING",`${motor.label} 未形成永久保护接地连接；这不代表电机无法受电`,"warning",[key(motor.id,"PE"),key(source.id,"PE")]));
  for(const motor of document.components.filter(item=>getDefinition(item.type).load?.kind==="motor"))for(const terminal of getDefinition(motor.type).load!.terminals)if(net.connected(key(motor.id,terminal),key(source.id,"PE")))diagnostics.push(pathDiagnostic(net,key(source.id,"PE"),key(motor.id,terminal),"MOTOR_EARTH_RETURN",`${motor.label} 的绕组端 ${terminal} 错接保护地；PE 只能连接外壳保护端`));
  return diagnostics;
}
function voltage(net:Network,a:string,b:string):{value?:number;earth:boolean;potentials:[string,string]}{
  const left=net.potentials(a),right=net.potentials(b);const potentials:[string,string]=[left.length===1?left[0]:left.length?"conflict":"floating",right.length===1?right[0]:right.length?"conflict":"floating"];
  if(left.includes("PE")||right.includes("PE"))return {earth:true,potentials};
  if(net.connected(a,b))return {value:0,earth:false,potentials};
  if(left.length!==1||right.length!==1)return {earth:false,potentials};
  if(left[0]===right[0])return {value:0,earth:false,potentials};
  if(phase(left[0])&&phase(right[0]))return {value:380,earth:false,potentials};
  if((phase(left[0])&&right[0]==="N")||(left[0]==="N"&&phase(right[0])))return {value:220,earth:false,potentials};
  return {earth:false,potentials};
}
function loadEvidence(document:CircuitDocument,net:Network,componentId:string,code:string,message:string):Diagnostic {
  const component=document.components.find(c=>c.id===componentId),load=component&&getDefinition(component.type).load;
  const supplies=document.components.filter(c=>c.type==="supply");
  const terminals=load?.terminals.map(t=>key(componentId,t))??[];const paths:Edge[]=[];
  for(const terminal of terminals)for(const source of supplies)for(const potential of ["L1","L2","L3","N","PE"]){const id=key(source.id,potential);if(net.connected(id,terminal))paths.push(...net.path(id,terminal));}
  return diagnostic(code,message,"error",[...terminals,...paths.flatMap(edge=>[edge.a,edge.b])],paths.flatMap(edge=>edge.wireId?[edge.wireId]:[]),[componentId]);
}

/** Finds a floating intermediate net between source-fed loads without treating loads as wires. */
function unsupportedSeries(document:CircuitDocument,net:Network){
  const links=new Map<string,Array<{to:string;id:string}>>();
  for(const c of document.components){const load=getDefinition(c.type).load;if(!load||load.kind==="motor")continue;const a=net.root(key(c.id,load.terminals[0])),b=net.root(key(c.id,load.terminals[1]));if(a===b)continue;links.set(a,[...(links.get(a)??[]),{to:b,id:c.id}]);links.set(b,[...(links.get(b)??[]),{to:a,id:c.id}]);}
  const invalid=new Set<string>();
  for(const start of links.keys()){
    if(net.sources.has(start))continue;const queue=[start],seen=new Set([start]),sourced=new Set<string>(),components=new Set<string>();
    for(let index=0;index<queue.length;index++)for(const link of links.get(queue[index])??[]){components.add(link.id);if(net.sources.has(link.to)){sourced.add(link.to);continue;}if(!seen.has(link.to)){seen.add(link.to);queue.push(link.to);}}
    if(sourced.size>1&&components.size>1)for(const id of components)invalid.add(id);
  }
  return [...invalid];
}
const timerDelay = (component:CircuitComponent) => component.settings?.delayMs??3000;
function updateTimers(document:CircuitDocument,runtime:Runtime) {
  const timers=runtime.timers??(runtime.timers={}),now=runtime.timeMs??0;
  for(const component of document.components.filter(c=>c.type==="timer380")) {
    const old=timers[component.id],energized=!!runtime.contactors[component.id]&&runtime.powerOn&&!runtime.faultLatched;
    if(!energized){timers[component.id]={energized:false,startedAt:null,elapsedMs:0,done:false};continue;}
    const startedAt=old?.energized&&old.startedAt!==null?old.startedAt:now;
    const elapsedMs=Math.max(0,now-startedAt);
    timers[component.id]={energized:true,startedAt,elapsedMs,done:elapsedMs>=timerDelay(component)};
  }
}
function motorState(document:CircuitDocument,component:CircuitComponent,net:Network,runtime:Runtime):{state:ComponentRuntime;diagnostics:Diagnostic[];supported:boolean} {
  const load=getDefinition(component.type).load!,ids=load.terminals.map(t=>key(component.id,t));
  const phases=ids.map(id=>{const p=net.potentials(id);return p.length===1?p[0]:"-";});
  const roots=ids.map(id=>net.root(id));
  const distinct=(group:string[])=>group.length===3&&group.every(phase)&&new Set(group).size===3;
  const forward=(group:string[])=>["L1,L2,L3","L2,L3,L1","L3,L1,L2"].includes(group.join(","));
  const diagnostics:Diagnostic[]=[];
  let state:ComponentRuntime={active:false,state:"stopped",phases};
  if(!runtime.powerOn||runtime.faultLatched||!phases.some(phase))return {state,diagnostics,supported:true};
  const running=(group:string[],connection?:ComponentRuntime["connection"],speed?:ComponentRuntime["speed"],voltage?:number)=>({active:true,state:"running",phases,direction:forward(group)?"forward" as const:"reverse" as const,connection,speed,voltage});
  if(!load.motorModel||load.motorModel==="three-lead") {
    if(distinct(phases))state=running(phases);
    else diagnostics.push(diagnostic("MOTOR_PHASE_MISSING",`${component.label} 未得到三种独立相位，不能正常运行`,"warning",ids));
    return {state,diagnostics,supported:true};
  }
  // The six-lead models classify isolated external terminal patterns, not voltage division through other loads.
  // A nominally floating winding tap/star point connected to a coil, lamp or another motor is outside that model.
  for(const id of ids.filter(terminal=>net.potentials(terminal).length===0))for(const other of document.components){
    const otherLoad=getDefinition(other.type).load;
    if(other.id===component.id||!otherLoad)continue;
    const shared=otherLoad.terminals.find(terminal=>net.connected(id,key(other.id,terminal)));
    if(shared){diagnostics.push(pathDiagnostic(net,id,key(other.id,shared),"UNSUPPORTED_MOTOR_LOAD_NETWORK",`${component.label} 的浮动绕组端接入了其他负载，当前六端拓扑模型不计算该耦合网络的电压分配`));return {state:{...state,state:"unsupported"},diagnostics,supported:false};}
  }
  const first=phases.slice(0,3),second=phases.slice(3,6),firstRoots=roots.slice(0,3),secondRoots=roots.slice(3,6);
  const floatingCommon=(r:string[],p:string[])=>new Set(r).size===1&&p.every(x=>x==="-");
  if(load.motorModel==="star-delta") {
    if(distinct(first)&&floatingCommon(secondRoots,second))state=running(first,"star",undefined,220);
    else if(distinct(second)&&floatingCommon(firstRoots,first))state=running(second,"star",undefined,220);
    else if(distinct(first)&&distinct(second)&&first.every((p,i)=>p!==second[i])&&new Set(roots).size===3)state=running(first,"delta",undefined,380);
  } else if(load.motorModel==="dahlander") {
    const isolatedSecond=second.every(p=>p==="-")&&new Set(secondRoots).size===3&&secondRoots.every(r=>!firstRoots.includes(r));
    if(distinct(first)&&isolatedSecond)state=running(first,"delta","low",380);
    else if(distinct(second)&&floatingCommon(firstRoots,first))state=running(second,"double-star","high",380);
  }
  if(state.active)return {state,diagnostics,supported:true};
  if(new Set(phases.filter(phase)).size<3){diagnostics.push(diagnostic("MOTOR_PHASE_MISSING",`${component.label} 的六端接线缺少三种独立供电相位`,"warning",ids));return {state,diagnostics,supported:true};}
  if(load.motorModel==="star-delta"&&((distinct(first)&&second.every(p=>p==="-")&&new Set(secondRoots).size===3)||(distinct(second)&&first.every(p=>p==="-")&&new Set(firstRoots).size===3))){
    diagnostics.push(diagnostic("MOTOR_WINDING_OPEN",`${component.label} 的绕组未形成星形或三角形闭合工作路径`,"warning",ids));return {state,diagnostics,supported:true};
  }
  state={...state,state:"unsupported"};
  diagnostics.push(diagnostic("MOTOR_CONNECTION_INVALID",`${component.label} 的外接端子网络不符合${load.motorModel==="dahlander"?"本 Δ/YY 双速电机的低速或高速":"三组独立绕组的星形或三角形"}模式，不能推断正常运行`,"error",ids));
  return {state,diagnostics,supported:false};
}
export function initialRuntime(document:CircuitDocument,powerOn=true):Runtime {
  const runtime:Runtime={powerOn,switches:{},pressed:{},overloads:{},contactors:{},faultLatched:false,latchedDiagnostics:[],timeMs:0,timers:{}};
  for(const c of document.components){runtime.switches[c.id]=false;runtime.pressed[c.id]=false;runtime.overloads[c.id]=false;if(getDefinition(c.type).load?.kind==="coil")runtime.contactors[c.id]=false;}
  updateTimers(document,runtime);return runtime;
}
function copyRuntime(runtime:Runtime):Runtime{return {...runtime,timeMs:runtime.timeMs??0,timers:Object.fromEntries(Object.entries(runtime.timers??{}).map(([id,timer])=>[id,{...timer}])),switches:{...runtime.switches},pressed:{...runtime.pressed},overloads:{...runtime.overloads},contactors:{...runtime.contactors},latchedDiagnostics:runtime.latchedDiagnostics?[...runtime.latchedDiagnostics]:[]};}
function act(runtime:Runtime,action?:SimulationAction){
  if(!action)return;
  if(action.type==="power")runtime.powerOn=action.enabled&&!runtime.faultLatched;
  else if(action.type==="reset-fault"){runtime.faultLatched=false;runtime.powerOn=false;runtime.latchedDiagnostics=[];}
  else if(action.type==="toggle")runtime.switches[action.componentId]=!runtime.switches[action.componentId];
  else if(action.type==="press")runtime.pressed[action.componentId]=true;
  else if(action.type==="release")runtime.pressed[action.componentId]=false;
  else if(action.type==="trip-overload")runtime.overloads[action.componentId]=true;
  else if(action.type==="reset-overload")runtime.overloads[action.componentId]=false;
}

function settleCircuit(document:CircuitDocument,previousRuntime?:Runtime,action?:SimulationAction,openPushContacts?:string,openLatchingContacts?:string):SimulationResult {
  const validation=validateDocument(document);
  const runtime:Runtime=previousRuntime?copyRuntime(previousRuntime):validation.valid?initialRuntime(document):{powerOn:false,switches:{},pressed:{},overloads:{},contactors:{},faultLatched:false,latchedDiagnostics:[]};
  if(!validation.valid)return {runtime,components:{},terminals:{},energizedWireIds:[],supported:false,diagnostics:validation.errors.map(message=>diagnostic("INVALID_DOCUMENT",message))};
  act(runtime,action);
  updateTimers(document,runtime);
  const diagnostics:Diagnostic[]=runtime.faultLatched?[...(runtime.latchedDiagnostics??[])]:[];
  let supported=!diagnostics.some(d=>["UNSTABLE_CONTACTOR_LOOP","UNSUPPORTED_LOAD_NETWORK","MULTIPLE_SOURCES_UNSUPPORTED"].includes(d.code));
  const supplies=document.components.filter(c=>c.type==="supply");
  if(supplies.length>1){supported=false;diagnostics.push(diagnostic("MULTIPLE_SOURCES_UNSUPPORTED","首版只支持一组三相电源，不能推断多个电源之间的相位关系","error",[],[],supplies.map(c=>c.id)));}
  if(!supplies.length)diagnostics.push(diagnostic("SOURCE_MISSING","尚未放置电源","warning"));
  const unlinked=document.components.filter(c=>c.type==="auxiliary-no"&&!c.linkedTo);
  if(unlinked.length){supported=false;diagnostics.push(diagnostic("AUXILIARY_OWNER_MISSING","辅助触点块尚未绑定其机械联动的接触器或中间继电器","error",[],[],unlinked.map(c=>c.id)));}
  const coils=document.components.filter(c=>getDefinition(c.type).load?.kind==="coil");
  let net=network(document,runtime),settled=false;
  const seen=new Set<string>();
  const stop=()=>{runtime.faultLatched=true;runtime.powerOn=false;runtime.latchedDiagnostics=uniqueDiagnostics([...(runtime.latchedDiagnostics??[]),...diagnostics.filter(d=>d.severity==="error")]);for(const c of coils)runtime.contactors[c.id]=false;updateTimers(document,runtime);net=network(document,runtime);};
  if(!supported)stop();
  else for(let iteration=0;iteration<64;iteration++){
    const vector=coils.map(c=>`${runtime.contactors[c.id]?1:0}${runtime.timers?.[c.id]?.done?1:0}`).join("");
    if(seen.has(vector)){supported=false;diagnostics.push(diagnostic("UNSTABLE_CONTACTOR_LOOP","触点状态反复振荡，超出离散稳定态模型；教学电源已停止仿真","error",[],[],coils.map(c=>c.id)));stop();break;}
    seen.add(vector);net=network(document,runtime,{openPushContacts,openLatchingContacts});
    const hazards=safety(document,runtime,net);diagnostics.push(...hazards);
    if(hazards.some(d=>["PHASE_SHORT","PHASE_EARTH_SHORT","PHASE_NEUTRAL_SHORT","NEUTRAL_EARTH_BRIDGE","MOTOR_EARTH_RETURN","EARTH_TERMINAL_LIVE","EARTH_TERMINAL_NEUTRAL"].includes(d.code))){stop();settled=true;break;}
    const series=unsupportedSeries(document,net);
    if(series.length){supported=false;diagnostics.push(diagnostic("UNSUPPORTED_LOAD_NETWORK","检测到通过悬浮中间网络串联的负载，首版不计算其电压分配","error",[],[],series));stop();break;}
    const next:Record<string,boolean>={};let dangerous=false;
    for(const c of document.components){const load=getDefinition(c.type).load;if(!load||load.kind==="motor")continue;const a=key(c.id,load.terminals[0]),b=key(c.id,load.terminals[1]),v=voltage(net,a,b);
      if(v.earth){diagnostics.push(loadEvidence(document,net,c.id,"EARTH_AS_RETURN",`${c.label} 连接到 PE，不能将保护地当作工作返回导体`));dangerous=true;}
      else if(v.value!==undefined&&v.value>0&&v.value!==load.ratedVoltage){diagnostics.push(loadEvidence(document,net,c.id,load.kind==="coil"?"COIL_VOLTAGE_MISMATCH":"LOAD_VOLTAGE_MISMATCH",`${c.label} 额定 ${load.ratedVoltage}V，当前接入 ${v.value}V；按额定类别规则不动作`));if(v.value>load.ratedVoltage)dangerous=true;}
    }
    for(const c of coils){const load=getDefinition(c.type).load!,a=key(c.id,load.terminals[0]),b=key(c.id,load.terminals[1]),v=voltage(net,a,b);
      next[c.id]=runtime.powerOn&&!runtime.faultLatched&&v.value===load.ratedVoltage;
    }
    if(dangerous){stop();settled=true;break;}
    if(coils.every(c=>next[c.id]===!!runtime.contactors[c.id])){settled=true;break;}
    runtime.contactors=next;updateTimers(document,runtime);
  }
  if(supported&&!settled){supported=false;diagnostics.push(diagnostic("UNSTABLE_CONTACTOR_LOOP","触点求解超过 64 次，已停止教学仿真"));stop();}
  net=network(document,runtime,{openPushContacts,openLatchingContacts});
  const components:Record<string,ComponentRuntime>={},terminals:Record<string,TerminalState>={};
  for(const c of document.components){const def=getDefinition(c.type);for(const t of def.terminals){const id=key(c.id,t.id),potentials=net.potentials(id);terminals[id]={netId:net.root(id),potential:potentials.length>1?"conflict":potentials[0]??"floating",energized:potentials.some(phase)};}
    if(def.load?.kind==="coil"){const v=voltage(net,key(c.id,"A1"),key(c.id,"A2"));components[c.id]={active:!!runtime.contactors[c.id],state:runtime.contactors[c.id]?"engaged":"released",voltage:v.value};if(c.type==="timer380"){const timer=runtime.timers?.[c.id];components[c.id]={...components[c.id],state:timer?.energized?(timer.done?"done":"timing"):"released",elapsedMs:timer?.elapsedMs??0,remainingMs:Math.max(0,timerDelay(c)-(timer?.elapsedMs??0))};}if(runtime.powerOn&&v.value===undefined&&!v.earth)diagnostics.push(diagnostic("OPEN_CONTROL_PATH",`${c.label} 线圈尚未形成完整供电与返回路径`,"info",[key(c.id,"A1"),key(c.id,"A2")]));}
    else if(def.load?.kind==="lamp"){const a=key(c.id,"L"),b=key(c.id,"N"),v=voltage(net,a,b);const active=runtime.powerOn&&!runtime.faultLatched&&!v.earth&&v.value===220;components[c.id]={active,state:active?"lit":"dark",voltage:v.value};if(v.earth)diagnostics.push(diagnostic("EARTH_AS_RETURN",`${c.label} 不能使用 PE 作为工作返回导体`,"error",[a,b]));else if(v.value&&v.value!==220)diagnostics.push(diagnostic("LOAD_VOLTAGE_MISMATCH",`${c.label} 额定 220V，当前为 ${v.value}V`,"error",[a,b]));}
    else if(def.load?.kind==="motor"){const motor=motorState(document,c,net,runtime);components[c.id]=motor.state;diagnostics.push(...motor.diagnostics);supported&&=motor.supported;}
    else if(c.type==="supply")components[c.id]={active:runtime.powerOn&&!runtime.faultLatched,state:runtime.faultLatched?"fault":runtime.powerOn?"on":"off"};
    else if(c.type==="overload")components[c.id]={active:!!runtime.overloads[c.id],state:runtime.overloads[c.id]?"tripped":"ready"};
    else if(c.type==="push-no"||c.type==="push-nc"||c.type==="limit-switch")components[c.id]={active:!!runtime.pressed[c.id],state:runtime.pressed[c.id]?"pressed":"released"};
    else if(c.type==="auxiliary-no")components[c.id]={active:!!runtime.contactors[c.linkedTo??""],state:runtime.contactors[c.linkedTo??""]?"closed":"open"};
    else if(def.contacts?.length)components[c.id]={active:!!runtime.switches[c.id],state:c.type==="switch2"?(runtime.switches[c.id]?"throw-2":"throw-1"):(runtime.switches[c.id]?"closed":"open")};
    else components[c.id]={active:def.terminals.some(t=>net.potentials(key(c.id,t.id)).some(phase)),state:"connected"};
  }
  diagnostics.push(...safety(document,runtime,net));
  return {runtime,components,terminals,diagnostics:uniqueDiagnostics(diagnostics),supported,energizedWireIds:document.wires.filter(w=>terminals[terminalKey(w.from)]?.energized).map(w=>w.id)};
}

/** Deterministic external events; no wall clock, forced motor state, or course-specific actuation. */
export function simulate(document:CircuitDocument,previousRuntime?:Runtime,action?:SimulationAction):SimulationResult {
  if(action&&!validateDocument(document).valid)return settleCircuit(document,previousRuntime);
  if(action?.type==="advance-time"){
    let result=settleCircuit(document,previousRuntime);
    if(!Number.isFinite(action.ms)||action.ms<0||action.ms>3_600_000){return {...result,supported:false,diagnostics:[...result.diagnostics,diagnostic("INVALID_TIME_STEP","时间增量须为 0 至 3600000 毫秒的有限数值")]};}
    const target=(result.runtime.timeMs??0)+action.ms;
    let supportedDuringWindow=result.supported;
    const earlierHazards:Diagnostic[]=[];
    const summarize=():SimulationResult=>({...result,supported:result.supported&&supportedDuringWindow,diagnostics:uniqueDiagnostics([...earlierHazards,...result.diagnostics])});
    for(let iteration=0;iteration<1024;iteration++){
      const now=result.runtime.timeMs??0;
      supportedDuringWindow&&=result.supported;
      // Keep evidence from every elapsed deadline, even if a later contact restores a valid final network.
      // An ordinary open-winding conversion gap is not a fault latch or an unsupported network.
      earlierHazards.push(...result.diagnostics.filter(d=>d.severity==="error"||["PE_MISSING","MOTOR_PHASE_MISSING"].includes(d.code)).map(d=>({...d,event:d.event??`虚拟时间 ${now}ms`})));
      const deadlines=document.components.filter(c=>c.type==="timer380").flatMap(c=>{const timer=result.runtime.timers?.[c.id];const at=timer?.energized&&!timer.done&&timer.startedAt!==null?timer.startedAt+timerDelay(c):undefined;return at!==undefined&&at>now&&at<=target?[at]:[];});
      const next=deadlines.length?Math.min(...deadlines):target;
      const runtime=copyRuntime(result.runtime);runtime.timeMs=next;result=settleCircuit(document,runtime);
      if(next>=target||result.runtime.faultLatched)return summarize();
    }
    const summary=summarize();return {...summary,supported:false,diagnostics:[...summary.diagnostics,diagnostic("TIME_EVENT_LIMIT","时间窗口内事件超过 1024 次，未完成部分不能视为已验证")]};
  }
  if(action?.type==="press"||action?.type==="release"||action?.type==="toggle"){
    const component=document.components.find(c=>c.id===action.componentId);
    const latching=action.type==="toggle"&&component&&["push-latching-red","push-latching-green"].includes(component.type);
    const momentary=action.type!=="toggle"&&component&&getDefinition(component.type).contacts?.some(c=>c.control==="push"&&c.normallyClosed)&&getDefinition(component.type).contacts?.some(c=>c.control==="push"&&!c.normallyClosed);
    if(latching||(momentary&&!!previousRuntime?.pressed[action.componentId] !== (action.type==="press"))){
      const intermediate=settleCircuit(document,previousRuntime,undefined,latching?undefined:action.componentId,latching?action.componentId:undefined);
      const result=settleCircuit(document,intermediate.runtime,action);
      // Preserve hazards from the break-before-make microstep, without treating temporary open winding paths as final failures.
      const hazards=intermediate.diagnostics.filter(d=>d.severity==="error");
      return {...result,supported:result.supported&&intermediate.supported,diagnostics:uniqueDiagnostics([...hazards,...result.diagnostics])};
    }
  }
  return settleCircuit(document,previousRuntime,action);
}

export { network as buildCircuitNetwork, voltage as networkVoltage, loadEvidence as electricalEvidence };

function roleBindings(document:CircuitDocument,lessonId:string){
  const standard=createLessonDocument(lessonId),roles:Record<string,string>={},diagnostics:Diagnostic[]=[];
  for(const [role,standardId] of Object.entries(standard.roles??{})){
    const expected=standard.components.find(c=>c.id===standardId)!;
    const bound=document.roles?.[role];
    const candidates=bound?document.components.filter(c=>c.id===bound&&c.type===expected.type):document.components.filter(c=>c.type===expected.type);
    if(candidates.length===1)roles[role]=candidates[0].id;else diagnostics.push(diagnostic("LESSON_ROLE_MISSING",`课程角色 ${expected.label} 缺少唯一且类型匹配的元件绑定`,"warning",[],[],bound?[bound]:[]));
  }
  return {roles,diagnostics};
}

function assessmentActions(document:CircuitDocument):SimulationAction[]{
  const events:SimulationAction[]=[{type:"power",enabled:false},{type:"power",enabled:true}];
  for(const c of document.components){
    const controls=new Set(getDefinition(c.type).contacts?.map(contact=>contact.control));
    if(controls.has("switch"))events.push({type:"toggle",componentId:c.id});
    if(controls.has("push"))events.push({type:"press",componentId:c.id},{type:"release",componentId:c.id});
    if(controls.has("overload"))events.push({type:"trip-overload",componentId:c.id},{type:"reset-overload",componentId:c.id});
  }
  return events;
}

/** Includes added controls, so a dangerous branch hidden behind an extra switch cannot pass. */
function auditReachable(document:CircuitDocument,expected:(before:Runtime,next:SimulationResult)=>boolean,componentIds:string[]){
  const events=assessmentActions(document);
  if(events.length>24)return {supported:false,passed:false,diagnostic:diagnostic("STATE_LIMIT","课程评估最多支持 24 种操作事件，当前电路超出可验证范围")};
  const signature=(state:Runtime)=>JSON.stringify([state.powerOn,state.faultLatched,...Object.entries(state.switches).sort(),...Object.entries(state.pressed).sort(),...Object.entries(state.overloads).sort(),...Object.entries(state.contactors).sort()]);
  const queue=[{state:initialRuntime(document),path:[] as SimulationAction[]}],seen=new Set([signature(queue[0].state)]);
  let supported=true,passed=true,counterexample:Diagnostic|undefined;
  for(let index=0;index<queue.length&&index<512;index++)for(const event of events){
    const before=queue[index],next=simulate(document,before.state,event),state=next.runtime,path=[...before.path,event];
    const target=expected(before.state,next),actual=componentIds.every(id=>!!next.components[id]?.active===target);
    const error=next.diagnostics.find(d=>d.severity==="error"||d.code==="MOTOR_PHASE_MISSING"||d.code==="PE_MISSING");
    if(!next.supported)supported=false;
    if(!next.supported||!actual||error){
      passed=false;
      counterexample??={...(error??diagnostic("BEHAVIOR_COUNTEREXAMPLE","存在操作组合未满足课程目标；检查同时按键、保护链或供电路径",target?"warning":"error",[],[],componentIds)),event:JSON.stringify(event),expected:target?"目标负载与控制器件处于运行状态":"目标负载与控制器件处于停止状态",actual:componentIds.map(id=>`${id}: ${next.components[id]?.state??"缺失"}`).join("，"),actionSequence:path};
    }
    const mark=signature(state);if(!state.faultLatched&&!seen.has(mark)){seen.add(mark);queue.push({state,path});}
  }
  if(queue.length>512)return {supported:false,passed:false,diagnostic:diagnostic("STATE_LIMIT","课程行为检查超过 512 个状态，不能判定通过")};
  return {supported,passed,diagnostic:counterexample};
}
/** Grades observed behavior and protection paths; never compares to a list of expected wire edges. */
export function assessLesson(document:CircuitDocument,lessonId=document.lessonId):LessonAssessment {
  if(lessonId&&/^motor-course-(?:0[1-9]|10)$/.test(lessonId))return assessMotorCourse(document,lessonId);
  const validation=validateDocument(document);
  if(!validation.valid)return {status:"failed",passed:0,total:1,checks:[{id:"valid",label:"电路文件有效",passed:false}],diagnostics:validation.errors.map(message=>diagnostic("INVALID_DOCUMENT",message))};
  if(!lessonId||!getLesson(lessonId))return {status:"unsupported",passed:0,total:0,checks:[],diagnostics:[diagnostic("LESSON_REQUIRED","请选择已支持的课程；自由接线只提供电气状态，不判定课程正确性","info")]};
  if(document.wires.length===0)return {status:"incomplete",passed:0,total:1,checks:[{id:"wiring",label:"完成课程接线",passed:false}],diagnostics:[diagnostic("NO_WIRES","尚未连接导线，请先完成主回路与控制回路","info")]};
  const {roles,diagnostics}=roleBindings(document,lessonId),checks:LessonCheck[]=[],trace:LessonTrace[]=[];
  const add=(id:string,label:string,passed:boolean,code?:string,message?:string,ids:string[]=[])=>{checks.push({id,label,passed});if(!passed&&code){const proof=roles.contactor&&["STOP_INEFFECTIVE","OVERLOAD_INEFFECTIVE","UNEXPECTED_START","UNEXPECTED_RESTART","JOG_RELEASE_FAILED"].includes(code)?loadEvidence(document,network(document,result.runtime),roles.contactor,code,message??label):diagnostic(code,message??label,"error",[],[],ids);proof.componentIds=[...new Set([...proof.componentIds,...ids])];diagnostics.push(proof);}};
  if(diagnostics.length)return {status:"incomplete",passed:0,total:1,checks:[{id:"roles",label:"所需器件与课程角色完整",passed:false}],diagnostics};
  let result=simulate(document,initialRuntime(document));
  let unsupported=!result.supported;
  const coveredLoads=new Set(lessonId.startsWith("motor")?[roles.contactor,roles.motor]:[roles.lamp]);
  const uncoveredLoads=document.components.filter(c=>getDefinition(c.type).load&&!coveredLoads.has(c.id));
  checks.push({id:"load-coverage",label:"所有负载均在当前课程判定范围内",passed:uncoveredLoads.length===0});
  if(uncoveredLoads.length){unsupported=true;diagnostics.push(diagnostic("LESSON_LOAD_UNCOVERED",`当前课程未定义这些额外负载的控制和保护目标：${uncoveredLoads.map(c=>c.label).join("、")}；保留自由运行结果，但不能判定整份电路合格`,"warning",uncoveredLoads.flatMap(c=>getDefinition(c.type).load!.terminals.map(t=>key(c.id,t))),[],uncoveredLoads.map(c=>c.id)));}
  const capture=(event:string,action?:SimulationAction)=>{unsupported ||= !result.supported;diagnostics.push(...result.diagnostics.filter(d=>d.severity!=="info").map(d=>({...d,event})));trace.push({event,action,powerOn:result.runtime.powerOn,faultLatched:result.runtime.faultLatched,components:result.components,diagnosticCodes:result.diagnostics.map(d=>d.code)});};
  const step=(action:SimulationAction,event:string)=>{result=simulate(document,result.runtime,action);capture(event,action);return result;};
  const fresh=()=>{result=simulate(document,initialRuntime(document));};
  const on=(role:string)=>!!result.components[roles[role]]?.active;
  const toggle=(role:string,event:string)=>step({type:"toggle",componentId:roles[role]},event);
  capture("初始状态");
  if(lessonId.startsWith("motor")){
    const selfHold=lessonId==="motor-self-hold";
    add("off","断路器断开时电机停止",!on("motor"),"UNEXPECTED_RUN","断路器断开时电机仍受电",[roles.motor]);
    toggle("breaker","合闸");add("idle","合闸后不自行启动",!on("motor")&&!on("contactor"),"UNEXPECTED_START","未按启动按钮即吸合或运行",[roles.contactor]);
    step({type:"press",componentId:roles.start},"按下启动");add("start","按下启动后接触器吸合、电机正向运行",on("contactor")&&on("motor")&&result.components[roles.motor]?.direction==="forward");
    const runningResult=result;
    step({type:"release",componentId:roles.start},"松开启动");add("release",selfHold?"松开启动后保持运行":"松开启动后立即停止",selfHold?(on("contactor")&&on("motor")):(!on("contactor")&&!on("motor")),selfHold?undefined:"JOG_RELEASE_FAILED",selfHold?undefined:"点动按钮已松开，但接触器或电机仍运行",[roles.start,roles.contactor]);
    if(selfHold){
      if(!on("motor"))diagnostics.push(diagnostic("SELF_HOLD_MISSING","启动释放后未保持；检查接触器 13-14 自锁支路","warning",[key(roles.contactor,"13"),key(roles.contactor,"14")]));
      step({type:"press",componentId:roles.stop},"按下停止");add("stop","停止按钮使接触器和电机释放",!on("contactor")&&!on("motor"),"STOP_INEFFECTIVE","停止按钮已断开，仍存在有效供电旁路",[roles.stop,roles.contactor]);
      step({type:"release",componentId:roles.stop},"释放停止");add("stop-release","释放停止后不会自行重启",!on("motor")&&!on("contactor"),"UNEXPECTED_RESTART");
    }
    fresh();toggle("breaker","过载测试合闸");step({type:"press",componentId:roles.start},"过载测试启动");
    if(selfHold)step({type:"release",componentId:roles.start},"过载测试释放启动");
    step({type:"trip-overload",componentId:roles.overload},"过载 TEST");add("overload","过载 TEST 使接触器和电机停止",!on("contactor")&&!on("motor"),"OVERLOAD_INEFFECTIVE","过载触点动作后线圈仍得电，检查保护触点是否被旁路",[roles.overload,roles.contactor]);
    step({type:"release",componentId:roles.start},"过载后松开启动");step({type:"reset-overload",componentId:roles.overload},"过载 RESET");add("reset","RESET 后需要重新按启动",!on("motor")&&!on("contactor"),"UNEXPECTED_RESTART");
    step({type:"press",componentId:roles.start},"复位后重新启动");add("restart","复位后能重新启动",on("motor")&&on("contactor"));step({type:"release",componentId:roles.start},"掉电前释放启动");
    step({type:"power",enabled:false},"切断电源");add("power-loss","电源消失时释放",!on("motor")&&!on("contactor"));step({type:"power",enabled:true},"恢复电源");add("power-restore","恢复电源不自行启动",!on("motor")&&!on("contactor"),"UNEXPECTED_RESTART");
    const peNet=network(document,runningResult.runtime,{protectiveOnly:true});add("earth","电机 PE 仅经导线和固定接线端子连接",peNet.connected(key(roles.source,"PE"),key(roles.motor,"PE")));
    for(const role of ["breaker","contactor","overload"]){
      // Removing only KM's power poles leaves auxiliary contacts in the graph:
      // a motor fed through 13-14 must remain detectable as a main-contact bypass.
      const cut=network(document,runningResult.runtime,role==="contactor"?{excludeMainContacts:roles[role]}:{excludeComponent:roles[role]});
      const isolated=["U","V","W"].every(t=>!cut.potentials(key(roles.motor,t)).some(phase));
      add(`main-${role}`,`主回路经过${role==="breaker"?"断路器":role==="contactor"?"接触器主触点":"过载检测通道"}`,isolated,role==="contactor"?undefined:"PROTECTION_BYPASS","主回路存在绕过指定保护/控制器件的路径",[roles[role],roles.motor]);
      if(!isolated&&role==="contactor")diagnostics.push(loadEvidence(document,cut,roles.motor,"MAIN_CONTACT_BYPASS","电机主回路存在绕过接触器主触点的供电路径；辅助触点不能代替主触点承载电机回路"));
    }
    const fuseCut=network(document,runningResult.runtime,{excludeComponent:roles.fuse});const coilV=voltage(fuseCut,key(roles.contactor,"A1"),key(roles.contactor,"A2"));add("control-fuse","控制回路经过熔断器",coilV.value===undefined||coilV.value===0,"PROTECTION_BYPASS","控制线圈的供电路径绕过了控制熔断器",[roles.fuse,roles.contactor]);
    const runningNet=network(document,runningResult.runtime),fusePotentials=runningNet.potentials(key(roles.fuse,"1"));add("fuse-phase","控制熔断器安装在相线导体",fusePotentials.some(phase),fusePotentials.includes("N")?"FUSE_ON_NEUTRAL":undefined,"控制熔断器未处于相线侧；不能只在 N 返回导体上设置熔断器",[roles.fuse]);
    // Exercise all reachable combinations, including held START + STOP and power restoration.
    // The lesson has a finite control vocabulary; extra contacts still participate in the solver.
    const audit=auditReachable(document,(before,next)=>{const state=next.runtime;return state.powerOn&&!state.faultLatched&&!!state.switches[roles.breaker]&&!state.overloads[roles.overload]&&(!selfHold||!state.pressed[roles.stop])&&(!!state.pressed[roles.start]||(selfHold&&!!before.contactors[roles.contactor]));},[roles.contactor,roles.motor]);
    unsupported ||= !audit.supported;add("reachable-behavior","同时按键、分合闸和失压恢复的所有可达状态符合目标",audit.passed);if(audit.diagnostic)diagnostics.push(audit.diagnostic);
  } else {
    const lamp=roles.lamp,source=roles.source;
    add("off","断路器断开时灯熄灭",!on("lamp"),"UNEXPECTED_RUN");toggle("breaker","照明合闸");
    if(lessonId==="lighting-single"){
      add("open","开关断开时灯熄灭",!on("lamp"),"SWITCH_INEFFECTIVE");toggle("switchA","闭合单控开关");add("on","开关闭合时灯点亮",on("lamp"));toggle("switchA","断开单控开关");add("off-again","再次断开时灯熄灭",!on("lamp"),"SWITCH_INEFFECTIVE");
    }else{
      // Both straight and crossed traveller pairs are equivalent; only change-on-toggle matters.
      for(const a of [false,true])for(const b of [false,true]){
        const base=initialRuntime(document);base.switches[roles.breaker]=true;base.switches[roles.switchA]=a;base.switches[roles.switchB]=b;result=simulate(document,base);capture(`双控组合 ${Number(a)}${Number(b)}`);const before=on("lamp");
        const original=result.runtime;step({type:"toggle",componentId:roles.switchA},"切换 S1");const aChanged=on("lamp")!==before;
        result=simulate(document,original,{type:"toggle",componentId:roles.switchB});capture("切换 S2");add(`combination-${Number(a)}${Number(b)}`,`组合 ${Number(a)}${Number(b)}：两处均可改变灯状态`,aChanged&&on("lamp")!==before);
      }
    }
    const permanent=network(document,result.runtime,{neutralOnly:true});add("neutral","灯的 N 端仅经导线和普通固定端子返回",permanent.connected(key(lamp,"N"),key(source,"N")),"SWITCHED_NEUTRAL","灯的中性线须经导线或普通固定端子直接返回，不能经过开关、熔断器、其他器件内部通道或保护地端子",[lamp]);
    const cut=network(document,result.runtime,{excludeComponent:roles.breaker});add("breaker-protection","相线经过断路器",!cut.potentials(key(lamp,"L")).some(phase),"PROTECTION_BYPASS","照明相线绕过断路器",[roles.breaker,lamp]);
    const baseline=initialRuntime(document);baseline.switches[roles.breaker]=true;const sameThrowLit=!!simulate(document,baseline).components[lamp]?.active;
    const audit=auditReachable(document,(_before,next)=>{const state=next.runtime,control=lessonId==="lighting-single"?!!state.switches[roles.switchA]:(state.switches[roles.switchA]===state.switches[roles.switchB]?sameThrowLit:!sameThrowLit);return state.powerOn&&!state.faultLatched&&!!state.switches[roles.breaker]&&control;},[lamp]);
    unsupported ||= !audit.supported;add("reachable-behavior","所有开关及电源操作均无危险旁路并符合照明目标",audit.passed);if(audit.diagnostic)diagnostics.push(audit.diagnostic);
  }
  const severe=diagnostics.some(d=>d.severity==="error");
  const safe=!diagnostics.some(d=>d.severity==="error"||d.code==="PE_MISSING"||d.code==="MOTOR_PHASE_MISSING");add("safety","无短路、电压错误、缺相、保护接地缺失或失效保护",safe);
  const passed=checks.filter(c=>c.passed).length;
  return {status:unsupported?"unsupported":passed===checks.length?"passed":severe?"failed":"incomplete",passed,total:checks.length,checks,diagnostics:uniqueDiagnostics(diagnostics),trace};
}
