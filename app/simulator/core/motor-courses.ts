import type { CircuitComponent, CircuitDocument, CircuitWire, ComponentType, LessonDefinition } from './types';
import { arrangeTrainingDucts, putWiresInDucts } from './duct-layout';

/** Transcribed from the user's ten schematic/placement pairs; source PNGs remain private R2 media. */
const TITLES = ['电动机点动控制电路', '电动机连续运行控制电路', '电动机点动与连续运行控制电路', '电动机接触器互锁正反转控制电路', '电动机双重联锁正反转控制电路', '电动机自动往返控制电路', '两台电动机顺序控制电路', '电动机延时起动控制电路', 'Y-△降压起动控制电路', '双速电机控制电路'];
const OBJECTIVES = [
  '按住 SB 运行、松开停止；两路 FU2 保护 380V 控制回路。',
  'SB2 启动并保持，SB1 停止；FR 动作和失压后不自动重启。',
  'SB2 连续运行，SB3 点动；SB3 释放时切断保持，SB1 停止。',
  'KM1/KM2 电气互锁；须先按 SB3 停止，再启动另一方向。',
  '按钮与接触器双重联锁；SB1 正转、SB2 反转、SB3 停止。',
  'SQ1/SQ2 触发换向，SQ3/SQ4 分别限制一个方向；手动触发限位教学。',
  '先启动 M1 才能启动 M2；先停止 M2 才能停止 M1。',
  'KA 保持、KT 延时后 KM 启动；KM 保持并切断 KA/KT 支路。',
  '先星形起动，延时后先断星形再转三角形；停止、过载和失压释放。',
  'SB2 低速 Δ，SB3 高速 YY；KM1 与 KM2/KM3 互锁，停止后释放。',
];
export const MOTOR_COURSES: LessonDefinition[] = TITLES.map((title, i) => ({id:`motor-course-${String(i+1).padStart(2,'0')}`, title, category:'industrial', description:OBJECTIVES[i], objective:OBJECTIVES[i], componentTypes:[]}));
export const isMotorCourse = (id?: string) => !!id && MOTOR_COURSES.some(lesson => lesson.id === id);
type Port = [string, string];
const INPUTS = ['1','3','5'], OUTPUTS = ['2','4','6'], PHASES = ['L1','L2','L3'];
const COLORS = ['#e7b000','#20b963','#f04452'];

