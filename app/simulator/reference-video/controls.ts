export const VIDEO_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** Native media can report NaN/Infinity before its metadata is available. */
export function videoSeekTarget(currentTime: number, duration: number, seconds: number): number | null {
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(seconds)) return null;
  return Math.max(0, Math.min(duration, currentTime + seconds));
}
