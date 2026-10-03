import path from 'node:path';
import { launch, localOnlyEnvironment } from './backend-test-runner.mjs';
const root = path.resolve(import.meta.dirname, '..');
const { mkdir, readdir, writeFile } = await import('node:fs/promises');
const tests = (await readdir(path.join(root, 'tests'))).filter(name => name.endsWith('.test.mjs')).sort().map(name => `tests/${name}`);
const extended = process.argv.includes('--extended');
if (process.argv.slice(2).some(flag => flag !== '--extended')) throw new Error('Expected --extended or no flags');
const steps = [
  ['TypeScript', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['Lint', ['node_modules/eslint/bin/eslint.js', '.']],
  ['Schema', ['scripts/check-schema.mjs']],
  ['Production build', ['node_modules/vinext/dist/cli.js', 'build']],
  ['Pages build', ['scripts/build-pages.mjs']],
  ['Offline regressions', ['--test', ...tests]],
  ['Isolated backend', ['scripts/test-multiuser.mjs']],
  ...(extended ? [['Recovery/rollback', ['scripts/test-recovery.mjs']], ['Chromium browser', ['scripts/test-browser.mjs']], ['Teaching capacity', ['scripts/test-capacity.mjs']]] : []),
];
const report = { at: new Date().toISOString(), steps: [] };
for (const [name, args] of steps) {
  console.log(`[check] ${name}`);
  const start = performance.now(); let code = 1, error;
  const child = launch(args, root, { ...localOnlyEnvironment(process.env), CI: 'true' }, 600000);
  const interrupt = () => { void child.stop(); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try { code = await child.result; }
  catch (reason) { error = reason.name; }
  finally { await child.stop(); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
  report.steps.push({ name, code, error, elapsedMs: performance.now() - start });
  const directory = path.join(root, '.local/acceptance-public'); await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'check.json'), JSON.stringify(report, null, 2));
  if (code !== 0) { process.exitCode = 1; break; }
}
