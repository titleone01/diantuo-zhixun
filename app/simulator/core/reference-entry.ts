import { getReferenceDrawing } from "./reference-drawings";
import type { CircuitDocument } from "./types";

export type ReferenceEntryIntent = { kind: "none" } | { kind: "invalid" } | { kind: "reference"; id: number };

/** An entry request, never a command to rebuild the canvas on every render. */
export function parseReferenceEntry(pathname: string, search: string): ReferenceEntryIntent {
  if (pathname !== "/" && pathname.replace(/\/$/, "") !== "/circuit") return { kind: "none" };
  const values = new URLSearchParams(search).getAll("diagram");
  if (!values.length) return { kind: "none" };
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0])) return { kind: "invalid" };
  const id = Number(values[0]);
  return Number.isSafeInteger(id) && getReferenceDrawing(id) ? { kind: "reference", id } : { kind: "invalid" };
}

export type ReferenceEntryDecision = "preserve" | "confirm" | "apply";
export type ReferenceEntryContext = {
  /** Must come from a validated reference intent, after account recovery finishes. */
  requestedId: number;
  currentDocument: Pick<CircuitDocument, "referenceDiagramId" | "wires">;
  hasRecovery: boolean;
  dirty: boolean;
  saved: { id: string } | null;
};

/** Query changes select context; they do not override matching recovered wiring. */
export function resolveReferenceEntry({ requestedId, currentDocument, hasRecovery, dirty, saved }: ReferenceEntryContext): ReferenceEntryDecision {
  if (currentDocument.referenceDiagramId === requestedId) return "preserve";
  if (dirty || (saved === null && hasRecovery && currentDocument.wires.length > 0)) return "confirm";
  return "apply";
}
