import { createMotorCourseDocument } from "./motor-courses";
import type { CircuitComponent, CircuitDocument, Point } from "./types";

/** Editable teaching placement, following the ten drawings' layers and left/right relations. */
export function createMotorPracticeDocument(id: string, options: {wired?:boolean}={}): CircuitDocument {
  const document=createMotorCourseDocument(id,options);
  const number=Number(id.slice(-2));
  document.components=document.components.filter(c=>c.id!=="fu2a"&&c.id!=="fu2b");
  document.components.push({id:"fu2",type:"fuse2",label:"FU2",position:{x:570,y:120}});
  if(document.roles){delete document.roles.fu2a;delete document.roles.fu2b;document.roles.fu2="fu2";}
  for(const wire of document.wires)for(const ref of [wire.from,wire.to]){
    if(ref.componentId==="fu2a")ref.componentId="fu2";
    else if(ref.componentId==="fu2b"){ref.componentId="fu2";ref.terminalId=ref.terminalId==="1"?"3":"4";}
  }
  const positions:Record<string,Point>={source:{x:60,y:-110},qf:{x:80,y:120},fu1:{x:330,y:120},fu2:{x:570,y:120},pe:{x:1030,y:1200}};
  const place=(ids:string[],x:number,y:number,dx:number,dy=0)=>ids.forEach((key,i)=>positions[key]={x:x+i*dx,y:y+i*dy});
  place(document.components.filter(c=>c.type.startsWith("contactor")).map(c=>c.id),80,440,230);
  place(document.components.filter(c=>c.type==="overload").map(c=>c.id),100,835,280);
  place(document.components.filter(c=>c.type.startsWith("motor")).map(c=>c.id),80,1370,420);
  place(document.components.filter(c=>c.type.startsWith("push-")).map(c=>c.id),1050,440,0,220);
  place(document.components.filter(c=>c.type==="limit-switch").map(c=>c.id),740,110,100);
  place(document.components.filter(c=>c.type==="auxiliary-no").map(c=>c.id),650,465,90);
  if(number===7){positions.sb1={x:930,y:440};positions.sb2={x:1060,y:440};positions.sb3={x:930,y:850};positions.sb4={x:1060,y:850};}
  if(number===8){positions.ka={x:80,y:440};positions.km={x:310,y:440};positions.kt={x:570,y:440};}
  if(number===9)positions.kt={x:570,y:835};
  document.components=document.components.map(c=>({...c,position:positions[c.id]??c.position}));
  const helper=(component:CircuitComponent)=>document.components.push(component);
  helper({id:"xt16",type:"terminal-strip16",label:"XT（16位）",position:{x:70,y:1200}});
  for(const [i,y] of [50,370,740,1080].entries())helper({id:`duct-h${i+1}`,type:"wire-duct",label:`WD${i+1}`,position:{x:0,y},size:{width:1230,height:36}});
  helper({id:"duct-left",type:"wire-duct-vertical",label:"WD5",position:{x:0,y:50},size:{width:36,height:1066}});
  helper({id:"duct-right",type:"wire-duct-vertical",label:"WD6",position:{x:1194,y:50},size:{width:36,height:1066}});
  return document;
}
