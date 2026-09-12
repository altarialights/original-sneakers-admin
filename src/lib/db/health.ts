import type { Client } from '@libsql/client';
import { DatabaseOperationError, sanitizeDatabaseError } from './client.ts';

export interface DatabaseHealth {
  connected: true;
  foreignKeysEnabled: boolean;
  foreignKeyViolations: number;
  tables: string[];
  businessTableCount: number;
  businessRowCount: number;
  indexCount: number;
  triggerCount: number;
}

export async function checkDatabaseHealth(client: Client): Promise<DatabaseHealth> {
  try {
    const ping = await client.execute('SELECT 1 AS ok');
    if (Number(ping.rows[0]?.ok ?? 0) !== 1) {
      throw new DatabaseOperationError('La comprobación SELECT 1 no devolvió el resultado esperado.');
    }

    await client.execute('PRAGMA foreign_keys = ON');
    const [foreignKeys, violations, schema] = await Promise.all([
      client.execute('PRAGMA foreign_keys'),
      client.execute('PRAGMA foreign_key_check'),
      client.execute(`
        SELECT type, name
        FROM sqlite_schema
        WHERE name NOT LIKE 'sqlite_%'
        ORDER BY type, name
      `)
    ]);

    const tables = schema.rows
      .filter((row) => row.type === 'table')
      .map((row) => String(row.name));
    const businessTableCount = tables.filter((name) => name !== 'migraciones_aplicadas').length;
    let businessRowCount = 0;
    for (const table of tables.filter((name) => name !== 'migraciones_aplicadas')) {
      const safeIdentifier = `"${table.replaceAll('"', '""')}"`;
      const count = await client.execute(`SELECT COUNT(*) AS total FROM ${safeIdentifier}`);
      businessRowCount += Number(count.rows[0]?.total ?? 0);
    }

    return {
      connected: true,
      foreignKeysEnabled: Number(foreignKeys.rows[0]?.foreign_keys ?? 0) === 1,
      foreignKeyViolations: violations.rows.length,
      tables,
      businessTableCount,
      businessRowCount,
      indexCount: schema.rows.filter((row) => row.type === 'index').length,
      triggerCount: schema.rows.filter((row) => row.type === 'trigger').length
    };
  } catch (error) {
    if (error instanceof DatabaseOperationError) throw error;
    throw sanitizeDatabaseError('Falló el diagnóstico de Turso.', error);
  }
}
