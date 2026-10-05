import { createLessonDocument } from "./lessons";
import { equivalentComponentType } from "./catalog";
import type { CircuitComponent, CircuitDocument } from "./types";

export function courseRequirements(lessonId?: string) {
  if(!lessonId)return [];
  const template=createLessonDocument(lessonId);
  return Object.entries(template.roles??{}).map(([role,id])=>({role,component:template.components.find(c=>c.id===id)!})).filter(entry=>!!entry.component);
}
export function bindCourseRole(document:CircuitDocument, componentId:string, role:string):CircuitDocument {
  const component=document.components.find(c=>c.id===componentId);
  if(!component)throw new Error("元件已不存在");
  const roles={...document.roles};
  if(!role){for(const name of Object.keys(roles))if(roles[name]===componentId)delete roles[name];return {...document,roles};}
  const expected=courseRequirements(document.lessonId).find(entry=>entry.role===role);
  if(!expected||!equivalentComponentType(component.type,expected.component.type))throw new Error("此元件类型与课程位号不匹配");
  if(roles[role]&&roles[role]!==componentId)throw new Error("此课程位号已被占用，请先解除原绑定");
  if(Object.entries(roles).some(([name,id])=>name!==role&&id===componentId))throw new Error("此元件已有课程位号，请先解除绑定");
  const bound = {...roles,[role]:componentId};
  const requirements = courseRequirements(document.lessonId);
  // Checklist placement order is arbitrary. Fill an unassociated auxiliary
  // only from explicit bound roles, never from its display name.
  const components = document.components.map(current => {
    if (current.type !== "auxiliary-no" || current.linkedTo) return current;
    const requirement = requirements.find(entry => bound[entry.role] === current.id);
    const owner = requirements.find(entry => entry.component.id === requirement?.component.linkedTo);
    return owner && bound[owner.role] ? {...current,linkedTo:bound[owner.role]} : current;
  });
  return {...document,components,roles:bound};
}
export function addCourseComponent(document:CircuitDocument,role:string,component:CircuitComponent):CircuitDocument {
  return bindCourseRole({...document,components:[...document.components,component]},component.id,role);
}
