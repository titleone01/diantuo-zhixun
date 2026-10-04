import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const canonical = value => JSON.stringify(value);
const quote = name => `"${name.replaceAll('"', '""')}"`;

export async function schemaModel() {
  const result = await build({ stdin: { contents: 'export * as schema from "./db/schema"; export {getTableConfig,SQLiteDialect} from "drizzle-orm/sqlite-core";', resolveDir: root }, bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
  const { schema, getTableConfig, SQLiteDialect } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  const dialect = new SQLiteDialect();
  return Object.values(schema).map(table => {
    const config = getTableConfig(table);
    const columns = config.columns.map(column => ({ name: column.name, type: column.getSQLType().toUpperCase(), notNull: column.notNull, primary: column.primary, default: column.default }));
    const primary = [...columns.filter(column => column.primary).map(column => column.name), ...config.primaryKeys.flatMap(key => key.columns.map(column => column.name))];
    const indexes = config.indexes.map(index => ({ name: index.config.name, unique: Boolean(index.config.unique), columns: index.config.columns.map(column => {
      if (column.name) return { name: column.name, desc: false };
      const sql = dialect.sqlToQuery(column).sql;
      const name = [...sql.matchAll(/"([^"]+)"/g)].at(-1)?.[1];
      if (!name) throw new Error('Unsupported expression index; review schema checker before introducing it');
      return { name, desc: /\bdesc\b/i.test(sql) };
    }) }));
    for (const column of config.columns.filter(column => column.isUnique)) indexes.push({ name: null, unique: true, columns: [{ name: column.name, desc: false }] });
    const foreignKeys = config.foreignKeys.map(key => {
      const reference = key.reference();
      return reference.columns.map((column, index) => ({ from: column.name, table: getTableConfig(reference.foreignTable).name, to: reference.foreignColumns[index].name, onDelete: (key.onDelete ?? 'no action').toUpperCase(), onUpdate: (key.onUpdate ?? 'no action').toUpperCase() }));
    }).flat().sort((a, b) => canonical(a).localeCompare(canonical(b)));
    return { name: config.name, columns, primary, indexes, foreignKeys };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export async function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  try {
    for (const name of (await readdir(path.join(root, 'db/migrations'))).filter(name => name.endsWith('.sql')).sort()) db.exec(await readFile(path.join(root, 'db/migrations', name), 'utf8'));
    return db;
  } catch (error) { db.close(); throw error; }
}

export function compareSchema(db, model) {
  const issues = [];
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
  if (canonical(tables) !== canonical(model.map(table => table.name).sort())) issues.push('table inventory differs');
  for (const table of model) {
    const actual = db.prepare(`PRAGMA table_info(${quote(table.name)})`).all();
    if (canonical(actual.map(column => column.name).sort()) !== canonical(table.columns.map(column => column.name).sort())) issues.push(`${table.name}: column inventory differs`);
    const primary = actual.filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name);
    if (canonical(primary) !== canonical(table.primary)) issues.push(`${table.name}: primary key differs`);
    for (const column of table.columns) {
      const sqlColumn = actual.find(item => item.name === column.name);
      if (!sqlColumn) continue;
      if (sqlColumn.type.toUpperCase() !== column.type || (!primary.includes(column.name) && Boolean(sqlColumn.notnull) !== column.notNull)) issues.push(`${table.name}.${column.name}: type/nullability differs`);
      const expectedDefault = column.default === undefined ? null : typeof column.default === 'string' ? `'${column.default.replaceAll("'", "''")}'` : String(typeof column.default === 'boolean' ? Number(column.default) : column.default);
      if (sqlColumn.dflt_value !== expectedDefault) issues.push(`${table.name}.${column.name}: default differs`);
    }
    const actualIndexes = db.prepare(`PRAGMA index_list(${quote(table.name)})`).all().filter(index => index.origin !== 'pk').map(index => ({ name: index.name, unique: Boolean(index.unique), columns: db.prepare(`PRAGMA index_xinfo(${quote(index.name)})`).all().filter(column => column.key).map(column => ({ name: column.name, desc: Boolean(column.desc) })) }));
    const signature = index => canonical({ unique: index.unique, columns: index.columns });
    for (const expected of table.indexes) if (!actualIndexes.some(actual => signature(actual) === signature(expected) && (expected.unique || expected.name === actual.name))) issues.push(`${table.name}: missing/different index ${expected.name ?? signature(expected)}`);
    for (const actual of actualIndexes) if (!table.indexes.some(expected => signature(actual) === signature(expected))) issues.push(`${table.name}: undeclared index ${actual.name}`);
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${quote(table.name)})`).all().map(key => ({ from: key.from, table: key.table, to: key.to, onDelete: key.on_delete, onUpdate: key.on_update })).sort((a, b) => canonical(a).localeCompare(canonical(b)));
    if (canonical(foreignKeys) !== canonical(table.foreignKeys)) issues.push(`${table.name}: foreign keys differ`);
  }
  if (db.prepare('PRAGMA foreign_key_check').all().length) issues.push('foreign key integrity failure');
  return issues;
}

export async function checkSchema() {
  const model = await schemaModel(), db = await migratedDatabase();
  try { const issues = compareSchema(db, model); if (issues.length) throw new Error(issues.join('\n')); return { tables: model.length, migrations: (await readdir(path.join(root, 'db/migrations'))).filter(name => name.endsWith('.sql')).length }; }
  finally { db.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log('Schema matches authoritative SQL migrations:', await checkSchema()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
