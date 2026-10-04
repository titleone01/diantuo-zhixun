import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import ts from "typescript";
import { buildLocalApp } from "./build-local-app.mjs";
import { isolatedConfig, launch, localOnlyEnvironment } from "./backend-test-runner.mjs";

const root = path.resolve(import.meta.dirname, "..");
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export function containedPath(directory, name) {
  if (typeof name !== "string" || !name || name.includes("\\") || path.isAbsolute(name)) throw new Error("Invalid manifest path");
  const result = path.resolve(directory, name);
  const relative = path.relative(path.resolve(directory), result);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Manifest path escapes directory");
  return result;
}

export async function inventory(directory, omit = new Set()) {
  const files = Object.create(null);
  async function walk(base, prefix = "") {
    for (const item of (await readdir(base, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const name = prefix + item.name;
      if (omit.has(name)) continue;
      const filename = containedPath(directory, name);
      if (item.isSymbolicLink()) throw new Error("Symlinks are not allowed in release/state archives");
      if (item.isDirectory()) await walk(filename, `${name}/`);
      else if (item.isFile()) {
        const bytes = await readFile(filename);
        files[name] = { bytes: bytes.length, sha256: sha256(bytes) };
      } else throw new Error("Non-regular archive entry");
    }
  }
  if ((await lstat(directory)).isSymbolicLink()) throw new Error("Archive root cannot be a symlink");
  await walk(directory);
  return files;
}

export async function emptyDestination(directory) {
  try {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (await readdir(directory)).length) throw new Error("Refusing to overwrite a nonempty or linked destination");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  await mkdir(directory, { recursive: true });
}

export async function verifyArchive(directory, kind) {
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  if (manifest.format !== 1 || manifest.kind !== kind || !manifest.files || typeof manifest.files !== "object") throw new Error("Invalid archive manifest");
  for (const name of Object.keys(manifest.files)) containedPath(directory, name);
  const actual = await inventory(directory, new Set(["manifest.json"]));
  const names = Object.keys(actual).sort(), expectedNames = Object.keys(manifest.files).sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames) || names.some(name => actual[name].bytes !== manifest.files[name]?.bytes || actual[name].sha256 !== manifest.files[name]?.sha256)) throw new Error("Archive file hashes or inventory differ");
  return manifest;
}

async function sourceIdentity() {
  const files = {};
  for (const directory of ["app", "worker", "db", "scripts", "shared", "github-pages", "architecture", "public", "tests", "e2e", ".github"]) {
    let entries;
    try { entries = await inventory(path.join(root, directory)); }
    catch (error) { if (['e2e', '.github'].includes(directory) && error.code === 'ENOENT') continue; throw error; }
    for (const [name, value] of Object.entries(entries)) files[`${directory}/${name}`] = value.sha256;
  }
  for (const name of (await readdir(root)).sort()) {
    if (name === '.gitignore' || name === '.dev.vars.example' || (!name.startsWith('.') && /\.(md|json|jsonc|ts|mjs)$/.test(name))) {
      files[name] = sha256(await readFile(path.join(root, name)));
    }
  }
  const sourceHash = sha256(JSON.stringify(files));
  try {
    return { head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(), status: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }), sourceHash, files };
  } catch {
    const snapshot = JSON.parse(await readFile(path.join(root, ".worktree-snapshot.json"), "utf8"));
    return { head: snapshot.head, status: snapshot.status, isolatedFrom: snapshot.createdAt, sourceHash, files, changesSinceIsolation: Object.keys(files).filter(name => files[name] !== snapshot.files[name]) };
  }
}

