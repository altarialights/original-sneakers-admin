import type { Client } from '@libsql/client';
import { getDatabaseClient } from '../db/index.ts';
import { canonicalProductKey, normalizeGtin, parseSize } from '../inventory/normalization.ts';
import type { NormalizedProductDetection } from './schemas.ts';

type ReadonlyQueryClient = Pick<Client, 'execute'>;

export interface DuplicateCheck {
  checked: boolean;
  productExists: boolean;
  productId: string | null;
  variantExists: boolean;
  variantId: string | null;
  variantSize?: string | null;
  variantSizeSystem?: string | null;
  currentStock?: number | null;
  resultingStock?: number | null;
  conflict?: string | null;
}

export async function checkDetectionDuplicates(
  detection: NormalizedProductDetection,
  database?: ReadonlyQueryClient
): Promise<DuplicateCheck> {
  const { marca, modelo, referencia, colorway } = detection.producto;
  if (!marca || !modelo || !referencia) {
    return { checked: true, productExists: false, productId: null, variantExists: false, variantId: null };
  }
  const client = database ?? await getDatabaseClient();
  const key = canonicalProductKey({ brand: marca, model: modelo, reference: referencia, colorway });
  const product = await client.execute({
    sql: `SELECT id FROM productos
          WHERE clave_normalizada = ? AND archivado_en_ms IS NULL
          LIMIT 1`,
    args: [key]
  });
  const productId = product.rows[0]?.id ? String(product.rows[0].id) : null;
  if (!productId || !detection.variante.tallaNormalizada || !detection.variante.sistemaTalla) {
    return {
      checked: true,
      productExists: Boolean(productId),
      productId,
      variantExists: false,
      variantId: null
    };
  }
  const variants = await client.execute({
    sql: `SELECT v.id, v.producto_id, v.etiqueta_talla, v.sistema_talla, v.barcode_normalizado,
                 COALESCE(SUM(n.cantidad), 0) AS stock
          FROM variantes_producto v
          LEFT JOIN niveles_inventario n ON n.variante_id = v.id
          WHERE v.archivado_en_ms IS NULL
          GROUP BY v.id`,
    args: []
  });
  const requestedGtin = detection.variante.gtinNormalizado;
  const gtinOwner = requestedGtin
    ? variants.rows.find((row) => normalizeGtin(row.barcode_normalizado) === requestedGtin)
    : undefined;
  const samePrimary = (row: typeof variants.rows[number]) =>
    String(row.producto_id) === productId
    && String(row.sistema_talla) === detection.variante.sistemaTalla
    && parseSize(row.etiqueta_talla).label === parseSize(detection.variante.tallaNormalizada).label;
  const primaryVariant = variants.rows.find((row) => samePrimary(row));
  const compatibleOwner = gtinOwner && samePrimary(gtinOwner) ? gtinOwner : undefined;
  const selectedVariant = compatibleOwner ?? primaryVariant;
  const variantId = selectedVariant?.id ? String(selectedVariant.id) : null;
  const primaryGtin = primaryVariant?.barcode_normalizado ? normalizeGtin(primaryVariant.barcode_normalizado) : null;
  const conflict = gtinOwner && !compatibleOwner
    ? `El GTIN pertenece a ${String(gtinOwner.etiqueta_talla)} ${String(gtinOwner.sistema_talla)}, incompatible con ${detection.variante.tallaNormalizada} ${detection.variante.sistemaTalla}.`
    : requestedGtin && primaryGtin && requestedGtin !== primaryGtin
      ? `La variante ${detection.variante.tallaNormalizada} ${detection.variante.sistemaTalla} ya existe con otro GTIN.`
      : null;
  const currentStock = selectedVariant ? Number(selectedVariant.stock ?? 0) : null;
  return {
    checked: true,
    productExists: true,
    productId,
    variantExists: Boolean(variantId),
    variantId,
    variantSize: selectedVariant ? String(selectedVariant.etiqueta_talla) : null,
    variantSizeSystem: selectedVariant ? String(selectedVariant.sistema_talla) : null,
    currentStock,
    resultingStock: currentStock === null ? null : currentStock + detection.variante.cantidad,
    conflict
  };
}
