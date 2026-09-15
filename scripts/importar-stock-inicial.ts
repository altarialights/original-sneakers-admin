import { createHash, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Client, Transaction } from '@libsql/client';
import {
  closeDatabaseClient,
  DatabaseConfigurationError,
  DatabaseOperationError,
  getDatabaseClient
} from '../src/lib/db/index.ts';
import {
  analyzeRows,
  fingerprintAlreadyImported,
  hashJson,
  normalizeKey,
  normalizeGtin,
  type ImportAnalysis,
  type ImportError,
  type ProductInput,
  type VariantInput
} from './stock-import/core.ts';
import { loadWorkbook } from './stock-import/excel.ts';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIRECTORY = resolve(PROJECT_ROOT, 'data');
const IMPORT_CHANNEL_CODE = 'IMPORTACION_STOCK_EXCEL';
const CREATED_BY = 'scripts/importar-stock-inicial.ts';

interface CliOptions {
  commit: boolean;
  filePath?: string;
}

interface DatabaseAudit {
  productCount: number;
  variantCount: number;
  inventoryLevelCount: number;
  inventoryMovementCount: number;
  matchingProducts: number;
  matchingVariants: number;
  duplicateFingerprint: boolean;
  errors: ImportError[];
}

function parseArguments(args: string[]): CliOptions {
  const commit = args.includes('--commit');
  if (commit && args.includes('--dry-run')) throw new Error('Usa --dry-run o --commit, no ambos.');
  const fileFlagIndex = args.indexOf('--archivo');
  if (fileFlagIndex >= 0 && !args[fileFlagIndex + 1]) throw new Error('--archivo requiere una ruta.');
  const unknown = args.filter((arg, index) =>
    arg !== '--commit' && arg !== '--dry-run' && arg !== '--archivo' && index !== fileFlagIndex + 1
  );
  if (unknown.length > 0) throw new Error(`Argumentos no reconocidos: ${unknown.join(', ')}.`);
  return { commit, filePath: fileFlagIndex >= 0 ? args[fileFlagIndex + 1] : undefined };
}

async function findDefaultWorkbook(): Promise<string> {
  const matches = (await readdir(DATA_DIRECTORY))
    .filter((name) => /^STOCK ORIGINAL SNEAKERS.*\.xlsx$/i.test(name) && !name.startsWith('~$'))
    .sort();
  if (matches.length !== 1) {
    throw new Error(`Se esperaba un único Excel STOCK ORIGINAL SNEAKERS en data/; encontrados: ${matches.length}.`);
  }
  return resolve(DATA_DIRECTORY, matches[0]);
}

