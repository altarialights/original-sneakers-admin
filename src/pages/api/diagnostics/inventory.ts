import type { APIRoute } from 'astro';
import { createClient } from '@libsql/client/web';

export const prerender = false;

type DiagnosticErrorCode = 'DB_ENV_MISSING' | 'DB_ENV_ACCESS_FAILED' | 'DB_AUTH_FAILED' | 'DB_CONNECTION_FAILED';

function response(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff'
    }
  });
}

function diagnosticErrorCode(error: unknown): DiagnosticErrorCode {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code).toUpperCase()
    : '';
  const name = error instanceof Error ? error.name.toUpperCase() : '';
  const message = error instanceof Error ? error.message.toUpperCase() : '';
  const fingerprint = `${code} ${name} ${message}`;
  if (/(AUTH|UNAUTHORIZED|JWT|TOKEN)/.test(fingerprint)) return 'DB_AUTH_FAILED';
  return 'DB_CONNECTION_FAILED';
}

export const GET: APIRoute = async () => {
  let databaseUrl: string | undefined;
  let authToken: string | undefined;

  try {
    const { getSecret } = await import('astro:env/server');
    databaseUrl = getSecret('TURSO_DATABASE_URL')?.trim();
    authToken = getSecret('TURSO_AUTH_TOKEN')?.trim();
  } catch (error) {
    console.error('[inventory] DB env access failed:', error instanceof Error ? error.name : 'UNKNOWN_ERROR');
    return response({
      environment: { databaseUrlConfigured: false, authTokenConfigured: false },
      database: { connection: 'error', errorCode: 'DB_ENV_ACCESS_FAILED' }
    }, 500);
  }

  const environment = {
    databaseUrlConfigured: Boolean(databaseUrl),
    authTokenConfigured: Boolean(authToken)
  };
  console.info(`[inventory] DB env available: url=${environment.databaseUrlConfigured} token=${environment.authTokenConfigured}`);

  if (!databaseUrl || !authToken) {
    console.error('[inventory] DB connection failed: DB_ENV_MISSING');
    return response({ environment, database: { connection: 'error', errorCode: 'DB_ENV_MISSING' } }, 500);
  }

  const client = createClient({ url: databaseUrl, authToken, intMode: 'number' });
  try {
    const [products, variants, units, movements] = await client.batch([
      'SELECT COUNT(*) AS total FROM productos',
      'SELECT COUNT(*) AS total FROM variantes_producto',
      'SELECT COALESCE(SUM(cantidad), 0) AS total FROM niveles_inventario',
      'SELECT COUNT(*) AS total FROM movimientos_inventario'
    ], 'read');
    const counts = {
      productos: Number(products.rows[0]?.total ?? 0),
      variantes: Number(variants.rows[0]?.total ?? 0),
      unidades: Number(units.rows[0]?.total ?? 0),
      movimientos: Number(movements.rows[0]?.total ?? 0)
    };
    console.info('[inventory] DB connection OK');
    console.info(`[inventory] products count: ${counts.productos}`);
    console.info(`[inventory] variants count: ${counts.variantes}`);
    console.info(`[inventory] units count: ${counts.unidades}`);
    console.info(`[inventory] movements count: ${counts.movimientos}`);
    return response({ environment, database: { connection: 'ok', ...counts } });
  } catch (error) {
    const errorCode = diagnosticErrorCode(error);
    const providerCode = typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'UNKNOWN'
      : 'UNKNOWN';
    console.error(`[inventory] DB connection failed: ${errorCode} providerCode=${providerCode}`);
    return response({ environment, database: { connection: 'error', errorCode } }, 500);
  } finally {
    client.close();
  }
};
