import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from '@libsql/client';
import { DatabaseOperationError, sanitizeDatabaseError } from './client.ts';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS_DIRECTORY = resolve(PROJECT_ROOT, 'migrations');
const MIGRATION_NAME_PATTERN = /^\d{3,}_[a-z0-9_-]+\.sql$/i;
const BEGIN_IMMEDIATE_PATTERN = /\bBEGIN\s+IMMEDIATE\s*;/i;
const TERMINAL_COMMIT_PATTERN = /\bCOMMIT\s*;\s*$/i;

const CREATE_MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS migraciones_aplicadas (
    nombre TEXT NOT NULL PRIMARY KEY,
    checksum TEXT NOT NULL,
    aplicado_en_ms INTEGER NOT NULL,
    CONSTRAINT ck_migraciones_aplicadas_nombre CHECK (length(trim(nombre)) > 0),
    CONSTRAINT ck_migraciones_aplicadas_checksum CHECK (
      length(checksum) = 64 AND checksum NOT GLOB '*[^0-9a-f]*'
    ),
    CONSTRAINT ck_migraciones_aplicadas_fecha CHECK (aplicado_en_ms >= 0)
  )
`;

export interface MigrationFile {
  name: string;
  checksum: string;
  sql: string;
}

export interface MigrationState extends MigrationFile {
  state: 'APLICADA' | 'PENDIENTE' | 'CHECKSUM_DIFERENTE';
  appliedChecksum?: string;
  appliedAtMs?: number;
}

export interface MigrationRunResult {
  applied: MigrationFile[];
  skipped: MigrationFile[];
}

function checksum(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export async function readMigrationFiles(): Promise<MigrationFile[]> {
  const entries = await readdir(MIGRATIONS_DIRECTORY, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && MIGRATION_NAME_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    names.map(async (name) => {
      const migrationPath = resolve(MIGRATIONS_DIRECTORY, name);
      if (dirname(migrationPath) !== MIGRATIONS_DIRECTORY) {
        throw new DatabaseOperationError('Se detectó una ruta de migración no permitida.');
      }

      const sql = await readFile(migrationPath, 'utf8');
      return { name, checksum: checksum(sql), sql };
    })
  );
}

async function migrationsTableExists(client: Client): Promise<boolean> {
  const result = await client.execute({
    sql: `SELECT 1 AS existe FROM sqlite_schema WHERE type = 'table' AND name = ? LIMIT 1`,
    args: ['migraciones_aplicadas']
  });
  return result.rows.length === 1;
}

async function appliedMigrations(client: Client): Promise<Map<string, { checksum: string; appliedAtMs: number }>> {
  if (!(await migrationsTableExists(client))) return new Map();

  const result = await client.execute(
    'SELECT nombre, checksum, aplicado_en_ms FROM migraciones_aplicadas ORDER BY nombre'
  );
  return new Map(
    result.rows.map((row) => [
      String(row.nombre),
      { checksum: String(row.checksum), appliedAtMs: Number(row.aplicado_en_ms) }
    ])
  );
}

export async function getMigrationStatus(client: Client): Promise<MigrationState[]> {
  const [files, applied] = await Promise.all([readMigrationFiles(), appliedMigrations(client)]);

  return files.map((file) => {
    const record = applied.get(file.name);
    if (!record) return { ...file, state: 'PENDIENTE' };

    return {
      ...file,
      state: record.checksum === file.checksum ? 'APLICADA' : 'CHECKSUM_DIFERENTE',
      appliedChecksum: record.checksum,
      appliedAtMs: record.appliedAtMs
    };
  });
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function buildAtomicMigrationSql(migration: MigrationFile, appliedAtMs: number): string {
  if (!BEGIN_IMMEDIATE_PATTERN.test(migration.sql) || !TERMINAL_COMMIT_PATTERN.test(migration.sql)) {
    throw new DatabaseOperationError(
      `La migración ${migration.name} debe contener BEGIN IMMEDIATE y terminar en COMMIT.`
    );
  }

  const registration = `BEGIN IMMEDIATE;

INSERT INTO migraciones_aplicadas (nombre, checksum, aplicado_en_ms)
VALUES (${quoteSqlLiteral(migration.name)}, ${quoteSqlLiteral(migration.checksum)}, ${appliedAtMs});`;

  return migration.sql.replace(BEGIN_IMMEDIATE_PATTERN, registration);
}

export async function runPendingMigrations(client: Client): Promise<MigrationRunResult> {
  try {
    await client.execute(CREATE_MIGRATIONS_TABLE_SQL);
    const status = await getMigrationStatus(client);
    const mismatch = status.find((migration) => migration.state === 'CHECKSUM_DIFERENTE');

    if (mismatch) {
      throw new DatabaseOperationError(
        `Checksum diferente para ${mismatch.name}. Las migraciones aplicadas son append-only; ejecución abortada.`
      );
    }

    const applied: MigrationFile[] = [];
    const skipped = status.filter((migration) => migration.state === 'APLICADA');

    for (const migration of status.filter((item) => item.state === 'PENDIENTE')) {
      const atomicSql = buildAtomicMigrationSql(migration, Date.now());
      await client.executeMultiple(atomicSql);

      const verification = await client.execute({
        sql: 'SELECT checksum FROM migraciones_aplicadas WHERE nombre = ?',
        args: [migration.name]
      });
      if (String(verification.rows[0]?.checksum ?? '') !== migration.checksum) {
        throw new DatabaseOperationError(`No se pudo verificar el registro de ${migration.name}.`);
      }
      applied.push(migration);
    }

    return { applied, skipped };
  } catch (error) {
    if (error instanceof DatabaseOperationError) throw error;
    throw sanitizeDatabaseError('Falló la aplicación de migraciones; ejecución detenida.', error);
  }
}