export async function buildRelease(directory) {
  const source = await sourceIdentity();
  await emptyDestination(directory);
  const base = JSON.parse(await readFile(path.join(root, "wrangler.local.jsonc"), "utf8"));
  await buildLocalApp(path.join(directory, "assets"));
  await cp(path.join(root, "db", "migrations"), path.join(directory, "migrations"), { recursive: true });
  await buildDocumentContract(directory);
  for (const name of ["package.json", "package-lock.json"]) await cp(path.join(root, name), path.join(directory, name));
  // The dry-run config is outside the project, so Wrangler cannot load production .dev.vars.
  const scratch = await mkdtemp(path.join(tmpdir(), "diantuo-release-build-"));
  const config = isolatedConfig(base, scratch, root);
  config.assets.directory = path.join(directory, "assets");
  const configFile = path.join(scratch, "wrangler.json");
  await writeFile(configFile, JSON.stringify(config));
  const result = launch([path.join(root, "node_modules/wrangler/bin/wrangler.js"), "deploy", "--dry-run", "--config", configFile, "--outdir", path.join(directory, "worker")], scratch, {
    ...localOnlyEnvironment(process.env), CI: "true", WRANGLER_SEND_METRICS: "false", WRANGLER_SEND_ERROR_REPORTS: "false", WRANGLER_WRITE_LOGS: "false",
  }, 120000);
  if (await result.result !== 0) throw new Error("Release worker dry-run failed");
  const worker = (await readdir(path.join(directory, "worker"))).filter(name => name.endsWith(".js"));
  if (worker.length !== 1) throw new Error("Expected one bundled worker entry");
  await writeFile(path.join(directory, "runtime.json"), JSON.stringify({
    compatibility_date: base.compatibility_date, compatibility_flags: base.compatibility_flags,
    main: `worker/${worker[0]}`, no_bundle: false, find_additional_modules: false,
    assets: { ...base.assets, directory: "assets" },
    d1_databases: base.d1_databases.map(db => ({ ...db, migrations_dir: "migrations" })), r2_buckets: base.r2_buckets,
    observability: { enabled: false },
  }, null, 2));
  if ((await sourceIdentity()).sourceHash !== source.sourceHash) throw new Error("Source changed during release build");
  const manifest = { format: 1, kind: "release", createdAt: new Date().toISOString(), source, node: process.version, files: await inventory(directory) };
  manifest.id = sha256(JSON.stringify(manifest.files));
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await verifyArchive(directory, "release");
  return manifest;
}

