import {
  checkDatabaseHealth,
  closeDatabaseClient,
  DatabaseConfigurationError,
  DatabaseOperationError,
  getDatabaseClient,
  getMigrationStatus,
  runPendingMigrations
} from '../src/lib/db/index.ts';

type Command = 'health' | 'migrate' | 'status';

function printHealth(health: Awaited<ReturnType<typeof checkDatabaseHealth>>): void {
  console.log('Conexión Turso: OK');
  console.log('SELECT 1: OK');
  console.log(`Foreign keys: ${health.foreignKeysEnabled ? 'ON' : 'OFF'}`);
  console.log(`foreign_key_check: ${health.foreignKeyViolations} incidencia(s)`);
  console.log(`Tablas de negocio: ${health.businessTableCount}`);
  console.log(`Filas de negocio: ${health.businessRowCount}`);
  console.log(`Índices explícitos: ${health.indexCount}`);
  console.log(`Triggers: ${health.triggerCount}`);
  console.log(`Tablas: ${health.tables.length > 0 ? health.tables.join(', ') : '(ninguna)'}`);
}

async function showStatus(): Promise<void> {
  const client = await getDatabaseClient();
  const status = await getMigrationStatus(client);
  const applied = status.filter((migration) => migration.state === 'APLICADA').length;
  const pending = status.filter((migration) => migration.state === 'PENDIENTE').length;

  console.log(`Migraciones encontradas: ${status.length}`);
  console.log(`Aplicadas: ${applied}`);
  console.log(`Pendientes: ${pending}`);
  for (const migration of status) {
    console.log(`${migration.name} | ${migration.state} | sha256:${migration.checksum}`);
  }

  if (status.some((migration) => migration.state === 'CHECKSUM_DIFERENTE')) {
    throw new DatabaseOperationError('Hay migraciones aplicadas cuyo checksum no coincide.');
  }
}

async function migrate(): Promise<void> {
  const client = await getDatabaseClient();
  const result = await runPendingMigrations(client);

  for (const migration of result.skipped) {
    console.log(`Omitida (ya aplicada): ${migration.name} | sha256:${migration.checksum}`);
  }
  for (const migration of result.applied) {
    console.log(`Aplicada: ${migration.name} | sha256:${migration.checksum}`);
  }
  console.log(`Resultado: ${result.applied.length} aplicada(s), ${result.skipped.length} omitida(s).`);
}

async function main(): Promise<void> {
  const command = process.argv[2] as Command | undefined;

  if (command === 'health') {
    printHealth(await checkDatabaseHealth(await getDatabaseClient()));
    return;
  }
  if (command === 'status') {
    await showStatus();
    return;
  }
  if (command === 'migrate') {
    await migrate();
    return;
  }

  throw new DatabaseOperationError('Comando inválido. Usa health, status o migrate.');
}

try {
  await main();
} catch (error) {
  if (error instanceof DatabaseConfigurationError || error instanceof DatabaseOperationError) {
    console.error(`ERROR: ${error.message}`);
  } else {
    console.error('ERROR: fallo inesperado del comando de base de datos.');
  }
  process.exitCode = 1;
} finally {
  await closeDatabaseClient();
}
