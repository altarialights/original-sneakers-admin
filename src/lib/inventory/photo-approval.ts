import type { Client, Transaction } from '@libsql/client';
import { z } from 'zod';
import { getDatabaseClient } from '../db/index.ts';
import { InventoryError } from './errors.ts';
import { uuidV7 } from './ids.ts';
import {
  barcodeToString,
  canonicalProductKey,
  inspectGtin,
  locationCode,
  normalizeGtin,
  normalizeKey,
  normalizeProductReference,
  normalizeText,
  parseSize,
  variantSignature
} from './normalization.ts';
import type { Gender, ProductType, SizeSystem } from './types.ts';

const requiredText = (label: string) => z.string().transform(normalizeText).pipe(z.string().min(1, `${label} es obligatorio.`));
const optionalText = z.union([z.string(), z.null(), z.undefined()]).transform((value) => normalizeText(value) || null);
const dateText = optionalText.refine((value) => {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'La fecha de compra no es válida.');

export const photoApprovalPayloadSchema = z.object({
  sessionId: z.uuid('La sesión de fotos no es válida.'),
  tipoProducto: z.enum(['CALZADO', 'ROPA']),
  producto: z.object({
    marca: requiredText('Marca'),
    modelo: requiredText('Modelo'),
    referencia: z.string().transform(normalizeProductReference).pipe(z.string().min(1, 'Referencia es obligatoria.')),
    colorway: optionalText,
    genero: z.enum(['UNISEX', 'HOMBRE', 'MUJER', 'NINO', 'NINA', 'DESCONOCIDO']),
    tipoPrenda: optionalText
  }),
  variante: z.object({
    talla: requiredText('Talla'),
    sistemaTalla: z.enum(['EU', 'US', 'UK', 'CM', 'ALFABETICO', 'EDAD', 'ALTURA', 'DESCONOCIDO']),
    gtin: z.union([z.string(), z.number(), z.null(), z.undefined()]),
    cantidad: z.coerce.number().int('Cantidad debe ser un número entero.').positive('Cantidad debe ser mayor que cero.'),
    equivalencias: z.record(z.string(), z.string()).default({}),
    longitudPieCm: z.union([z.coerce.number().positive(), z.null(), z.undefined()])
  }),
  compra: z.object({
    costeUnitarioCentimos: z.union([z.number().int().nonnegative(), z.null()]),
    proveedor: optionalText,
    fechaCompra: dateText
  })
}).superRefine((value, context) => {
  const originalGtin = barcodeToString(value.variante.gtin);
  const inspectedGtin = inspectGtin(originalGtin);
  if (originalGtin && (!inspectedGtin.canonical || inspectedGtin.checkDigitValid !== true)) {
    context.addIssue({ code: 'custom', path: ['variante', 'gtin'], message: 'El UPC / EAN / GTIN no es válido.' });
  }
  if (value.tipoProducto === 'ROPA' && value.variante.longitudPieCm != null) {
    context.addIssue({ code: 'custom', path: ['variante', 'longitudPieCm'], message: 'La longitud del pie no corresponde a ROPA.' });
  }
});

export interface PhotoApprovalInput {
  sessionId: string;
  tipoProducto: Extract<ProductType, 'CALZADO' | 'ROPA'>;
  producto: {
    marca: string;
    modelo: string;
    referencia: string;
    colorway: string | null;
    genero: Gender;
    tipoPrenda: string | null;
  };
  variante: {
    talla: string;
    sistemaTalla: SizeSystem;
    gtin: string | null;
    cantidad: number;
    equivalencias: Record<string, string>;
    longitudPieMm: number | null;
  };
  compra: {
    costeUnitarioCentimos: number | null;
    proveedor: string | null;
    fechaCompra: string | null;
  };
}

export function parsePhotoApprovalPayload(value: unknown): PhotoApprovalInput {
  const parsed = photoApprovalPayloadSchema.parse(value);
  const originalGtin = barcodeToString(parsed.variante.gtin);
  return {
    ...parsed,
    variante: {
      ...parsed.variante,
      gtin: originalGtin ? normalizeGtin(originalGtin) : null,
      longitudPieMm: parsed.tipoProducto === 'CALZADO' && parsed.variante.longitudPieCm != null
        ? Math.round(parsed.variante.longitudPieCm * 10)
        : null
    }
  };
}

export interface PhotoApprovalResult {
  productId: string;
  variantId: string;
  movementId: string;
  quantity: number;
  addedQuantity: number;
  productCreated: boolean;
  variantCreated: boolean;
  idempotent: boolean;
}

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

function purchaseTimestamp(date: string | null, fallback: number): number {
  return date ? new Date(`${date}T12:00:00Z`).getTime() : fallback;
}

export async function approvePhotoInventory(
  input: PhotoApprovalInput,
  database?: Client
): Promise<PhotoApprovalResult> {
  const client = database ?? await getDatabaseClient();
  const idempotencyKey = `alta-fotos:${input.sessionId}`;
  return transaction(client, async (tx) => {
    const previous = await tx.execute({
      sql: `SELECT m.id AS movimiento_id, m.saldo_posterior, m.delta, m.metadata_json,
                   v.id AS variante_id, p.id AS producto_id
            FROM movimientos_inventario m
            JOIN variantes_producto v ON v.id = m.variante_id
            JOIN productos p ON p.id = v.producto_id
            WHERE m.clave_idempotencia = ? LIMIT 1`,
      args: [idempotencyKey]
    });
    if (previous.rows[0]) {
      const metadata = JSON.parse(String(previous.rows[0].metadata_json ?? '{}')) as Record<string, unknown>;
      return {
        productId: String(previous.rows[0].producto_id),
        variantId: String(previous.rows[0].variante_id),
        movementId: String(previous.rows[0].movimiento_id),
        quantity: Number(previous.rows[0].saldo_posterior),
        addedQuantity: Number(previous.rows[0].delta),
        productCreated: metadata.producto_creado === true,
        variantCreated: metadata.variante_creada === true,
        idempotent: true
      };
    }

    const now = Date.now();
    const brand = normalizeText(input.producto.marca);
    const model = normalizeText(input.producto.modelo);
    const reference = normalizeProductReference(input.producto.referencia);
    const colorway = normalizeText(input.producto.colorway) || null;
    const productKey = canonicalProductKey({ brand, model, reference, colorway });
    const existingProduct = await tx.execute({
      sql: 'SELECT id, estado FROM productos WHERE clave_normalizada = ? LIMIT 1',
      args: [productKey]
    });
    let productId = existingProduct.rows[0]?.id ? String(existingProduct.rows[0].id) : '';
    const productCreated = !productId;
    if (existingProduct.rows[0]?.estado === 'ARCHIVADO') {
      throw new InventoryError('El producto existente está dado de baja.', 'PRODUCTO_ARCHIVADO', 409);
    }
    if (productCreated) {
      productId = uuidV7(now);
      const title = [brand, model, colorway].filter(Boolean).join(' - ');
      await tx.execute({
        sql: `INSERT INTO productos (
          id, titulo_canonico, marca_original, marca_normalizada, nombre_modelo,
          colorway_original, colorway_normalizado, referencia_original, referencia_normalizada,
          clave_normalizada, version_normalizacion, tipo_producto, estado, estado_revision,
          creado_en_ms, actualizado_en_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'ACTIVO', 'APROBADO', ?, ?)`,
        args: [
          productId, title, brand, normalizeKey(brand), model,
          colorway, colorway ? normalizeKey(colorway) : null, reference, normalizeKey(reference),
          productKey, input.tipoProducto, now, now
        ]
      });
    }

    const parsedSize = parseSize(input.variante.talla);
    const productVariants = await tx.execute({
      sql: `SELECT id, producto_id, estado, barcode_normalizado, sistema_talla, etiqueta_talla, firma_opciones_json
            FROM variantes_producto WHERE producto_id = ?`,
      args: [productId]
    });
    const primaryVariant = productVariants.rows.find((row) =>
      String(row.sistema_talla) === input.variante.sistemaTalla
      && parseSize(row.etiqueta_talla).label === parsedSize.label
    );
    const storedBarcodes = input.variante.gtin
      ? await tx.execute(`SELECT id, producto_id, estado, barcode_normalizado, sistema_talla, etiqueta_talla
                          FROM variantes_producto WHERE barcode_normalizado IS NOT NULL`)
      : null;
    const gtinOwner = storedBarcodes?.rows.find((row) => normalizeGtin(row.barcode_normalizado) === input.variante.gtin);
    const gtinOwnerMatchesPrimary = Boolean(gtinOwner
      && String(gtinOwner.producto_id) === productId
      && String(gtinOwner.sistema_talla) === input.variante.sistemaTalla
      && parseSize(gtinOwner.etiqueta_talla).label === parsedSize.label);
    if (gtinOwner && !gtinOwnerMatchesPrimary) {
      const ownerSize = `${String(gtinOwner.etiqueta_talla)} ${String(gtinOwner.sistema_talla)}`;
      throw new InventoryError(
        `El GTIN ya pertenece a otra variante incompatible (${ownerSize}).`,
        'GTIN_DUPLICADO',
        409
      );
    }
    const existingVariant = gtinOwnerMatchesPrimary ? gtinOwner : primaryVariant;
    let variantId = existingVariant?.id ? String(existingVariant.id) : '';
    const variantCreated = !variantId;
    if (existingVariant?.estado === 'ARCHIVADO') {
      throw new InventoryError('La variante existente está dada de baja.', 'VARIANTE_ARCHIVADA', 409);
    }
    const currentBarcode = existingVariant?.barcode_normalizado
      ? String(existingVariant.barcode_normalizado)
      : null;
    const currentGtin = currentBarcode ? normalizeGtin(currentBarcode) ?? currentBarcode : null;
    if (variantId && currentGtin && input.variante.gtin && currentGtin !== input.variante.gtin) {
      throw new InventoryError('El GTIN no coincide con la variante existente.', 'GTIN_CONFLICTO', 409);
    }
    if (variantCreated) {
      variantId = uuidV7(now);
      const ageGroup = input.producto.genero === 'NINO' || input.producto.genero === 'NINA' ? 'INFANTIL' : 'ADULTO';
      await tx.execute({
        sql: `INSERT INTO variantes_producto (
          id, producto_id, titulo_variante, barcode_original, barcode_normalizado,
          talla_original, sistema_talla, valor_talla_milesimas, etiqueta_talla, longitud_pie_mm,
          grupo_edad, publico_genero, firma_opciones_json, precio_centimos,
          precio_comparacion_centimos, moneda, estado, requiere_revision, creado_en_ms, actualizado_en_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 'EUR', 'ACTIVO', 0, ?, ?)`,
        args: [
          variantId, productId, `${parsedSize.label} ${input.variante.sistemaTalla}`,
          input.variante.gtin, input.variante.gtin, normalizeText(input.variante.talla),
          input.variante.sistemaTalla, parsedSize.thousandths, parsedSize.label,
          input.tipoProducto === 'CALZADO' ? input.variante.longitudPieMm : null,
          ageGroup, input.producto.genero, variantSignature(input.variante.sistemaTalla, parsedSize.label), now, now
        ]
      });
    } else if (!currentBarcode && input.variante.gtin) {
      await tx.execute({
        sql: 'UPDATE variantes_producto SET barcode_original = ?, barcode_normalizado = ?, actualizado_en_ms = ? WHERE id = ?',
        args: [input.variante.gtin, input.variante.gtin, now, variantId]
      });
    }

    const locationResult = await tx.execute({
      sql: 'SELECT id, nombre FROM ubicaciones_inventario WHERE codigo = ? AND esta_activa = 1 LIMIT 1',
      args: [locationCode('Tienda')]
    });
    if (!locationResult.rows[0]) throw new InventoryError('La ubicación Tienda no existe o no está activa.', 'UBICACION_INVALIDA');
    const locationId = String(locationResult.rows[0].id);
    const level = await tx.execute({
      sql: `SELECT cantidad, version FROM niveles_inventario
            WHERE variante_id = ? AND ubicacion_id = ? LIMIT 1`,
      args: [variantId, locationId]
    });
    const currentQuantity = Number(level.rows[0]?.cantidad ?? 0);
    const resultingQuantity = currentQuantity + input.variante.cantidad;
    const movementId = uuidV7(now);
    const metadata = JSON.stringify({
      metodo_alta: 'FOTOS',
      tipo_producto: input.tipoProducto,
      tipo_prenda: input.tipoProducto === 'ROPA' ? input.producto.tipoPrenda : null,
      fecha_compra: input.compra.fechaCompra,
      equivalencias_talla: input.variante.equivalencias,
      longitud_pie_mm: input.tipoProducto === 'CALZADO' ? input.variante.longitudPieMm : null,
      producto_creado: productCreated,
      variante_creada: variantCreated
    });
    await tx.execute({
      sql: `INSERT INTO movimientos_inventario (
        id, variante_id, ubicacion_id, tipo, delta, saldo_posterior, clave_idempotencia,
        origen, referencia_origen, coste_unitario_centimos, moneda_coste, proveedor_original,
        metadata_json, ocurrido_en_ms, creado_en_ms, creado_por
      ) VALUES (?, ?, ?, 'COMPRA', ?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?, ?, ?, 'original-sneakers-admin')`,
      args: [
        movementId, variantId, locationId, input.variante.cantidad, resultingQuantity,
        idempotencyKey, input.sessionId, input.compra.costeUnitarioCentimos,
        input.compra.costeUnitarioCentimos === null ? null : 'EUR', input.compra.proveedor,
        metadata, purchaseTimestamp(input.compra.fechaCompra, now), now
      ]
    });
    if (level.rows[0]) {
      const updated = await tx.execute({
        sql: `UPDATE niveles_inventario SET cantidad = ?, version = version + 1, actualizado_en_ms = ?
              WHERE variante_id = ? AND ubicacion_id = ? AND version = ?`,
        args: [resultingQuantity, now, variantId, locationId, Number(level.rows[0].version)]
      });
      if (updated.rowsAffected !== 1) {
        throw new InventoryError('El stock cambió mientras guardabas. Vuelve a intentarlo.', 'CONFLICTO_STOCK', 409);
      }
    } else {
      await tx.execute({
        sql: `INSERT INTO niveles_inventario
              (variante_id, ubicacion_id, cantidad, version, actualizado_en_ms)
              VALUES (?, ?, ?, 1, ?)`,
        args: [variantId, locationId, resultingQuantity, now]
      });
    }
    return {
      productId,
      variantId,
      movementId,
      quantity: resultingQuantity,
      addedQuantity: input.variante.cantidad,
      productCreated,
      variantCreated,
      idempotent: false
    };
  });
}
