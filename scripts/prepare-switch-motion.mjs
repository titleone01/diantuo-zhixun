import { readFile, writeFile } from 'node:fs/promises';

// Separate the existing source paths; original SVG files and terminal coordinates stay intact.
const definitions = {
  'push-no': { moving: [5, 6], part: 'push-cap', width: 101.5, height: 183.5 },
  'push-nc': { moving: [5, 6], part: 'push-cap', width: 101.5, height: 183.5 },
  'push-latching-red': { moving: [5, 6], part: 'push-cap', width: 101.5, height: 183.5 },
  'push-latching-green': { moving: [5, 6], part: 'push-cap', width: 101.5, height: 183.5 },
  breaker1: { moving: [4, 5, 6], part: 'breaker-handle', width: 51.5, height: 187.5 },
  breaker3: { moving: [22, 23, 24, 25], part: 'breaker-handle', width: 149.5, height: 187.5 },
};
const shapes = {};
for (const [name, definition] of Object.entries(definitions)) {
  const original = await readFile(new URL(`../public/sim-assets/${name}.svg`, import.meta.url), 'utf8');
  let body = original.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  let index = 0;
  body = body.replace(/<path\b[\s\S]*?\/>/g, path => {
    const current = index++;
    // Mechanical status windows, identified in the preserved original artwork.
    if ((name === 'breaker1' && current === 7) || (name === 'breaker3' && [4, 13, 26].includes(current))) path = path.replace('<path ', '<path class="sim-breaker-status" ');
    return `${current === definition.moving[0] ? `<g class="sim-motion-${definition.part}" data-motion-part="${definition.part}">` : ''}${path}${current === definition.moving.at(-1) ? '</g>' : ''}`;
  });
  if (index <= definition.moving.at(-1)) throw new Error(`Source changed: ${name}`);
  shapes[name] = { width: definition.width, height: definition.height, body };
}
await writeFile(new URL('../app/simulator/editor/switch-motion-shapes.ts', import.meta.url), `// Generated from original SVG paths by scripts/prepare-switch-motion.mjs.\nexport const switchMotionShapes = ${JSON.stringify(shapes, null, 2)} as const;\n`);
console.log('Prepared source SVG switch motion groups');
