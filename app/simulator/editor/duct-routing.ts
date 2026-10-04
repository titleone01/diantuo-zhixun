import { routeWireInDucts, type DuctRoute as WorldDuctRoute } from "../core/duct-routing";
import type { CircuitDocument, CircuitWire, Point } from "../core/types";

/** Editor compatibility adapter; all paths come from the shared world router. */
export type DuctRoute = WorldDuctRoute & { points?: Point[]; reason?: "no-ducts" | "disconnected" };

export function usesDuctRouting(wire: CircuitWire): boolean {
  // Old third-task files predate routing and used style:"duct". The validator
  // normalizes saved/imported input, but previews may receive it directly.
  return wire.routing === "duct" || (wire.style as string | undefined) === "duct";
}

export function ductWireRoute(document: CircuitDocument, wire: CircuitWire): DuctRoute {
  const route = routeWireInDucts(document, wire);
  return {
    ...route,
    ...(route.status === "routed"
      ? { points: route.sections[0] }
      : { reason: route.status === "missing" ? "no-ducts" as const : "disconnected" as const }),
  };
}
