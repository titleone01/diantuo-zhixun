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

export type ReferenceEntryDecision = "preserve";
export type ReferenceEntryContext = {
  /** Must come from a validated reference intent, after account recovery finishes. */
  requestedId: number;
  currentDocument: Pick<CircuitDocument, "referenceDiagramId" | "wires">;
  hasRecovery: boolean;
  dirty: boolean;
  saved: { id: string } | null;
};

/** Retired URLs remain recognizable, but never create or replace a workspace. */
export function resolveReferenceEntry(context: ReferenceEntryContext): ReferenceEntryDecision {
  void context; // Preserve the historical caller contract without creating documents.
  return "preserve";
}
