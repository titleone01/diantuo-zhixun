import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSchema, compareSchema, migratedDatabase, schemaModel } from '../scripts/check-schema.mjs';

test('all authoritative migrations agree with schema tables, columns, defaults, indexes and foreign keys', async () => {
  const result = await checkSchema(); assert.equal(result.tables, 14); assert.ok(result.migrations >= 6);
});
test('schema check catches dropped lookup indexes and unexpected columns', async () => {
  const model = await schemaModel(), db = await migratedDatabase();
  try {
    db.exec('DROP INDEX training_drawings_media; ALTER TABLE circuits ADD COLUMN unintended TEXT;');
    const issues = compareSchema(db, model);
    assert.ok(issues.some(issue => issue.includes('training_drawings_media')));
    assert.ok(issues.some(issue => issue.includes('circuits: column inventory')));
    const altered = model.map(table => table.name === 'session' ? { ...table, foreignKeys: [] } : table);
    assert.ok(compareSchema(db, altered).some(issue => issue.includes('session: foreign keys')));
  } finally { db.close(); }
});
