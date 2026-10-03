import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createFixture } from './isolated-fixture.mjs';
import { buildRelease } from './release-tools.mjs';
import { largeDocument, lessonFunctions, TestClient } from './test-fixtures.mjs';

const root = path.resolve(import.meta.dirname, '..');
const release = path.join(await mkdtemp(path.join(tmpdir(), 'diantuo-capacity-')), 'release');
await buildRelease(release);
const fixture = await createFixture({ release });
const result = { at: new Date().toISOString(), node: process.version, platform: process.platform, scope: 'isolated local Worker; no tunnel or production accounts', connections: 'one HTTP connection per request; no write retries', samples: [] };
function resources() {
  let workerTree = null;
  if (process.platform === 'win32') {
    try {
      const pid = fixture.pid;
      const command = `$rows=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId; $ids=[System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${pid}); do {$old=$ids.Count; foreach($row in $rows){if($ids.Contains([int]$row.ParentProcessId)){[void]$ids.Add([int]$row.ProcessId)}}} while($ids.Count -gt $old); $procs=Get-Process -Id @($ids) -ErrorAction SilentlyContinue; [pscustomobject]@{rssBytes=($procs | Measure-Object WorkingSet64 -Sum).Sum;cpuMs=($procs | ForEach-Object {$_.TotalProcessorTime.TotalMilliseconds} | Measure-Object -Sum).Sum} | ConvertTo-Json -Compress`;
      workerTree = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', windowsHide: true }));
    } catch { workerTree = null; }
  }
  return { clientRssBytes: process.memoryUsage().rss, clientCpu: process.cpuUsage(), workerTree };
}
try {
  const admin = new TestClient(fixture.origin);
  await admin.login(JSON.parse(await readFile(fixture.adminFile, 'utf8')));
  const clients = [];
  for (let index = 0; index < 30; index++) {
    const invite = await admin.call('/invites', 'POST', { expiresInHours: 1 }); assert.equal(invite.status, 201);
    const credentials = { username: `capacity_${index}_${randomBytes(3).toString('hex')}`, name: `容量验收 ${index + 1}`, password: randomBytes(20).toString('base64url') };
    const client = new TestClient(fixture.origin, { freshConnections: true });
    assert.equal((await client.call('/invites/accept', 'POST', { ...credentials, token: invite.data.invite.token })).status, 201);
    await client.login(credentials); clients.push(client);
  }
  const { createLessonDocument } = await lessonFunctions();
  // The existing maximum-waypoint import fixture intentionally exceeds the
  // server's 750000-byte save limit. Keep that rejection as a separate case.
  const documents = { small: createLessonDocument('motor-jog', { wired: true }), large: largeDocument(32), oversized: largeDocument() };
  let firstDraft;
  for (const [name, document] of Object.entries(documents)) for (const concurrency of [1, 10, 30]) {
    const before = resources(), start = performance.now();
    const measurements = await Promise.all(clients.slice(0, concurrency).map(async (client, index) => {
      const since = performance.now();
      let stage = 'create', status, code;
      try {
        const created = await client.call('/circuits', 'POST', { title: `Capacity ${name} ${index}`, document });
        status = created.status; code = created.data?.code;
        if (name === 'oversized') { assert.equal(created.status, 413); return { ms: performance.now() - since, failed: false }; }
        assert.equal(created.status, 201, `create HTTP ${created.status}, code ${created.data?.code}`);
        const draft = created.data.circuit; if (!firstDraft && index === 0) firstDraft = draft;
        stage = 'read'; const read = await client.call(`/circuits/${draft.id}`); status = read.status; code = read.data?.code; assert.equal(read.status, 200); assert.deepEqual(read.data.circuit.document, document);
        stage = 'save'; const save = await client.call(`/circuits/${draft.id}`, 'PUT', { title: draft.title, document, revision: draft.revision, writeId: randomUUID() }); status = save.status; code = save.data?.code; assert.equal(save.status, 200);
        return { ms: performance.now() - since, failed: false };
      } catch (error) { return { ms: performance.now() - since, failed: true, error: error.name, transportCode: error.cause?.code, stage, status, code }; }
    }));
    const elapsedMs = performance.now() - start, after = resources(), times = measurements.map(item => item.ms).sort((a, b) => a - b), failures = measurements.filter(item => item.failed).length;
    const p95Ms = times[Math.min(times.length - 1, Math.ceil(times.length * .95) - 1)];
    result.samples.push({ document: name, expectedStatus: name === 'oversized' ? 413 : 200, jsonBytes: Buffer.byteLength(JSON.stringify(document)), members: concurrency, operationsPerMember: name === 'oversized' ? 1 : 3, elapsedMs, p50Ms: times[Math.ceil(times.length * .5) - 1], p95Ms, failures, failureDetails: measurements.filter(item => item.failed).map(({ ms, ...item }) => item), failureRate: failures / concurrency, resourcesBefore: before, resourcesAfter: after });
    console.log(`[capacity] ${name} / ${concurrency} members: ${failures} failures, p95=${p95Ms.toFixed(0)}ms`);
  }
  assert.equal((await clients[1].call(`/circuits/${firstDraft.id}`)).status, 404);
  const current = (await clients[0].call(`/circuits/${firstDraft.id}`)).data.circuit;
  const races = await Promise.all(['race-a', 'race-b'].map(title => clients[0].call(`/circuits/${current.id}`, 'PUT', { title, document: current.document, revision: current.revision, writeId: randomUUID() })));
  assert.deepEqual(races.map(item => item.status).sort(), [200, 409]);
  result.twoAccountDenial = true; result.saveConflict = true;
  if (result.samples.some(sample => sample.failures)) process.exitCode = 1;
} catch (error) { result.failure = error.name; process.exitCode = 1; }
finally {
  await fixture.stop();
  const output = path.join(root, '.local/acceptance-public'); await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'capacity.json'), JSON.stringify(result, null, 2));
  await writeFile(path.join(output, `capacity-${result.at.replaceAll(':', '-')}.json`), JSON.stringify(result, null, 2));
  console.log(`脱敏容量结果：${path.join(output, 'capacity.json')}`);
}