/** Keep the target release's validator and recognized fields with its hashed payload. */
export async function buildDocumentContract(directory) {
  const result = await build({ stdin: { contents: 'export { CATALOG } from "./app/simulator/core/catalog"; export { validateDocument } from "./app/simulator/core/validation";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  const validator = result.outputFiles[0].text;
  const { CATALOG } = await import(`data:text/javascript;base64,${Buffer.from(validator).toString('base64')}`);
  const source = ts.createSourceFile('types.ts', await readFile(path.join(root, 'app/simulator/core/types.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const fields = {};
  for (const [name, alias] of Object.entries({ document: 'CircuitDocument', component: 'CircuitComponent', wire: 'CircuitWire', point: 'Point', terminalRef: 'TerminalRef' })) {
    const declaration = source.statements.find(statement => ts.isTypeAliasDeclaration(statement) && statement.name.text === alias);
    if (!declaration || !ts.isTypeLiteralNode(declaration.type) || declaration.type.members.some(member => !ts.isPropertySignature(member) || !member.name || !ts.isIdentifier(member.name))) throw new Error('Cannot derive document contract; review changed document types before release');
    fields[name] = declaration.type.members.map(member => member.name.text).sort();
  }
  await writeFile(path.join(directory, 'document-validator.mjs'), validator);
  await writeFile(path.join(directory, 'document-contract.json'), JSON.stringify({ format: 1, fields, components: CATALOG.map(component => ({ type: component.type, terminals: component.terminals.map(terminal => terminal.id) })) }, null, 2));
}

/** Check saved drafts and immutable publications without exposing document contents. */
export async function checkReleaseCompatibility(release, state, manifest) {
  if (!manifest.files['document-contract.json'] || !manifest.files['document-validator.mjs']) throw new Error('Release lacks a verifiable document contract; rebuild it before activation');
  const contract = JSON.parse(await readFile(path.join(release, 'document-contract.json'), 'utf8'));
  if (contract.format !== 1 || !contract.fields || !['document', 'component', 'wire'].every(kind => Array.isArray(contract.fields[kind])) || ['point', 'terminalRef'].some(kind => contract.fields[kind] !== undefined && !Array.isArray(contract.fields[kind])) || !Array.isArray(contract.components)) throw new Error('Invalid release document contract');
  const { validateDocument } = await import(pathToFileURL(path.join(release, 'document-validator.mjs')).href);
  if (typeof validateDocument !== 'function') throw new Error('Invalid release document validator');
  const supported = new Map(contract.components.map(component => [component.type, new Set(component.terminals)]));
  // Format-1 releases predating nested contracts used these schemaVersion-1 fields.
  // Keep compatible old packages usable while refusing data they would silently ignore.
  const legacyNestedFields = { point: ['x', 'y'], terminalRef: ['componentId', 'terminalId'] };
  const knownFields = (value, kind) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => (contract.fields[kind] ?? legacyNestedFields[kind]).includes(key));
  const migrationNames = Object.keys(manifest.files).filter(name => name.startsWith('migrations/') && name.endsWith('.sql')).map(name => name.slice('migrations/'.length)).sort();
  const { DatabaseSync } = await import('node:sqlite');
  let schemaChecked = migrationNames.length === 0;
  for (const name of Object.keys(await inventory(state)).filter(name => /\.(sqlite|sqlite3|db)$/.test(name))) {
    const db = new DatabaseSync(containedPath(state, name), { readOnly: true });
    try {
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
      if (migrationNames.length && tables.has('d1_migrations')) {
        const applied = db.prepare('SELECT name FROM d1_migrations ORDER BY name').all().map(row => row.name);
        if (JSON.stringify(applied) !== JSON.stringify(migrationNames)) throw new Error('Release and applied schema differ; require a reviewed compatibility decision before rollback');
        schemaChecked = true;
      }
      for (const table of ['circuits', 'publications']) {
        if (!tables.has(table)) continue;
        for (const row of db.prepare(`SELECT document FROM ${table}`).iterate()) {
          let document;
          try { document = JSON.parse(row.document); } catch { throw new Error('Stored document is corrupt; activation refused and business state retained'); }
          if (!knownFields(document, 'document') || !validateDocument(document).valid || document.components.some(component => !knownFields(component, 'component') || !knownFields(component.position, 'point') || !supported.has(component.type)) || document.wires.some(wire => !knownFields(wire, 'wire') || !knownFields(wire.from, 'terminalRef') || !knownFields(wire.to, 'terminalRef') || (wire.waypoints !== undefined && (!Array.isArray(wire.waypoints) || wire.waypoints.some(point => !knownFields(point, 'point')))))) throw new Error('Target release cannot interpret stored documents; activation refused and business state retained');
          const components = new Map(document.components.map(component => [component.id, component.type]));
          if (document.wires.some(wire => ['from', 'to'].some(end => !supported.get(components.get(wire[end].componentId))?.has(wire[end].terminalId)))) throw new Error('Target release lacks stored terminals; activation refused and business state retained');
        }
      }
    } finally { db.close(); }
  }
  if (!schemaChecked) throw new Error('Cannot verify applied schema before activation');
}

export async function assertStopped({ stopped, origin, leaseFile }) {
  if (stopped !== true || !origin || !leaseFile) throw new Error("Backup/activation requires explicit stop-writes acknowledgement, loopback origin and runtime lease");
  const url = new URL(origin);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Expected a loopback origin");
  try {
    const lease = JSON.parse(await readFile(leaseFile, "utf8"));
    if (!Number.isSafeInteger(lease.pid) || lease.pid < 1) throw new Error("Invalid runtime lease");
    try { process.kill(lease.pid, 0); throw new Error("Runtime lease still owns a live process"); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const response = await fetch(`${url.origin}/api/session`, { signal: AbortSignal.timeout(2000) }).catch(error => {
    // A timeout is not proof of stopped writes. Only a refused connection is accepted.
    if (error.cause?.code === "ECONNREFUSED") return null;
    throw new Error("Cannot confirm the writer is stopped");
  });
  if (response) throw new Error("Origin is still accepting requests");
}

export async function backupState(source, directory, options) {
  await assertStopped(options);
  const src = path.resolve(source), dest = path.resolve(directory);
  const runtimeRoots = new Set([path.dirname(src)]);
  if (path.basename(path.dirname(src)) === '.wrangler') runtimeRoots.add(path.dirname(path.dirname(src)));
  for (const configFile of [options.privateConfig, options.runtimeConfig]) if (configFile) runtimeRoots.add(path.dirname(path.resolve(configFile)));
  const localDirectories = [];
  for (const runtimeRoot of runtimeRoots) {
    const localDirectory = path.join(runtimeRoot, '.local');
    try {
      if (!(await lstat(localDirectory)).isDirectory()) throw new Error('Runtime .local must be a directory');
      localDirectories.push(localDirectory);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (localDirectories.length) {
    if (!options.privateDirectory) throw Object.assign(new Error('Runtime .local exists; include it with --private-directory before creating a complete backup'), { code: 'PRIVATE_DIRECTORY_REQUIRED' });
    const privateRoot = path.resolve(options.privateDirectory);
    if (localDirectories.some(localDirectory => {
      const relative = path.relative(privateRoot, localDirectory);
      return path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`);
    })) throw Object.assign(new Error('--private-directory must include every detected runtime .local; refusing an incomplete backup'), { code: 'PRIVATE_DIRECTORY_INCOMPLETE' });
  }
  const relative = path.relative(src, dest);
  if (!relative || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))) throw new Error("Backup must be outside the state directory");
  if (options.privateDirectory) {
    const fromPrivate = path.relative(path.resolve(options.privateDirectory), dest);
    if (!fromPrivate || (!path.isAbsolute(fromPrivate) && fromPrivate !== '..' && !fromPrivate.startsWith(`..${path.sep}`))) throw new Error('Backup must be outside the private runtime directory');
  }
  await emptyDestination(dest);
  const before = await inventory(src);
  await cp(src, path.join(dest, "state"), { recursive: true, dereference: false });
  const after = await inventory(src);
  if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(before) !== JSON.stringify(await inventory(path.join(dest, "state")))) throw new Error("State changed during backup; incomplete archive retained for inspection");
  if (options.privateConfig) await cp(options.privateConfig, path.join(dest, "private-config"));
  if (options.runtimeConfig) await cp(options.runtimeConfig, path.join(dest, "runtime-config.json"));
  if (options.privateDirectory) {
    const privateBefore = await inventory(options.privateDirectory);
    await cp(options.privateDirectory, path.join(dest, 'private-runtime'), { recursive: true, dereference: false });
    if (JSON.stringify(privateBefore) !== JSON.stringify(await inventory(options.privateDirectory)) || JSON.stringify(privateBefore) !== JSON.stringify(await inventory(path.join(dest, 'private-runtime')))) throw new Error('Private runtime changed during backup');
  }
  const manifest = { format: 1, kind: "backup", createdAt: new Date().toISOString(), includesWal: true, privateRuntime: { included: Boolean(options.privateDirectory), detectedLocalDirectories: localDirectories.length }, files: await inventory(dest) };
  await writeFile(path.join(dest, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
  return manifest;
}

export async function restoreState(backup, destination) {
  const relative = path.relative(path.resolve(backup), path.resolve(destination));
  if (!relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))) throw new Error('Restore destination must be outside the immutable backup');
  await verifyArchive(backup, "backup");
  await emptyDestination(destination);
  await cp(path.join(backup, "state"), path.join(destination, "state"), { recursive: true });
  const copied = await inventory(path.join(destination, "state"));
  const expected = await inventory(path.join(backup, "state"));
  if (JSON.stringify(copied) !== JSON.stringify(expected)) throw new Error("Restore byte verification failed");
  const { DatabaseSync } = await import("node:sqlite");
  const files = await inventory(path.join(destination, "state"));
  for (const name of Object.keys(files).filter(name => /\.(sqlite|sqlite3|db)$/.test(name))) {
    const db = new DatabaseSync(containedPath(path.join(destination, "state"), name), { readOnly: true });
    try {
      if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok" || db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Restored SQLite integrity check failed");
    } finally { db.close(); }
  }
  try { await cp(path.join(backup, "private-config"), path.join(destination, ".dev.vars")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  try { await cp(path.join(backup, "runtime-config.json"), path.join(destination, "base-config.json")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  try { await cp(path.join(backup, 'private-runtime'), path.join(destination, '.local'), { recursive: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { files: Object.keys(files).length, sqliteChecked: true };
}

export async function activateRelease(release, runtime, options) {
  await assertStopped(options);
  const manifest = await verifyArchive(release, "release");
  // Activation changes code only; never copies or rolls back business state.
  const state = path.join(path.resolve(runtime), "state");
  if (!(await lstat(state)).isDirectory()) throw new Error("Missing runtime state");
  await checkReleaseCompatibility(release, state, manifest);
  const pointer = { format: 1, release: path.resolve(release), releaseId: manifest.id, state, activatedAt: new Date().toISOString() };
  const temporary = path.join(runtime, "active-release.tmp");
  await writeFile(temporary, JSON.stringify(pointer, null, 2) + "\n", { flag: "wx" });
  await rename(temporary, path.join(runtime, "active-release.json"));
  return pointer;
}

export async function stateBusinessDigest(state) {
  const { DatabaseSync } = await import('node:sqlite');
  const files = await inventory(state), parts = [];
  for (const name of Object.keys(files)) {
    if (/\.(sqlite|sqlite3|db)$/.test(name)) {
      const db = new DatabaseSync(containedPath(state, name), { readOnly: true });
      try {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
        for (const table of tables) {
          const rows = db.prepare(`SELECT * FROM "${table.name.replaceAll('"', '""')}"`).all().map(row => JSON.stringify(row)).sort();
          parts.push([name, table.name, sha256(JSON.stringify(rows))]);
        }
      } finally { db.close(); }
    } else if (!/-(shm|wal)$/.test(name)) parts.push([name, files[name].sha256]);
  }
  return sha256(JSON.stringify(parts));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2), flags = {};
    for (let index = 0; index < args.length; index++) {
      const name = args[index];
      if (name === "--stopped") flags.stopped = true;
      else if (["--out", "--state", "--backup", "--release", "--runtime", "--origin", "--lease", "--private-config", "--runtime-config", "--private-directory"].includes(name) && args[index + 1] && !args[index + 1].startsWith("--")) flags[name.slice(2)] = args[++index];
      else throw new Error("Invalid release-tool arguments");
    }
    const required = (...names) => { for (const name of names) if (!flags[name]) throw new Error(`Missing --${name}`); };
    const stop = { stopped: flags.stopped, origin: flags.origin, leaseFile: flags.lease, privateConfig: flags["private-config"], runtimeConfig: flags["runtime-config"], privateDirectory: flags['private-directory'] };
    if (command === "build") { required("out"); console.log(`Release verified: ${(await buildRelease(path.resolve(flags.out))).id}`); }
    else if (command === "verify") { required("release"); console.log(`Release verified: ${(await verifyArchive(flags.release, "release")).id}`); }
    else if (command === "backup") { required("state", "out", "private-config", "runtime-config"); await backupState(flags.state, flags.out, stop); console.log("Offline backup verified"); }
    else if (command === "restore") { required("backup", "out"); console.log(await restoreState(flags.backup, flags.out)); }
    else if (command === "activate") { required("release", "runtime"); await activateRelease(flags.release, flags.runtime, stop); console.log("Code pointer changed; business state retained"); }
    else throw new Error("Expected build, verify, backup, restore or activate");
  } catch (error) {
    console.error(`Release tool failed: ${error.name} (no successful operation recorded)`);
    const guidance = {
      PRIVATE_DIRECTORY_REQUIRED: 'Runtime .local exists; provide --private-directory <runtime .local or enclosing private directory> for a complete backup.',
      PRIVATE_DIRECTORY_INCOMPLETE: '--private-directory does not include runtime .local; select that directory or its enclosing private runtime directory.',
    };
    if (guidance[error.code]) console.error(guidance[error.code]);
    process.exitCode = 1;
  }
}
