import type { CircuitComponent, CircuitDocument, CircuitWire, ComponentType, LessonDefinition, TerminalRef } from "./types";
import { MOTOR_COURSES, isMotorCourse } from "./motor-courses";
import { createMotorPracticeDocument } from "./motor-practice-layout";
import { isLayoutObject } from "./catalog";
import { arrangeTrainingDucts, putWiresInDucts } from "./duct-layout";

export const LESSONS: LessonDefinition[] = [
  ...MOTOR_COURSES,
  { id: "motor-jog", title: "电机点动控制", category:"industrial", description:"220V 线圈，按下启动按钮运行，松开立即停止。", objective:"完成三相主回路、瞬时控制和保护接地，并验证过载保护。", componentTypes:["supply","breaker3","contactor220","overload","fuse","push-no","motor","pe-terminal"] },
  { id: "motor-self-hold", title: "电机自锁启停控制", category:"industrial", description:"380V 线圈，以常开辅助触点保持运行，停止与过载均可释放。", objective:"启动、释放保持、停止、过载复位和失压后不自行重启。", componentTypes:["supply","breaker3","contactor380","overload","fuse","push-no","push-nc","motor","pe-terminal"] },
  { id: "lighting-single", title: "单控照明电路", category:"lighting", description:"一个开关控制一盏 220V 灯，开关接在相线。", objective:"合闸后用单控开关点亮和熄灭灯，中性线保持直接回路。", componentTypes:["supply","breaker1","switch1","lamp"] },
  { id: "lighting-two-way", title: "双控照明电路", category:"lighting", description:"两只双控开关通过两根联络线，从两处切换灯的状态。", objective:"遍历四种开关组合，每次切换任一开关均改变灯状态。", componentTypes:["supply","breaker1","switch2","switch2","lamp"] },
];
export const getLesson = (id: string) => LESSONS.find((lesson) => lesson.id === id);
const component = (id: string, type: ComponentType, label: string, x: number, y: number): CircuitComponent => ({ id, type, label, position:{x,y} });
const ref = (componentId: string, terminalId: string): TerminalRef => ({componentId,terminalId});

export function createLessonDocument(id: string, options: { wired?: boolean; placement?: "automatic" | "manual" } = {}): CircuitDocument {
  if (isMotorCourse(id)) return createMotorPracticeDocument(id, options);
  const lesson = getLesson(id);
  if (!lesson) throw new Error(`未知课程：${id}`);
  const wires: CircuitWire[] = [];
  const connect = (a: string, at: string, b: string, bt: string, color = "#f04452") => wires.push({id:`wire-${wires.length + 1}`,from:ref(a,at),to:ref(b,bt),color,style:"orthogonal"});
  let components: CircuitComponent[];
  let roles: Record<string,string>;
  if (lesson.category === "industrial") {
    const selfHold = id === "motor-self-hold";
    components = [component("source","supply","电源",95,15),component("breaker","breaker3","QF1",145,135),component("km",selfHold?"contactor380":"contactor220","KM1",150,400),component("fr","overload","FR1",145,655),component("motor","motor","M1",35,880),component("fuse","fuse","FU1",470,145),component("start","push-no","SB2",620,620),component("pe","pe-terminal","PE1",-55,710)];
    if (selfHold) components.push(component("stop","push-nc","SB1",465,395));
    roles = {source:"source",breaker:"breaker",contactor:"km",overload:"fr",start:"start",motor:"motor",fuse:"fuse",earth:"pe",...(selfHold?{stop:"stop"}:{})};
    ["L1","L2","L3"].forEach((phase,i) => {
      const input = String(i*2+1), output = String(i*2+2), color = ["#e7b000","#20b963","#f04452"][i];
      connect("source",phase,"breaker",input,color); connect("breaker",output,"km",input,color); connect("km",output,"fr",input,color); connect("fr",output,"motor",["U","V","W"][i],color);
    });
    connect("source","PE","pe","A","#659f2f"); connect("pe","B","motor","PE","#659f2f");
    connect("breaker","2","fuse","1");
    if (selfHold) { connect("fuse","2","stop","11"); connect("stop","12","fr","95"); }
    else connect("fuse","2","fr","95");
    connect("fr","96","start","23"); connect("start","24","km","A1");
    connect("km","A2",selfHold?"breaker":"source",selfHold?"4":"N","#3478f6");
    if (selfHold) {connect("start","23","km","13");connect("start","24","km","14");}
  } else {
    const twoWay=id==="lighting-two-way";
    components=[component("source","supply","电源",140,35),component("breaker","breaker1","QF1",210,170),component("switchA",twoWay?"switch2":"switch1","S1",160,445),component("lamp","lamp","EL1",525,185)];
    if(twoWay) components.push(component("switchB","switch2","S2",450,445));
    roles={source:"source",breaker:"breaker",switchA:"switchA",lamp:"lamp",...(twoWay?{switchB:"switchB"}:{})};
    connect("source","L1","breaker","1");connect("breaker","2","switchA",twoWay?"C":"1");connect("lamp","N","source","N","#3478f6");
    if(twoWay){connect("switchA","1","switchB","1","#f59e0b");connect("switchA","2","switchB","2","#f59e0b");connect("switchB","C","lamp","L");}
    else connect("switchA","2","lamp","L");
  }
  const next = putWiresInDucts(arrangeTrainingDucts({schemaVersion:1,title:lesson.title,lessonId:id,components,wires:options.wired?wires:[],roles}));
  return options.placement === "manual" ? {...next,components:next.components.filter(c=>isLayoutObject(c.type)),wires:[],roles:{}} : next;
}
