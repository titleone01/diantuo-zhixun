import type { Diagnostic } from "../core/types";

/** An open coil feed is a runtime observation, not proof of missing wiring. */
export function presentDiagnostics(diagnostics: readonly Diagnostic[]) {
  return {
    runtime: diagnostics.filter(item => item.severity === "info"),
    safety: diagnostics.filter(item => item.severity !== "info"),
  };
}
