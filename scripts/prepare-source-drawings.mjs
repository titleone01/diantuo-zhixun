import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
export const SOURCE_DRAWINGS = JSON.parse(await readFile(new URL('../shared/training-drawing-sources.json', import.meta.url), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Verify every authoritative PNG before creating any output or upload. */
export async function verifySourceDrawings(directory) {
  const verified = [];
  for (const entry of SOURCE_DRAWINGS.entries) {
    const bytes = await readFile(path.join(directory, entry.file));
    assert.equal(bytes.length, entry.size, `${entry.file}: original size differs`);
    assert.equal(hash(bytes), entry.sha256, `${entry.file}: original SHA-256 differs`);
    assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
    verified.push({ ...entry, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes });
  }
  return verified;
}

export async function prepareSourceDrawings(directory, output) {
  const verified = await verifySourceDrawings(path.resolve(directory));
  const destination = path.resolve(output), privateRoot = path.join(root, '.local') + path.sep;
  assert.ok(destination.startsWith(privateRoot), 'Original private course PNGs must stay inside .local');
  await mkdir(path.dirname(destination), { recursive: true });
  await mkdir(destination); // Never overwrite an earlier collection or evidence.
  for (const { file, bytes } of verified) {
    await writeFile(path.join(destination, file), bytes, { flag: 'wx' });
    assert.equal(hash(await readFile(path.join(destination, file))), hash(bytes));
  }
  const manifest = { createdAt: new Date().toISOString(), sourceDirectory: path.resolve(directory),
    policy: 'Original PNG bytes unchanged; 16-position terminals are a separate simulator extension',
    entries: verified.map(({ bytes, ...entry }) => entry) };
  await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), at = name => args.indexOf(name);
  const directory = at('--directory') >= 0 ? args[at('--directory') + 1] : undefined;
  const output = at('--out') >= 0 ? args[at('--out') + 1] : undefined;
  assert.ok(directory && output, 'Expected --directory <original PNG folder> --out <new private .local folder>');
  const manifest = await prepareSourceDrawings(directory, output);
  console.log(JSON.stringify({ originalPngs: manifest.entries.length, schematic: manifest.entries.filter(e => e.kind === 'schematic').length,
    layout: manifest.entries.filter(e => e.kind === 'layout').length, byteIdentity: 'passed', output: path.resolve(output) }));
}
