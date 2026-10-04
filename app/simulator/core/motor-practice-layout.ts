import { createMotorCourseDocument } from "./motor-courses";
import type { CircuitDocument } from "./types";
import { isWireDuct } from "./catalog";
import { arrangeTrainingDucts, putWiresInDucts } from "./duct-layout";

/** Editable teaching placement, following the ten drawings' layers and left/right relations. */
export function createMotorPracticeDocument(id: string, options: {wired?:boolean}={}): CircuitDocument {
  const document=createMotorCourseDocument(id,options);
  document.components = document.components.filter(c => !isWireDuct(c.type));
  document.components=document.components.filter(c=>c.id!=="fu2a"&&c.id!=="fu2b");
  document.components.push({id:"fu2",type:"fuse2",label:"FU2",position:{x:570,y:120}});
  if(document.roles){delete document.roles.fu2a;delete document.roles.fu2b;document.roles.fu2="fu2";}
  for(const wire of document.wires)for(const ref of [wire.from,wire.to]){
    if(ref.componentId==="fu2a")ref.componentId="fu2";
    else if(ref.componentId==="fu2b"){ref.componentId="fu2";ref.terminalId=ref.terminalId==="1"?"3":"4";}
  }
  document.components.push({id:"xt16",type:"terminal-strip16",label:"XT（16位）",position:{x:70,y:1200}});
  return putWiresInDucts(arrangeTrainingDucts(document));
}