async function sha256File(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

function uuidV7(now = Date.now()): string {
  const bytes = randomBytes(16);
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

async function countRows(client: Client, table: string): Promise<number> {
  const result = await client.execute(`SELECT COUNT(*) AS total FROM ${table}`);
  return Number(result.rows[0]?.total ?? 0);
}

async function auditDatabase(client: Client, analysis: ImportAnalysis, fingerprint: string): Promise<DatabaseAudit> {
  const expectedTables = [
    'productos',
    'variantes_producto',
    'ubicaciones_inventario',
    'niveles_inventario',
    'canales',
    'movimientos_inventario',
    'ejecuciones_sincronizacion',
    'registros_externos_raw'
  ];
  const schema = await client.execute({
    sql: `SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN (${placeholders(expectedTables.length)})`,
    args: expectedTables
  });
  const foundTables = new Set(schema.rows.map((row) => String(row.name)));
  const missingTables = expectedTables.filter((table) => !foundTables.has(table));
  if (missingTables.length > 0) {
    return {
      productCount: 0,
      variantCount: 0,
      inventoryLevelCount: 0,
      inventoryMovementCount: 0,
      matchingProducts: 0,
      matchingVariants: 0,
      duplicateFingerprint: false,
      errors: [{ code: 'SCHEMA_INCOMPLETO', message: `Faltan tablas del esquema inicial: ${missingTables.join(', ')}.` }]
    };
  }

  const [productCount, variantCount, inventoryLevelCount, inventoryMovementCount, fingerprintRows] = await Promise.all([
    countRows(client, 'productos'),
    countRows(client, 'variantes_producto'),
    countRows(client, 'niveles_inventario'),
    countRows(client, 'movimientos_inventario'),
    client.execute({
      sql: `SELECT hash_snapshot FROM ejecuciones_sincronizacion
            WHERE tipo = 'IMPORTACION_INICIAL' AND hash_snapshot = ? LIMIT 1`,
      args: [fingerprint]
    })
  ]);
  const duplicateFingerprint = fingerprintAlreadyImported(
    fingerprint,
    fingerprintRows.rows.map((row) => String(row.hash_snapshot))
  );
  const errors: ImportError[] = [];
  if (duplicateFingerprint) {
    errors.push({ code: 'ARCHIVO_YA_IMPORTADO', message: `El SHA-256 ${fingerprint} ya consta como importado.` });
  }

  let matchingProducts = 0;
  let matchingVariants = 0;
  const references = [...new Set(analysis.products.map((product) => product.referenciaNormalizada))];
  if (references.length > 0) {
    const existingProducts = await client.execute({
      sql: `SELECT id, marca_normalizada, nombre_modelo, referencia_normalizada, colorway_normalizado
            FROM productos WHERE referencia_normalizada IN (${placeholders(references.length)}) AND archivado_en_ms IS NULL`,
      args: references
    });
    const importedKeys = new Set(analysis.products.map((product) => product.key));
    const matchingProductIds: string[] = [];
    for (const row of existingProducts.rows) {
      const key = JSON.stringify([
        normalizeKey(row.marca_normalizada),
        normalizeKey(row.nombre_modelo),
        normalizeKey(row.referencia_normalizada),
        normalizeKey(row.colorway_normalizado)
      ]);
      if (importedKeys.has(key)) matchingProductIds.push(String(row.id));
    }
    matchingProducts = matchingProductIds.length;
    if (matchingProducts > 0) {
      const variants = await client.execute({
        sql: `SELECT COUNT(*) AS total FROM variantes_producto
              WHERE producto_id IN (${placeholders(matchingProductIds.length)}) AND archivado_en_ms IS NULL`,
        args: matchingProductIds
      });
      matchingVariants = Number(variants.rows[0]?.total ?? 0);
      errors.push({
        code: 'PRODUCTOS_EXISTENTES',
        message: `${matchingProducts} producto(s) canónico(s) del Excel ya existen en Turso (${matchingVariants} variante(s)); no se duplicarán.`
      });
    }
  }

  const barcodes = [...new Set(
    analysis.variants
      .map((variant) => normalizeGtin(variant.barcode))
      .filter((value): value is string => Boolean(value))
  )];
  if (barcodes.length > 0) {
    const barcodeMatches = await client.execute({
      sql: `SELECT COUNT(DISTINCT id) AS total FROM variantes_producto
            WHERE substr('00000000000000' || replace(replace(trim(barcode_normalizado), ' ', ''), '-', ''), -14)
              IN (${placeholders(barcodes.length)}) AND archivado_en_ms IS NULL`,
      args: barcodes
    });
    const total = Number(barcodeMatches.rows[0]?.total ?? 0);
    if (total > 0 && matchingProducts === 0) {
      errors.push({ code: 'UPC_EXISTENTE', message: `${total} variante(s) existente(s) usan UPC presentes en el Excel.` });
    }
  }

  const channel = await client.execute({
    sql: 'SELECT tipo, esta_activo FROM canales WHERE codigo = ? LIMIT 1',
    args: [IMPORT_CHANNEL_CODE]
  });
  if (channel.rows.length > 0 && (channel.rows[0].tipo !== 'TIENDA_FISICA' || Number(channel.rows[0].esta_activo) !== 1)) {
    errors.push({
      code: 'CANAL_IMPORTACION_INVALIDO',
      message: `El canal ${IMPORT_CHANNEL_CODE} existe pero no es TIENDA_FISICA activo.`
    });
  }

  return {
    productCount,
    variantCount,
    inventoryLevelCount,
    inventoryMovementCount,
    matchingProducts,
    matchingVariants,
    duplicateFingerprint,
    errors
  };
}

async function insertProduct(tx: Transaction, product: ProductInput, now: number): Promise<string> {
  const id = uuidV7(now);
  await tx.execute({
    sql: `INSERT INTO productos (
      id, titulo_canonico, marca_original, marca_normalizada, nombre_modelo,
      colorway_original, colorway_normalizado, referencia_original, referencia_normalizada,
      clave_normalizada, version_normalizacion, tipo_producto, estado, estado_revision,
      creado_en_ms, actualizado_en_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'BORRADOR', 'SIN_REVISAR', ?, ?)`,
    args: [
      id, product.tituloCanonico, product.marcaOriginal, product.marcaNormalizada, product.modelo,
      product.colorwayOriginal, product.colorwayNormalizado, product.referenciaOriginal,
      product.referenciaNormalizada, product.key, product.tipoProducto, now, now
    ]
  });
  return id;
}

async function insertVariant(
  tx: Transaction,
  variant: VariantInput,
  productId: string,
  now: number
): Promise<string> {
  const id = uuidV7(now);
  await tx.execute({
    sql: `INSERT INTO variantes_producto (
      id, producto_id, titulo_variante, barcode_original, barcode_normalizado,
      talla_original, sistema_talla, valor_talla_milesimas, etiqueta_talla, longitud_pie_mm,
      grupo_edad, publico_genero, firma_opciones_json, precio_centimos,
      precio_comparacion_centimos, moneda, estado, requiere_revision, creado_en_ms, actualizado_en_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'BORRADOR', 0, ?, ?)`,
    args: [
      id, productId, variant.title, variant.barcode, variant.barcode, variant.originalSize,
      variant.sizeSystem, variant.sizeThousandths, variant.sizeLabel, variant.footLengthMm,
      variant.ageGroup, variant.gender, variant.optionsSignature, variant.priceCents,
      variant.compareAtPriceCents, now, now
    ]
  });
  return id;
}

async function getOrCreateChannel(tx: Transaction, now: number): Promise<string> {
  const existing = await tx.execute({ sql: 'SELECT id FROM canales WHERE codigo = ? LIMIT 1', args: [IMPORT_CHANNEL_CODE] });
  if (existing.rows[0]?.id) return String(existing.rows[0].id);
  const id = uuidV7(now);
  await tx.execute({
    sql: `INSERT INTO canales (id, codigo, nombre, tipo, esta_activo, configuracion_json, creado_en_ms, actualizado_en_ms)
          VALUES (?, ?, 'Importación stock Excel', 'TIENDA_FISICA', 1, ?, ?, ?)`,
    args: [id, IMPORT_CHANNEL_CODE, JSON.stringify({ uso: 'IMPORTACION_INICIAL_STOCK' }), now, now]
  });
  return id;
}

async function getOrCreateLocations(tx: Transaction, variants: VariantInput[], now: number): Promise<Map<string, string>> {
  const locations = new Map<string, string>();
  for (const variant of variants) {
    if (locations.has(variant.locationCode)) continue;
    const existing = await tx.execute({
      sql: 'SELECT id, nombre, tipo, esta_activa FROM ubicaciones_inventario WHERE codigo = ? LIMIT 1',
      args: [variant.locationCode]
    });
    if (existing.rows.length > 0) {
      if (existing.rows[0].tipo !== 'TIENDA' || Number(existing.rows[0].esta_activa) !== 1) {
        throw new Error(`La ubicación ${variant.locationCode} existe pero no es una TIENDA activa.`);
      }
      locations.set(variant.locationCode, String(existing.rows[0].id));
      continue;
    }
    const id = uuidV7(now);
    await tx.execute({
      sql: `INSERT INTO ubicaciones_inventario
            (id, codigo, nombre, tipo, esta_activa, creado_en_ms, actualizado_en_ms)
            VALUES (?, ?, ?, 'TIENDA', 1, ?, ?)`,
      args: [id, variant.locationCode, variant.locationName, now, now]
    });
    locations.set(variant.locationCode, id);
  }
  return locations;
}

async function commitImport(
  client: Client,
  analysis: ImportAnalysis,
  fingerprint: string,
  fileName: string,
  sheetName: string
): Promise<void> {
  const tx = await client.transaction('write');
  try {
    const duplicate = await tx.execute({
      sql: `SELECT 1 AS existe FROM ejecuciones_sincronizacion
            WHERE tipo = 'IMPORTACION_INICIAL' AND hash_snapshot = ? LIMIT 1`,
      args: [fingerprint]
    });
    if (duplicate.rows.length > 0) throw new Error('El archivo ya fue importado; transacción cancelada.');

    const now = Date.now();
    const channelId = await getOrCreateChannel(tx, now);
    const locationIds = await getOrCreateLocations(tx, analysis.variants, now);
    const executionId = uuidV7(now);
    await tx.execute({
      sql: `INSERT INTO ejecuciones_sincronizacion (
        id, canal_id, tipo, direccion, estado, iniciado_en_ms, finalizado_en_ms,
        elementos_vistos, elementos_correctos, elementos_fallidos, hash_snapshot, metadata_json
      ) VALUES (?, ?, 'IMPORTACION_INICIAL', 'ENTRADA', 'COMPLETADA', ?, ?, ?, ?, 0, ?, ?)`,
      args: [
        executionId, channelId, now, now, analysis.realRows, analysis.realRows, fingerprint,
        JSON.stringify({
          archivo: fileName,
          hoja: sheetName,
          filas_fisicas: analysis.physicalRows,
          filas_reales: analysis.realRows,
          productos: analysis.products.length,
          variantes: analysis.variants.length,
          unidades_declaradas: analysis.declaredUnits,
          unidades_resultantes: analysis.resultingUnits
        })
      ]
    });

    const rawRows = new Map<number, Record<string, unknown>>();
    for (const variant of analysis.variants) {
      for (const allocation of variant.allocations) rawRows.set(allocation.rowNumber, allocation.raw);
    }
    for (const [rowNumber, raw] of rawRows) {
      await tx.execute({
        sql: `INSERT INTO registros_externos_raw (
          id, ejecucion_id, canal_id, tipo_entidad, id_externo, payload_json, hash_payload,
          observado_en_ms, estado_procesamiento
        ) VALUES (?, ?, ?, 'VARIANTE', ?, ?, ?, ?, 'PROCESADO')`,
        args: [
          uuidV7(now), executionId, channelId, `${fingerprint}:fila:${rowNumber}`,
          JSON.stringify(raw), hashJson(raw), now
        ]
      });
    }

    const productIds = new Map<string, string>();
    for (const product of analysis.products) productIds.set(product.key, await insertProduct(tx, product, now));
    for (const variant of analysis.variants) {
      const productId = productIds.get(variant.productKey);
      const locationId = locationIds.get(variant.locationCode);
      if (!productId || !locationId) throw new Error('No se pudo resolver producto o ubicación durante la transacción.');
      const variantId = await insertVariant(tx, variant, productId, now);
      let balance = 0;
      for (const allocation of variant.allocations) {
        balance += allocation.quantity;
        await tx.execute({
          sql: `INSERT INTO movimientos_inventario (
            id, variante_id, ubicacion_id, tipo, delta, saldo_posterior, clave_idempotencia,
            origen, referencia_origen, coste_unitario_centimos, moneda_coste, proveedor_original,
            referencia_factura, metadata_json, ocurrido_en_ms, creado_en_ms, creado_por
          ) VALUES (?, ?, ?, 'SALDO_INICIAL', ?, ?, ?, 'IMPORTACION', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            uuidV7(now), variantId, locationId, allocation.quantity, balance,
            `stock-inicial:${fingerprint}:${allocation.rowNumber}:${allocation.allocationIndex}`,
            `${fileName}:fila:${allocation.rowNumber}`,
            allocation.costCents,
            allocation.costCents === null ? null : 'EUR',
            allocation.supplier,
            allocation.invoice,
            JSON.stringify({
              sha256_archivo: fingerprint,
              fila_excel: allocation.rowNumber,
              talla_original: variant.originalSize,
              etiqueta_talla: variant.sizeLabel,
              notas: allocation.notes
            }),
            allocation.purchaseDateMs ?? now,
            now,
            CREATED_BY
          ]
        });
      }
      await tx.execute({
        sql: `INSERT INTO niveles_inventario
              (variante_id, ubicacion_id, cantidad, version, actualizado_en_ms)
              VALUES (?, ?, ?, 1, ?)`,
        args: [variantId, locationId, balance, now]
      });
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

function formatRows(warnings: { rowNumber?: number }[]): string {
  const rows = [...new Set(warnings.map((item) => item.rowNumber).filter((value): value is number => value !== undefined))];
  return rows.length > 0 ? ` (filas ${rows.join(', ')})` : '';
}

function printReport(
  filePath: string,
  fingerprint: string,
  analysis: ImportAnalysis,
  audit: DatabaseAudit,
  commit: boolean
): void {
  const allErrors = [...analysis.errors, ...audit.errors];
  console.log('IMPORTACIÓN STOCK ORIGINAL SNEAKERS');
  console.log('');
  console.log(`Modo: ${commit ? 'COMMIT' : 'DRY RUN (sin escrituras)'}`);
  console.log(`Archivo: ${filePath}`);
  console.log(`SHA-256: ${fingerprint}`);
  console.log('');
  console.log(`Filas físicas: ${analysis.physicalRows}`);
  console.log(`Filas reales: ${analysis.realRows}`);
  console.log(`Filas de plantilla ignoradas: ${analysis.ignoredTemplateRows}`);
  console.log('');
  console.log(`Productos detectados: ${analysis.products.length}`);
  console.log(`Variantes resultantes: ${analysis.variants.length}`);
  console.log(`Unidades declaradas Excel: ${analysis.declaredUnits}`);
  console.log(`Unidades resultantes reales: ${analysis.resultingUnits}`);
  console.log('');
  console.log(`Turso antes de importar: ${audit.productCount} producto(s), ${audit.variantCount} variante(s), ${audit.inventoryLevelCount} nivel(es), ${audit.inventoryMovementCount} movimiento(s).`);
  console.log(`Catálogo/inventario vacío: ${audit.productCount + audit.variantCount + audit.inventoryLevelCount + audit.inventoryMovementCount === 0 ? 'SÍ' : 'NO'}`);
  console.log(`Coincidencias canónicas: ${audit.matchingProducts} producto(s), ${audit.matchingVariants} variante(s).`);
  console.log(`Fingerprint ya importado: ${audit.duplicateFingerprint ? 'SÍ' : 'NO'}`);
  console.log('');
  console.log('WARNINGS:');
  if (analysis.warnings.length === 0) console.log('- Ninguno.');
  for (const code of ['UPC_VACIO', 'UPC_MULTITALLA_AMBIGUO', 'FACTURA_VACIA', 'FECHA_COMPRA_VACIA', 'COLORWAY_VACIO', 'UNIDADES_MULTITALLA'] as const) {
    const items = analysis.warnings.filter((item) => item.code === code);
    if (items.length > 0) console.log(`- ${items[0].message} Total: ${items.length}${formatRows(items)}`);
  }
  console.log('');
  console.log('ERRORES:');
  if (allErrors.length === 0) console.log('- Ninguno.');
  for (const error of allErrors) console.log(`- ${error.message}${error.rowNumber ? ` (fila ${error.rowNumber})` : ''}`);
  console.log('');
  console.log(`COMMIT PERMITIDO: ${allErrors.length === 0 ? 'SÍ' : 'NO'}`);
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const filePath = options.filePath ? resolve(PROJECT_ROOT, options.filePath) : await findDefaultWorkbook();
  const [fingerprint, workbook] = await Promise.all([sha256File(filePath), Promise.resolve(loadWorkbook(filePath))]);
  const analysis = analyzeRows(workbook.rows, workbook.physicalRows);
  const client = await getDatabaseClient();
  const audit = await auditDatabase(client, analysis, fingerprint);
  printReport(filePath, fingerprint, analysis, audit, options.commit);
  const errors = [...analysis.errors, ...audit.errors];
  if (errors.length > 0) {
    process.exitCode = 1;
    return;
  }
  if (!options.commit) return;
  await commitImport(client, analysis, fingerprint, workbook.fileName, workbook.sheetName);
  console.log('');
  console.log('COMMIT COMPLETADO: importación atómica registrada correctamente.');
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    await main();
  } catch (error) {
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseOperationError || error instanceof Error) {
      console.error(`ERROR: ${error.message}`);
    } else {
      console.error('ERROR: fallo inesperado del importador.');
    }
    process.exitCode = 1;
  } finally {
    await closeDatabaseClient();
  }
}

export { auditDatabase, commitImport, parseArguments, sha256File, uuidV7 };
