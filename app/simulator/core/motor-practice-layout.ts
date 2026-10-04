import { arrangeTrainingDucts, putWiresInDucts } from "./duct-layout";
import { createMotorCourseDocument } from "./motor-courses";
import type { CircuitDocument } from "./types";

/** New editable practices share the reference layout; saved documents are never rearranged here. */
export function createMotorPracticeDocument(id: string, options: { wired?: boolean } = {}): CircuitDocument {
  const document = createMotorCourseDocument(id, options);
  document.components = document.components.filter(component => component.id !== "fu2a" && component.id !== "fu2b");
  document.components.push({ id: "fu2", type: "fuse2", label: "FU2", position: { x: 0, y: 0 } });
  if (document.roles) {
    delete document.roles.fu2a;
    delete document.roles.fu2b;
    document.roles.fu2 = "fu2";
  }
  for (const wire of document.wires) for (const ref of [wire.from, wire.to]) {
    if (ref.componentId === "fu2a") ref.componentId = "fu2";
    else if (ref.componentId === "fu2b") {
      ref.componentId = "fu2";
      ref.terminalId = ref.terminalId === "1" ? "3" : "4";
    }
  }
  document.components.push({ id: "xt16", type: "terminal-strip16", label: "XT（16位）", position: { x: 0, y: 0 } });
  return putWiresInDucts(arrangeTrainingDucts(document));
}
