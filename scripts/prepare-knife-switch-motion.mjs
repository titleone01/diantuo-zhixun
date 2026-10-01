import { readFile, writeFile } from 'node:fs/promises';

// The public source's original q artwork (208.5 × 292) uses these exact paths.
// Preserve its geometry and pin circles; only tag the original moving paths.
const original = await readFile(new URL('../public/sim-assets/knife-switch3.svg', import.meta.url), 'utf8');
const starts = { 8: 'M192.499,132.999', 9: 'M192.499,146.999', 16: 'M3.652,100.822', 17: 'M79.653,100.822', 18: 'M155.653,100.822' };
const parts = { 8: 'back', 9: 'handle', 16: 'blade-1', 17: 'blade-2', 18: 'blade-3' };
let index = 0;
const body = original.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<path\b[\s\S]*?\/>/g, path => {
  const current = index++;
  if (!parts[current]) return path;
  if (!path.includes(`d="${starts[current]}`)) throw new Error(`Knife source path ${current} changed`);
  return path.replace('<path ', `<path class="sim-knife-${parts[current]}" data-motion-part="${parts[current]}" `);
});
if (index < 31) throw new Error('Knife source is incomplete');
await writeFile(new URL('../app/simulator/editor/knife-switch-shape.ts', import.meta.url), `// Generated from original SVG paths by scripts/prepare-knife-switch-motion.mjs.\nexport const knifeSwitchShape = ${JSON.stringify({ width: 208.5, height: 292, body }, null, 2)} as const;\n`);
console.log('Prepared original knife-switch SVG motion paths');
