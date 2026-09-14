import type { Client, Transaction } from '@libsql/client';
import { getDatabaseClient } from '../db/index.ts';
import {
  DuplicateProductError,
  DuplicateVariantError,
  InventoryError,
  InventoryNotFoundError,
  ProductHasStockError
} from './errors.ts';
import { uuidV7 } from './ids.ts';
import {
  canonicalProductKey,
  locationCode,
  normalizeKey,
  normalizeText,
  parseSize,
  variantSignature
} from './normalization.ts';
import type {
  CreateProductInput,
  ProductFieldsInput,
  StockReason,
  VariantFieldsInput
} from './types.ts';

const CREATED_BY = 'original-sneakers-admin';

async function transaction<T>(client: Client, callback: (tx: Transaction) => Promise<T>): Promise<T> {
  const tx = await client.transaction('write');
  try {
    const result = await callback(tx);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

async function findProductByKey(tx: Transaction, key: string, excludedId?: string): Promise<string | null> {
  const result = await tx.execute({
    sql: `SELECT id FROM productos WHERE clave_normalizada = ? ${excludedId ? 'AND id <> ?' : ''} LIMIT 1`,
    args: excludedId ? [key, excludedId] : [key]
  });
  return result.rows[0]?.id ? String(result.rows[0].id) : null;
}

async function requireWritableProduct(tx: Transaction, productId: string): Promise<void> {
  const result = await tx.execute({ sql: 'SELECT estado FROM productos WHERE id = ? LIMIT 1', args: [productId] });
  if (!result.rows[0]) throw new InventoryNotFoundError('No encontramos el producto.');
  if (result.rows[0].estado === 'ARCHIVADO') throw new InventoryError('El producto está dado de baja.', 'PRODUCTO_ARCHIVADO', 409);
}

async function resolveLocation(tx: Transaction, name: string): Promise<{ id: string; name: string }> {
  const code = locationCode(name);
  const result = await tx.execute({
    sql: `SELECT id, nombre FROM ubicaciones_inventario
          WHERE codigo = ? AND esta_activa = 1 LIMIT 1`,
    args: [code]
  });
  if (!result.rows[0]) throw new InventoryError('La ubicación indicada no existe o no está activa.', 'UBICACION_INVALIDA');
  return { id: String(result.rows[0].id), name: String(result.rows[0].nombre) };
}

function productValues(input: ProductFieldsInput) {
  const brand = normalizeText(input.brand);
  const model = normalizeText(input.model);
  const reference = normalizeText(input.reference);
  const colorway = normalizeText(input.colorway) || null;
  const key = canonicalProductKey({ brand, model, reference, colorway });
  return {
    brand,
    model,
    reference,
    colorway,
    key,
    title: [brand, model, colorway].filter(Boolean).join(' - ')
  };
}

async function ensureVariantDoesNotExist(
  tx: Transaction,
  productId: string,
  signature: string,
  excludedId?: string
): Promise<void> {
  const result = await tx.execute({
    sql: `SELECT id FROM variantes_producto
          WHERE producto_id = ? AND firma_opciones_json = ? ${excludedId ? 'AND id <> ?' : ''}
          LIMIT 1`,
    args: excludedId ? [productId, signature, excludedId] : [productId, signature]
  });
  if (result.rows[0]?.id) throw new DuplicateVariantError(String(result.rows[0].id));
}

async function insertVariantWithStock(
  tx: Transaction,
  productId: string,
  input: VariantFieldsInput,
  now: number
): Promise<string> {
  const parsedSize = parseSize(input.size);
  const signature = variantSignature(input.sizeSystem, parsedSize.label);
  await ensureVariantDoesNotExist(tx, productId, signature);
  const location = await resolveLocation(tx, input.location);
  const variantId = uuidV7(now);
  const activePrice = input.offerCents ?? input.pvpCents;
  await tx.execute({
    sql: `INSERT INTO variantes_producto (
      id, producto_id, titulo_variante, barcode_original, barcode_normalizado,
      talla_original, sistema_talla, valor_talla_milesimas, etiqueta_talla, longitud_pie_mm,
      grupo_edad, publico_genero, firma_opciones_json, precio_centimos,
      precio_comparacion_centimos, moneda, estado, requiere_revision, creado_en_ms, actualizado_en_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'ACTIVO', 0, ?, ?)`,
    args: [
      variantId, productId, `${parsedSize.label} ${input.sizeSystem}`,
      input.barcode ?? null, input.barcode ? normalizeText(input.barcode) : null,
      normalizeText(input.size), input.sizeSystem, parsedSize.thousandths, parsedSize.label,
      parsedSize.footLengthMm, input.ageGroup, input.gender, signature, activePrice,
      input.offerCents === null || input.offerCents === undefined ? null : input.pvpCents,
      now, now
    ]
  });
  await tx.execute({
    sql: `INSERT INTO movimientos_inventario (
      id, variante_id, ubicacion_id, tipo, delta, saldo_posterior, clave_idempotencia,
      origen, coste_unitario_centimos, moneda_coste, metadata_json,
      ocurrido_en_ms, creado_en_ms, creado_por
    ) VALUES (?, ?, ?, 'COMPRA', ?, ?, ?, 'MANUAL', ?, 'EUR', ?, ?, ?, ?)`,
    args: [
      uuidV7(now), variantId, location.id, input.quantity, input.quantity,
      `alta-manual:${uuidV7(now)}`, input.costCents,
      JSON.stringify({ operacion: 'ALTA_MANUAL', ubicacion: location.name }), now, now, CREATED_BY
    ]
  });
  await tx.execute({
    sql: `INSERT INTO niveles_inventario
          (variante_id, ubicacion_id, cantidad, version, actualizado_en_ms)
          VALUES (?, ?, ?, 1, ?)`,
    args: [variantId, location.id, input.quantity, now]
  });
  return variantId;
}

function ensureUniqueInputVariants(variants: VariantFieldsInput[]): void {
  const signatures = new Set<string>();
  for (const variant of variants) {
    const signature = variantSignature(variant.sizeSystem, parseSize(variant.size).label);
    if (signatures.has(signature)) throw new InventoryError('Hay una talla repetida en el formulario.', 'VARIANTE_DUPLICADA', 409);
    signatures.add(signature);
  }
}

export async function createProduct(input: CreateProductInput, database?: Client): Promise<{ productId: string }> {
  const client = database ?? await getDatabaseClient();
  ensureUniqueInputVariants(input.variants);
  return transaction(client, async (tx) => {
    const values = productValues(input);
    const existingId = await findProductByKey(tx, values.key);
    if (existingId) throw new DuplicateProductError(existingId);
    const now = Date.now();
    const productId = uuidV7(now);
    await tx.execute({
      sql: `INSERT INTO productos (
        id, titulo_canonico, marca_original, marca_normalizada, nombre_modelo,
        colorway_original, colorway_normalizado, referencia_original, referencia_normalizada,
        clave_normalizada, version_normalizacion, tipo_producto, estado, estado_revision,
        creado_en_ms, actualizado_en_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'ACTIVO', 'SIN_REVISAR', ?, ?)`,
      args: [
        productId, values.title, values.brand, normalizeKey(values.brand), values.model,
        values.colorway, values.colorway ? normalizeKey(values.colorway) : null,
        values.reference, normalizeKey(values.reference), values.key, input.type, now, now
      ]
    });
    for (const variant of input.variants) await insertVariantWithStock(tx, productId, variant, now);
    return { productId };
  });
}

export async function addVariants(
  productId: string,
  variants: VariantFieldsInput[],
  database?: Client
): Promise<{ productId: string; variantIds: string[] }> {
  const client = database ?? await getDatabaseClient();
  ensureUniqueInputVariants(variants);
  return transaction(client, async (tx) => {
    await requireWritableProduct(tx, productId);
    const now = Date.now();
    const variantIds: string[] = [];
    for (const variant of variants) variantIds.push(await insertVariantWithStock(tx, productId, variant, now));
    return { productId, variantIds };
  });
}

export async function updateProduct(
  productId: string,
  input: ProductFieldsInput,
  database?: Client
): Promise<void> {
  const client = database ?? await getDatabaseClient();
  await transaction(client, async (tx) => {
    await requireWritableProduct(tx, productId);
    const values = productValues(input);
    const duplicateId = await findProductByKey(tx, values.key, productId);
    if (duplicateId) throw new DuplicateProductError(duplicateId);
    const result = await tx.execute({
      sql: `UPDATE productos SET
        titulo_canonico = ?, marca_original = ?, marca_normalizada = ?, nombre_modelo = ?,
        colorway_original = ?, colorway_normalizado = ?, referencia_original = ?,
        referencia_normalizada = ?, clave_normalizada = ?, tipo_producto = ?, actualizado_en_ms = ?
        WHERE id = ? AND estado <> 'ARCHIVADO'`,
      args: [
        values.title, values.brand, normalizeKey(values.brand), values.model,
        values.colorway, values.colorway ? normalizeKey(values.colorway) : null,
        values.reference, normalizeKey(values.reference), values.key, input.type, Date.now(), productId
      ]
    });
    if (result.rowsAffected !== 1) throw new InventoryNotFoundError('No encontramos el producto.');
  });
}

export async function updateVariant(
  variantId: string,
  input: Omit<VariantFieldsInput, 'quantity' | 'costCents' | 'location'>,
  database?: Client
): Promise<void> {
  const client = database ?? await getDatabaseClient();
  await transaction(client, async (tx) => {
    const current = await tx.execute({
      sql: `SELECT v.producto_id, p.estado AS producto_estado
            FROM variantes_producto v JOIN productos p ON p.id = v.producto_id
            WHERE v.id = ? AND v.archivado_en_ms IS NULL LIMIT 1`,
      args: [variantId]
    });
    if (!current.rows[0]) throw new InventoryNotFoundError('No encontramos la talla.');
    if (current.rows[0].producto_estado === 'ARCHIVADO') throw new InventoryError('El producto está dado de baja.', 'PRODUCTO_ARCHIVADO', 409);
    const parsedSize = parseSize(input.size);
    const signature = variantSignature(input.sizeSystem, parsedSize.label);
    await ensureVariantDoesNotExist(tx, String(current.rows[0].producto_id), signature, variantId);
    const activePrice = input.offerCents ?? input.pvpCents;
    const result = await tx.execute({
      sql: `UPDATE variantes_producto SET
        titulo_variante = ?, barcode_original = ?, barcode_normalizado = ?, talla_original = ?,
        sistema_talla = ?, valor_talla_milesimas = ?, etiqueta_talla = ?, longitud_pie_mm = ?,
        grupo_edad = ?, publico_genero = ?, firma_opciones_json = ?, precio_centimos = ?,
        precio_comparacion_centimos = ?, actualizado_en_ms = ?
        WHERE id = ? AND archivado_en_ms IS NULL`,
      args: [
        `${parsedSize.label} ${input.sizeSystem}`, input.barcode ?? null,
        input.barcode ? normalizeText(input.barcode) : null, normalizeText(input.size),
        input.sizeSystem, parsedSize.thousandths, parsedSize.label, parsedSize.footLengthMm,
        input.ageGroup, input.gender, signature, activePrice,
        input.offerCents === null || input.offerCents === undefined ? null : input.pvpCents,
        Date.now(), variantId
      ]
    });
    if (result.rowsAffected !== 1) throw new InventoryNotFoundError('No encontramos la talla.');
  });
}

function movementType(reason: StockReason, delta: number): string {
  if (reason === 'VENTA') return 'VENTA';
  if (reason === 'COMPRA') return 'COMPRA';
  if (reason === 'DEVOLUCION') return 'DEVOLUCION_ENTRADA';
  return delta > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA';
}

export async function adjustStock(
  variantId: string,
  input: { locationId: string; reason: StockReason; delta: number },
  database?: Client
): Promise<{ quantity: number }> {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new InventoryError('El cambio debe ser un número entero distinto de cero.', 'VALIDACION', 400);
  }
  if (input.reason === 'VENTA' && input.delta > 0) {
    throw new InventoryError('Una venta debe reducir el stock.', 'VALIDACION', 400);
  }
  if ((input.reason === 'COMPRA' || input.reason === 'DEVOLUCION') && input.delta < 0) {
    throw new InventoryError('Esta operación debe aumentar el stock.', 'VALIDACION', 400);
  }
  const client = database ?? await getDatabaseClient();
  return transaction(client, async (tx) => {
    const variant = await tx.execute({
      sql: `SELECT v.id, p.estado AS producto_estado
            FROM variantes_producto v JOIN productos p ON p.id = v.producto_id
            WHERE v.id = ? AND v.archivado_en_ms IS NULL LIMIT 1`,
      args: [variantId]
    });
    if (!variant.rows[0]) throw new InventoryNotFoundError('No encontramos la talla.');
    if (variant.rows[0].producto_estado === 'ARCHIVADO') throw new InventoryError('El producto está dado de baja.', 'PRODUCTO_ARCHIVADO', 409);
    const location = await tx.execute({
      sql: 'SELECT id FROM ubicaciones_inventario WHERE id = ? AND esta_activa = 1 LIMIT 1',
      args: [input.locationId]
    });
    if (!location.rows[0]) throw new InventoryError('La ubicación no es válida.', 'UBICACION_INVALIDA');
    const level = await tx.execute({
      sql: `SELECT cantidad, version FROM niveles_inventario
            WHERE variante_id = ? AND ubicacion_id = ? LIMIT 1`,
      args: [variantId, input.locationId]
    });
    const currentQuantity = Number(level.rows[0]?.cantidad ?? 0);
    const resultingQuantity = currentQuantity + input.delta;
    if (resultingQuantity < 0) throw new InventoryError('No hay stock suficiente para realizar este cambio.', 'STOCK_NEGATIVO', 409);
    const now = Date.now();
    await tx.execute({
      sql: `INSERT INTO movimientos_inventario (
        id, variante_id, ubicacion_id, tipo, delta, saldo_posterior,
        clave_idempotencia, origen, metadata_json, ocurrido_en_ms, creado_en_ms, creado_por
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?)`,
      args: [
        uuidV7(now), variantId, input.locationId, movementType(input.reason, input.delta),
        input.delta, resultingQuantity, `stock-manual:${uuidV7(now)}`,
        JSON.stringify({ motivo_ui: input.reason }), now, now, CREATED_BY
      ]
    });
    if (level.rows[0]) {
      const updated = await tx.execute({
        sql: `UPDATE niveles_inventario SET cantidad = ?, version = version + 1, actualizado_en_ms = ?
              WHERE variante_id = ? AND ubicacion_id = ? AND version = ?`,
        args: [resultingQuantity, now, variantId, input.locationId, Number(level.rows[0].version)]
      });
      if (updated.rowsAffected !== 1) throw new InventoryError('El stock cambió mientras guardabas. Vuelve a intentarlo.', 'CONFLICTO_STOCK', 409);
    } else {
      await tx.execute({
        sql: `INSERT INTO niveles_inventario
              (variante_id, ubicacion_id, cantidad, version, actualizado_en_ms)
              VALUES (?, ?, ?, 1, ?)`,
        args: [variantId, input.locationId, resultingQuantity, now]
      });
    }
    return { quantity: resultingQuantity };
  });
}

export async function archiveProduct(productId: string, force: boolean, database?: Client): Promise<void> {
  const client = database ?? await getDatabaseClient();
  await transaction(client, async (tx) => {
    const product = await tx.execute({ sql: 'SELECT estado FROM productos WHERE id = ? LIMIT 1', args: [productId] });
    if (!product.rows[0]) throw new InventoryNotFoundError('No encontramos el producto.');
    if (product.rows[0].estado === 'ARCHIVADO') return;
    const stock = await tx.execute({
      sql: `SELECT COALESCE(SUM(n.cantidad), 0) AS total
            FROM variantes_producto v LEFT JOIN niveles_inventario n ON n.variante_id = v.id
            WHERE v.producto_id = ? AND v.archivado_en_ms IS NULL`,
      args: [productId]
    });
    const units = Number(stock.rows[0]?.total ?? 0);
    if (units > 0 && !force) throw new ProductHasStockError(units);
    const now = Date.now();
    await tx.execute({
      sql: `UPDATE productos SET estado = 'ARCHIVADO', archivado_en_ms = ?, actualizado_en_ms = ? WHERE id = ?`,
      args: [now, now, productId]
    });
  });
}
