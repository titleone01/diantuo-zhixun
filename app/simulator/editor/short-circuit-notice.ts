import type { Diagnostic, SimulationResult } from '../core/types';

const SHORT_CODES = new Set(['PHASE_SHORT', 'PHASE_NEUTRAL_SHORT', 'PHASE_EARTH_SHORT']);
/** Only the user's live, latched short circuit may open the warning, not lesson-copy diagnostics. */
export function shortCircuitDiagnostic(result: SimulationResult | null): Diagnostic | null {
  if (!result?.runtime.faultLatched) return null;
  return (result.runtime.latchedDiagnostics ?? result.diagnostics).find(diagnostic => SHORT_CODES.has(diagnostic.code)) ?? null;
}
export function shortCircuitNoticeKey(generation: number, diagnostic: Diagnostic): string {
  return JSON.stringify([generation, diagnostic.code, [...diagnostic.terminalIds].sort(), [...diagnostic.wireIds].sort()]);
}
