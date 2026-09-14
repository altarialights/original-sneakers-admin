import type { Client } from '@libsql/client';
import { createClient } from '@libsql/client/web';

export interface DatabaseCredentials {
  url: string;
  authToken: string;
}

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigurationError';
  }
}

export class DatabaseOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseOperationError';
  }
}

let clientPromise: Promise<Client> | undefined;

async function readCredentials(environment: NodeJS.ProcessEnv = process.env): Promise<DatabaseCredentials> {
  let url = environment.TURSO_DATABASE_URL?.trim();
  let authToken = environment.TURSO_AUTH_TOKEN?.trim();

  if (!url || !authToken) {
    const { getSecret } = await import('astro:env/server');
    url ||= getSecret('TURSO_DATABASE_URL')?.trim();
    authToken ||= getSecret('TURSO_AUTH_TOKEN')?.trim();
  }

  if (!url || !authToken) {
    throw new DatabaseConfigurationError(
      'Faltan TURSO_DATABASE_URL o TURSO_AUTH_TOKEN. Configura ambas variables server-side.'
    );
  }

  return { url, authToken };
}

async function initializeClient(): Promise<Client> {
  const credentials = await readCredentials();
  const client = createClient({
    url: credentials.url,
    authToken: credentials.authToken,
    intMode: 'number'
  });

  try {
    await client.execute('PRAGMA foreign_keys = ON');
    const result = await client.execute('PRAGMA foreign_keys');
    const enabled = Number(result.rows[0]?.foreign_keys ?? 0) === 1;

    if (!enabled) {
      throw new DatabaseOperationError('La conexión no tiene foreign_keys habilitado.');
    }

    return client;
  } catch (error) {
    client.close();
    if (error instanceof DatabaseOperationError) throw error;
    throw sanitizeDatabaseError('No se pudo inicializar la conexión con Turso.', error);
  }
}

export function getDatabaseClient(): Promise<Client> {
  clientPromise ??= initializeClient();
  return clientPromise;
}

export async function closeDatabaseClient(): Promise<void> {
  if (!clientPromise) return;

  try {
    const client = await clientPromise.catch(() => undefined);
    client?.close();
  } finally {
    clientPromise = undefined;
  }
}

export function sanitizeDatabaseError(message: string, error: unknown): DatabaseOperationError {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? ` Código: ${error.code}.`
      : '';

  return new DatabaseOperationError(`${message}${code}`);
}
