import { build } from 'esbuild';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
export async function lessonFunctions() {
  const result = await build({ stdin: { contents: 'export * from "./app/simulator/core/lessons";export * from "./app/simulator/core/engine";export * from "./app/simulator/core/catalog";export * from "./app/simulator/editor/geometry";', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
export function largeDocument(waypointCount = 256) {
  const document = { schemaVersion: 1, title: 'Capacity: existing 1000-wire regression', components: Array.from({ length: 12 }, (_, index) => ({ id: `xt${index}`, type: 'terminal', label: `XT${index}`, position: { x: index * 150, y: 0 } })), wires: [] };
  const terminals = document.components.flatMap(component => ['A', 'B', 'A2', 'B2'].map(terminalId => ({ componentId: component.id, terminalId })));
  const waypoints = Array.from({ length: waypointCount }, (_, index) => ({ x: index % 2, y: index % 3 }));
  for (let from = 0; from < terminals.length; from++) for (let to = from + 1; to < terminals.length && document.wires.length < 1000; to++) document.wires.push({ id: `w${document.wires.length}`, from: terminals[from], to: terminals[to], color: '#000000', waypoints });
  return document;
}
export class TestClient {
  cookie = '';
  constructor(origin, { freshConnections = false } = {}) { this.origin = origin; this.freshConnections = freshConnections; }
  async call(route, method = 'GET', body) {
    const response = await fetch(`${this.origin}/api${route}`, { method, headers: { cookie: this.cookie, ...(this.freshConnections ? { connection: 'close' } : {}), ...(method !== 'GET' ? { origin: this.origin, 'content-type': 'application/json' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) this.cookie = cookies.map(value => value.split(';')[0]).join('; ');
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  }
  async login(credentials) {
    const result = await this.call('/auth/sign-in/username', 'POST', { username: credentials.username, password: credentials.password });
    if (result.status !== 200) throw new Error(`Test login HTTP ${result.status}`);
  }
}
