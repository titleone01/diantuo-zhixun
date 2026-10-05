import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { unusedPort } from '../scripts/backend-test-runner.mjs';

async function fixture(failure = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'diantuo-launch-release-'));
  await mkdir(path.join(root, 'scripts'));
  await mkdir(path.join(root, '.wrangler'));
  const source = await readFile(new URL('../scripts/start-local.mjs', import.meta.url), 'utf8');
  const port = await unusedPort();
  // Move only the probe port in this isolated fixture, never contact production.
  await writeFile(path.join(root, 'scripts/start-local.mjs'), source.replaceAll('3000', String(port)));
  await writeFile(path.join(root, '.wrangler/active-release.json'), failure ? 'invalid' : '{}');
  await writeFile(path.join(root, 'scripts/start-release.mjs'), `
    import { readFile, writeFile } from 'node:fs/promises';
    import path from 'node:path';
    const [runtime, port] = process.argv.slice(2);
    JSON.parse(await readFile(path.join(runtime, 'active-release.json'), 'utf8'));
    await writeFile(path.join(runtime, 'delegated.json'), JSON.stringify({runtime, port}));
  `);
  // These mutation entry points must never run after activation, even on failure.
  await writeFile(path.join(root, 'scripts/bootstrap-admin.mjs'), "throw new Error('FORBIDDEN_BOOTSTRAP')");
  const child = spawn(process.execPath, [path.join(root, 'scripts/start-local.mjs')], { windowsHide: true });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  return { root, code, output, port };
}

test('desktop local entry delegates activated release with the original persistent state', async () => {
  const { root, code, port, output } = await fixture();
  assert.equal(code, 0, output);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, '.wrangler/delegated.json'), 'utf8')), {
    runtime: path.join(root, '.wrangler'), port: String(port),
  });
});

test('invalid activated release fails closed without building or bootstrapping', async () => {
  const { root, code, output } = await fixture(true);
  assert.notEqual(code, 0);
  assert.doesNotMatch(output, /FORBIDDEN_BOOTSTRAP/);
  await assert.rejects(readFile(path.join(root, '.wrangler/delegated.json')), { code: 'ENOENT' });
});
