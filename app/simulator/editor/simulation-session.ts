import { initialRuntime, simulate } from "../core/engine";
import { getDefinition } from "../core/catalog";
import type { CircuitDocument, SimulationAction, SimulationResult } from "../core/types";

type ActionTrace = {
  sequence: number;
  action: SimulationAction;
  pressed: string[];
  activeCoils: string[];
  motors: Record<string, { state: string; direction?: "forward" | "reverse" }>;
};

/** Event-owned state: React may batch rendering, but must never rewind a completed electrical action. */
export function createSimulationSession() {
  let document: CircuitDocument | null = null;
  let current: SimulationResult | null = null;
  let generation = 0;
  let sequence = 0;
  let trace: ActionTrace[] = [];
  return {
    get current() { return current; },
    get generation() { return generation; },
    get trace(): readonly ActionTrace[] { return trace; },
    clear() { generation++; document = null; current = null; sequence = 0; trace = []; },
    start(next: CircuitDocument) {
      const result = simulate(next, initialRuntime(next, true));
      generation++; document = next; current = result; sequence = 0; trace = [];
      return result;
    },
    dispatch(action: SimulationAction, expectedGeneration: number) {
      if (!document || !current || expectedGeneration !== generation) return null;
      current = simulate(document, current.runtime, action);
      if (action.type !== "advance-time") {
        trace = [...trace.slice(-23), {
          sequence: ++sequence,
          action: { ...action },
          pressed: Object.keys(current.runtime.pressed).filter(id => current!.runtime.pressed[id]),
          activeCoils: Object.keys(current.runtime.contactors).filter(id => current!.runtime.contactors[id]),
          motors: Object.fromEntries(document.components.filter(component => getDefinition(component.type).load?.kind === "motor").map(component => [component.id, { state: current!.components[component.id].state, direction: current!.components[component.id].direction }])),
        }];
      }
      return current;
    },
  };
}
