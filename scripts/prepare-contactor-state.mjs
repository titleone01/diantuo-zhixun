import { readFile, writeFile } from 'node:fs/promises';

// Keep original assets intact. Strip only the four unconnected decorative slots,
// and identify the four existing blue windows by their original path index.
const shapes = {};
for (const type of ['contactor220', 'contactor380']) {
  const source = await readFile(new URL(`../public/sim-assets/${type}.svg`, import.meta.url), 'utf8');
  let index = 0;
  const body = source.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<path\b[\s\S]*?\/>/g, path => {
    const current = index++;
    if (current === 2) {
      return path.replace(/d="([^"]+)"/, (_, d) => {
        const parts = d.split(/(?=M)/);
        if (parts.length !== 8 || !parts[2].startsWith('M91.500,169.500') || !parts[4].startsWith('M53.499,169.500')) throw new Error(`Decorative slots changed: ${type}`);
        return `d="${[...parts.slice(0, 2), ...parts.slice(6)].join('')}"`;
      });
    }
    if ([16, 17, 25, 26].includes(current)) {
      if (!path.includes('fill="rgb(99, 124, 207)"')) throw new Error(`State window changed: ${type}`);
      return path.replace('<path ', '<path class="sim-contactor-state-region" ');
    }
    return path;
  });
  if (index !== 43) throw new Error(`Source contactor changed: ${type}`);
  shapes[type] = body;
}
await writeFile(new URL('../app/simulator/editor/contactor-state-shapes.ts', import.meta.url), `// Derived from original SVGs by scripts/prepare-contactor-state.mjs.\nexport const contactorStateShapes = ${JSON.stringify(shapes, null, 2)} as const;\n`);
console.log('Prepared original contactor state regions');
