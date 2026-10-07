import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('the complete auxiliary module retains original NO details and calibrated screw centers without fragments of other contacts', async () => {
  const original = await readFile(new URL('../public/sim-assets/contactor380.svg', import.meta.url), 'utf8');
  const asset = await readFile(new URL('../public/sim-assets/auxiliary-no.svg', import.meta.url), 'utf8');
  const metadata = JSON.parse(asset.match(/<metadata>(.*?)<\/metadata>/s)[1]);
  // Git can translate SVG line endings; the recorded source uses CRLF.
  // Check both encodings while retaining the source-path assertions below.
  const sourceLf = original.replace(/\r\n/g, '\n');
  const sourceHashes = [sourceLf, sourceLf.replace(/\n/g, '\r\n')]
    .map(source => createHash('sha256').update(source).digest('hex'));
  assert.ok(sourceHashes.includes(metadata.sourceSha256), 'Auxiliary artwork source hash differs beyond line endings');
  assert.match(asset, /width="59.25px" height="205.5px" viewBox="0 0 59.25 205.5"/);
  assert.match(asset, /class="auxiliary-shell"/);
  assert.match(asset, /translate\(-168 -46.5\) scale\(1.5\)/);
  for (const origin of ['M134.497,31.499', 'M134.497,37.498', 'M134.497,138.499', 'M134.497,144.499']) {
    const shape = [...original.matchAll(/<path\b[\s\S]*?\/>/g)].map(m => m[0]).find(p => p.includes(`d="${origin}`));
    assert.ok(asset.includes(shape));
  }
  assert.match(asset, />13NO<\/tspan>/);
  assert.match(asset, />14NO<\/tspan>/);
  assert.doesNotMatch(asset, /21NC|22NC|>A2<|<image\b|clipPath/);
});