export function createMotorCourseDocument(id: string, {wired=false}: {wired?:boolean} = {}): CircuitDocument {
  const index = MOTOR_COURSES.findIndex(lesson => lesson.id === id);
  if (index < 0) throw new Error(`未知电机课程：${id}`);
  const n = index + 1, components: CircuitComponent[] = [], wires: CircuitWire[] = [];
  const add = (id:string,type:ComponentType,label:string,x:number,y:number,extra:Partial<CircuitComponent>={}) => {components.push({id,type,label,position:{x,y},...extra});};
  const net = (ports:Port[], color='#f04452') => {
    for(let i=1;i<ports.length;i++) wires.push({id:`wire-${wires.length+1}`,from:{componentId:ports[0][0],terminalId:ports[0][1]},to:{componentId:ports[i][0],terminalId:ports[i][1]},color,style:'orthogonal'});
  };
  const join = (a:string,at:string,b:string,bt:string,color?:string) => net([[a,at],[b,bt]],color);
  const coil = (id:string) => join(id,'A2','fu2b','2',COLORS[1]);
  const button = (id:string,stop=false,x=650,y=400) => add(id,stop?'push-nc':'push-no',id.toUpperCase(),x,y);
  const contactor = (id:string,label=id.toUpperCase(),x=80,y=580) => {add(id,'contactor380',label,x,y);coil(id);};
  const overload = (id:string,x=60,y=835) => add(id,'overload',id.toUpperCase(),x,y);
  const motor = (id:string,type:ComponentType='motor',x=0,y=1110) => {add(id,type,id.toUpperCase(),x,y);join('pe','B',id,'PE','#659f2f');};
  const auxiliary = (id:string,linkedTo:string,x:number,y:number) => add(id,'auxiliary-no',`${linkedTo.toUpperCase()} 辅助`,x,y,{linkedTo});
  add('source','supply','三相电源',40,0);add('qf','breaker3','QF',70,115);
  add('pe','pe-terminal','PE',-100,880);join('source','PE','pe','A','#659f2f');
  add('fu1','fuse3','FU1（三联）',50,340);
  INPUTS.forEach((port,i)=>{join('source',PHASES[i],'qf',port,COLORS[i]);join('qf',OUTPUTS[i],'fu1',port,COLORS[i]);});
  add('fu2a','fuse','FU2-1',500,115);add('fu2b','fuse','FU2-2',575,115);
  join('qf','2','fu2a','1',COLORS[0]);join('qf','4','fu2b','1',COLORS[1]);
  const feedKM = (km:string,reverse=false) => OUTPUTS.forEach((port,i)=>join('fu1',port,km,INPUTS[reverse?2-i:i],COLORS[i]));
  const kmToFR = (km:string,fr:string) => OUTPUTS.forEach((port,i)=>join(km,port,fr,INPUTS[i],COLORS[i]));
  const frToM = (fr:string,m:string,six=false) => OUTPUTS.forEach((port,i)=>join(fr,port,m,(six?['U1','V1','W1']:['U','V','W'])[i],COLORS[i]));
  const supplyControl = (fr:string,stop:string):Port => {join('fu2a','2',fr,'95');join(fr,'96',stop,'11');return [stop,'12'];};
  const latch = (input:Port,start:string,km:string) => {net([input,[start,'23'],[km,'13']]);net([[start,'24'],[km,'14'],[km,'A1']]);};

  if(n<=3) {
    contactor('km');feedKM('km');motor('m','motor',0,n===1?880:1110);
    if(n===1) {
      OUTPUTS.forEach((port,i)=>join('km',port,'m',['U','V','W'][i],COLORS[i]));
      button('sb',false,680,520);join('fu2a','2','sb','23');join('sb','24','km','A1');
    } else {
      overload('fr');kmToFR('km','fr');frToM('fr','m');button('sb1',true,680,340);button('sb2',false,680,590);
      const input=supplyControl('fr','sb1');
      if(n===2) latch(input,'sb2','km');
      else {
        button('sb3',false,860,590);
        net([input,['sb2','23'],['sb3','23'],['sb3','11']]);
        join('sb3','12','km','13');net([['sb2','24'],['sb3','24'],['km','14'],['km','A1']]);
      }
    }
  } else if(n<=6) {
    contactor('km1','KM1',30,550);contactor('km2','KM2',300,550);feedKM('km1');feedKM('km2',true);
    overload('fr',150,820);kmToFR('km1','fr');kmToFR('km2','fr');motor('m','motor',115,1070);frToM('fr','m');
    button('sb3',true,690,345);button('sb1',false,590,620);button('sb2',false,870,620);
    const input=supplyControl('fr','sb3');
    net([input,['sb1','23'],['km1','13'],['sb2','23'],['km2','13']]);
    const left:Port[]=[['sb1','24'],['km1','14']],right:Port[]=[['sb2','24'],['km2','14']];
    if(n===4) {net([...left,['km2','21']]);net([...right,['km1','21']]);}
    if(n===5) {net([...left,['sb2','11']]);join('sb2','12','km2','21');net([...right,['sb1','11']]);join('sb1','12','km1','21');}
    if(n===6) {
      for(let i=1;i<=4;i++) add(`sq${i}`,'limit-switch',`SQ${i}`,570+(i%2)*290,910+Math.floor((i-1)/2)*230);
      net([input,['sq2','23'],['sq1','23']]);net([...left,['sq2','24'],['sq1','11']]);net([...right,['sq1','24'],['sq2','11']]);
      join('sq1','12','sq3','11');join('sq3','12','km2','21');join('sq2','12','sq4','11');join('sq4','12','km1','21');
    }
    join('km2','22','km1','A1');join('km1','22','km2','A1');
  } else if(n===7) {
    contactor('km1','KM1',15,540);contactor('km2','KM2',320,540);feedKM('km1');feedKM('km2');
    overload('fr1',0,800);overload('fr2',320,800);kmToFR('km1','fr1');kmToFR('km2','fr2');
    motor('m1','motor',-50,1080);motor('m2','motor',320,1080);frToM('fr1','m1');frToM('fr2','m2');
    button('sb1',true,700,380);button('sb2',true,930,380);button('sb3',false,700,650);button('sb4',false,930,650);
    auxiliary('km1_aux','km1',580,900);auxiliary('km2_aux','km2',1030,900);
    join('fu2a','2','fr1','95');join('fr1','96','fr2','95');net([['fr2','96'],['sb1','11'],['km2_aux','13'],['sb2','11']]);
    net([['sb1','12'],['km2_aux','14'],['sb3','23'],['km1','13']]);net([['sb3','24'],['km1','14'],['km1','A1']]);
    net([['sb2','12'],['sb4','23'],['km2','13']]);net([['sb4','24'],['km2','14'],['km1_aux','13']]);join('km1_aux','14','km2','A1');
  } else if(n===8) {
    contactor('km');feedKM('km');overload('fr');kmToFR('km','fr');motor('m');frToM('fr','m');
    button('sb2',true,680,360);button('sb1',false,680,630);
    add('ka','relay380','KA',410,700);add('kt','timer380','KT',880,700,{settings:{delayMs:3000}});coil('ka');coil('kt');
    const input=supplyControl('fr','sb2');net([input,['sb1','23'],['ka','13'],['kt','25'],['km','13']]);
    net([['sb1','24'],['ka','14'],['km','21']]);net([['km','22'],['ka','A1'],['kt','A1']]);net([['kt','28'],['km','14'],['km','A1']]);
  } else if(n===9) {
    contactor('km','KM',0,570);contactor('kmy','KMY',315,880);contactor('kmd','KM△',315,570);feedKM('km');
    overload('fr',0,830);kmToFR('km','fr');motor('m','motor-star-delta',0,1110);frToM('fr','m',true);
    const heads=['U1','V1','W1'],tails=['W2','U2','V2'];
    heads.forEach((head,i)=>{join('m',head,'kmd',INPUTS[i],COLORS[i]);join('kmd',OUTPUTS[i],'m',tails[i],COLORS[i]);join('m',['U2','V2','W2'][i],'kmy',INPUTS[i],COLORS[i]);});
    net([['kmy','2'],['kmy','4'],['kmy','6']],'#667085');
    button('sb2',true,730,350);button('sb1',false,730,620);add('kt','timer380','KT',930,700,{settings:{delayMs:3000}});coil('kt');
    const input=supplyControl('fr','sb2');latch(input,'sb1','km');net([['km','A1'],['kmd','21'],['kmy','21']]);
    net([['kmd','22'],['kt','A1'],['kt','15']]);join('kt','16','kmy','A1');net([['kmy','22'],['kt','25'],['kmd','13']]);net([['kt','28'],['kmd','14'],['kmd','A1']]);
  } else {
    contactor('km1','KM1',0,820);contactor('km2','KM2',250,820);contactor('km3','KM3',0,1080);
    overload('fr',130,565);OUTPUTS.forEach((port,i)=>join('fu1',port,'fr',INPUTS[i],COLORS[i]));
    OUTPUTS.forEach((port,i)=>{join('fr',port,'km1',INPUTS[i],COLORS[i]);join('fr',port,'km2',INPUTS[i],COLORS[i]);});
    motor('m','motor-dahlander',240,1330);
    OUTPUTS.forEach((port,i)=>{join('km1',port,'m',['U1','V1','W1'][i],COLORS[i]);join('km2',port,'m',['U2','V2','W2'][i],COLORS[i]);join('km3',port,'m',['U1','V1','W1'][i],COLORS[i]);});
    net([['km3','1'],['km3','3'],['km3','5']],'#667085');
    button('sb1',true,770,360);button('sb2',false,650,650);button('sb3',false,930,650);
    const input=supplyControl('fr','sb1');net([input,['sb2','23'],['km1','13'],['sb3','23'],['km2','13']]);
    net([['sb2','24'],['km1','14'],['sb3','11']]);join('sb3','12','km2','21');join('km2','22','km1','A1');
    net([['sb3','24'],['km2','14'],['sb2','11']]);join('sb2','12','km1','21');net([['km1','22'],['km2','A1'],['km3','A1']]);
  }
  return putWiresInDucts(arrangeTrainingDucts({schemaVersion:1,title:TITLES[index],lessonId:id,trainingProjectId:`project-${String(n).padStart(2,'0')}`,components,wires:wired?wires:[],roles:Object.fromEntries(components.map(component=>[component.id,component.id]))}));
}

for (const lesson of MOTOR_COURSES) lesson.componentTypes=[...new Set(createMotorCourseDocument(lesson.id).components.map(component=>component.type))];
