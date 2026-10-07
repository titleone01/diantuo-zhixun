import type { Position } from "@xyflow/react";
import { componentSize, getDefinition, transformedTerminal } from "../core/catalog";
import type { CircuitComponent } from "../core/types";
import type { ElectricalNode } from "./DeviceNode";

/** Keep edge initialization independent of DOM measurement during simulation updates. */
export function deviceNodeGeometry(component: CircuitComponent): Pick<ElectricalNode, "width" | "height" | "measured" | "handles"> {
  const size = componentSize(component);
  return {
    ...size,
    measured: size,
    handles: getDefinition(component.type).terminals.map(original => {
      const terminal = transformedTerminal(component, original);
      // A zero-size logical handle denotes the exact screw center. The visible
      // Handle still supplies its own hit area for actual pointer connections.
      return { id: terminal.id, type: "source", position: terminal.side as Position, x: terminal.x, y: terminal.y, width: 0, height: 0 };
    }),
  };
}
