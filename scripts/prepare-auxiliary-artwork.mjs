import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// Preserve the calibrated NO screw centers and original switch details. A
// complete teaching module frame replaces the old cut through a larger device.
const source = await readFile(new URL('../public/sim-assets/contactor380.svg', import.meta.url), 'utf8');
const starts = ['M118.499,76.500', 'M129.499,64.499', 'M129.499,113.499',
  'M134.497,31.499', 'M134.497,37.498', 'M134.497,138.499', 'M134.497,144.499'];
const paths = [...source.matchAll(/<path\b[\s\S]*?\/>/g)].map(match => match[0]);
const selected = starts.map(start => {
  const matches = paths.filter(path => path.includes(`d="${start}`));
  assert.equal(matches.length, 1, `Original NO detail changed: ${start}`);
  return matches[0];
});
const labels = [...source.matchAll(/<text\b[\s\S]*?<\/text>/g)]
  .map(match => match[0]).filter(text => />(13NO|14NO)<\/tspan>/.test(text))
  .map(text => text.replace(/font-family="[^"]*"/g, 'font-family="Arial, Microsoft YaHei, sans-serif"'));
assert.equal(labels.length, 2);
const metadata = { source: 'contactor380.svg', sourceSha256: createHash('sha256').update(source).digest('hex'),
  role: 'linked normally open contact; complete teaching frame', scale: 1.5, originalOffset: { x: 112, y: 31 } };
const asset = `<svg xmlns="http://www.w3.org/2000/svg" width="59.25px" height="205.5px" viewBox="0 0 59.25 205.5">
  <metadata>${JSON.stringify(metadata)}</metadata>
  <rect class="auxiliary-shell" x="0.5" y="0.5" width="58.25" height="204.5" rx="4" fill="#ececec" stroke="#000" stroke-width="1"/>
  <rect x="0.5" y="50" width="58.25" height="92.5" fill="#515151" stroke="#000" stroke-width="1"/>
  <g transform="translate(-168 -46.5) scale(1.5)">${selected.join('\n')}${labels.join('\n')}</g>
</svg>\n`;
await writeFile(new URL('../public/sim-assets/auxiliary-no.svg', import.meta.url), asset);
console.log('Prepared complete auxiliary NO module with unchanged calibrated terminals');
