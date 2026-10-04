import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertStopped, checkReleaseCompatibility, containedPath, verifyArchive } from './release-tools.mjs';
import { launch, localOnlyEnvironment, unusedPort } from './backend-test-runner.mjs';

// Explicit operator action only: no build, migrations, bootstrap, restore or tunnel changes.
const [runtimeArgument, portArgument] = process.argv.slice(2);
const runtime = path.resolve(runtimeArgument || '');
const port = Number(portArgument);
if (!runtimeArgument || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Usage: node scripts/start-release.mjs <runtime-directory> <loopback-port>');
const origin = `http://127.0.0.1:${port}`, leaseFile = path.join(runtime, 'runtime-lease.json');
await assertStopped({ stopped: true, origin, leaseFile });
const pointer = JSON.parse(await readFile(path.join(runtime, 'active-release.json'), 'utf8'));
if (pointer.state !== path.join(runtime, 'state')) throw new Error('Runtime state pointer differs');
const release = path.resolve(pointer.release), manifest = await verifyArchive(release, 'release');
if (manifest.id !== pointer.releaseId) throw new Error('Active release identity differs');
await checkReleaseCompatibility(release, pointer.state, manifest);
const base = JSON.parse(await readFile(path.join(runtime, 'base-config.json'), 'utf8'));
const template = JSON.parse(await readFile(path.join(release, 'runtime.json'), 'utf8'));
if ([...(base.d1_databases ?? []), ...(base.r2_buckets ?? [])].some(binding => binding.remote === true)) throw new Error('Remote bindings are prohibited for this local runtime');
const config = { ...base, compatibility_date: template.compatibility_date, compatibility_flags: template.compatibility_flags, main: containedPath(release, template.main), no_bundle: false, find_additional_modules: false,
  assets: { ...template.assets, directory: path.join(release, 'assets') },
  d1_databases: base.d1_databases.map(db => ({ ...db, migrations_dir: path.join(release, 'migrations') })),
};
const configFile = path.join(runtime, 'wrangler.json');
await writeFile(configFile, JSON.stringify(config, null, 2));
const root = path.resolve(import.meta.dirname, '..');
let inspector = await unusedPort(); while (inspector === port) inspector = await unusedPort();
const child = launch([path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--local', '--config', configFile, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(inspector), '--persist-to', pointer.state, '--no-show-interactive-dev-session'], runtime,
  { ...localOnlyEnvironment(process.env), WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false', WRANGLER_REGISTRY_PATH: path.join(runtime, 'registry') });
await writeFile(leaseFile, JSON.stringify({ pid: child.child.pid, origin, releaseId: manifest.id }));
const stop = () => { void child.stop(); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
try { process.exitCode = await child.result; }
finally { await child.stop(); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
