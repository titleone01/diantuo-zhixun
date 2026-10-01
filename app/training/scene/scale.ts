/**
 * Physical scale contract for the unified 3D wiring scene.
 *
 * Every manufacturer model, mounting plate, DIN rail and wire duct must use
 * this conversion. Visual compensation scaling is intentionally forbidden.
 */
export const SCENE_UNITS_PER_MM = 0.05;

export const mmToScene = (millimeters: number) => millimeters * SCENE_UNITS_PER_MM;

export const sceneToMm = (sceneUnits: number) => sceneUnits / SCENE_UNITS_PER_MM;
