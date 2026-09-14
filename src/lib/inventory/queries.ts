import type { Client } from '@libsql/client';
import { getDatabaseClient } from '../db/index.ts';
import { normalizeText } from './normalization.ts';
import type {
  InventoryFilterOptions,
  InventoryListFilters,
  InventoryProductDetail,
  InventoryProductListItem,
  InventoryStats,
  ProductState,
  ProductType,
  SizeSystem
} from './types.ts';

type QueryClient = Pick<Client, 'execute' | 'batch'>;

const PRODUCT_STATE_LABELS: Record<ProductState, string> = {
  BORRADOR: 'Borrador',
  ACTIVO: 'Activo',
  ARCHIVADO: 'De baja'
};

function likeValue(value: string): string {
  return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

export async function listProducts(
  filters: InventoryListFilters = {},
  database?: QueryClient
): Promise<InventoryProductListItem[]> {
  const client = database ?? await getDatabaseClient();
  const clauses: string[] = [];
  const args: Array<string | number> = [];
  const search = normalizeText(filters.search).toLowerCase();
  if (search) {
    const pattern = likeValue(search);
    clauses.push(`(
      lower(coalesce(p.marca_original, '')) LIKE ? ESCAPE '\\'
      OR lower(coalesce(p.nombre_modelo, '')) LIKE ? ESCAPE '\\'
      OR lower(coalesce(p.referencia_original, '')) LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM variantes_producto sv
        WHERE sv.producto_id = p.id AND sv.archivado_en_ms IS NULL
          AND (lower(coalesce(sv.barcode_original, '')) LIKE ? ESCAPE '\\'
               OR lower(coalesce(sv.etiqueta_talla, '')) LIKE ? ESCAPE '\\')
      )
    )`);
    args.push(pattern, pattern, pattern, pattern, pattern);
  }
  if (filters.brand) {
    clauses.push('p.marca_normalizada = ?');
    args.push(filters.brand);
  }
  if (filters.state) {
    clauses.push('p.estado = ?');
    args.push(filters.state);
  }
  if (filters.type) {
    clauses.push('p.tipo_producto = ?');
    args.push(filters.type);
  }
  if (filters.size) {
    clauses.push(`EXISTS (
      SELECT 1 FROM variantes_producto sv
      WHERE sv.producto_id = p.id AND sv.archivado_en_ms IS NULL AND sv.etiqueta_talla = ?
    )`);
    args.push(filters.size);
  }
  if (filters.stock === 'con') {
    clauses.push(`COALESCE((
      SELECT SUM(sn.cantidad) FROM variantes_producto sv
      LEFT JOIN niveles_inventario sn ON sn.variante_id = sv.id
      WHERE sv.producto_id = p.id AND sv.archivado_en_ms IS NULL
    ), 0) > 0`);
  } else if (filters.stock === 'sin') {
    clauses.push(`COALESCE((
      SELECT SUM(sn.cantidad) FROM variantes_producto sv
      LEFT JOIN niveles_inventario sn ON sn.variante_id = sv.id
      WHERE sv.producto_id = p.id AND sv.archivado_en_ms IS NULL
    ), 0) = 0`);
  }

  const result = await client.execute({
    sql: `SELECT
      p.id, p.titulo_canonico, p.marca_original, p.nombre_modelo,
      p.referencia_original, p.colorway_original, p.tipo_producto, p.estado,
      v.id AS variante_id, v.etiqueta_talla, v.sistema_talla,
      v.precio_centimos, v.precio_comparacion_centimos,
      COALESCE(SUM(n.cantidad), 0) AS cantidad_variante,
      (SELECT sn.ubicacion_id FROM niveles_inventario sn WHERE sn.variante_id = v.id ORDER BY sn.cantidad DESC LIMIT 1) AS ubicacion_principal_id,
      (
        SELECT r.uri_almacenamiento
        FROM biblioteca_contenido b
        JOIN recursos_contenido r ON r.biblioteca_contenido_id = b.id
        WHERE b.producto_id = p.id AND r.tipo = 'IMAGEN'
          AND r.estado NOT IN ('ARCHIVADO', 'RECHAZADO')
        ORDER BY CASE r.estado WHEN 'APROBADO' THEN 0 ELSE 1 END, r.posicion
        LIMIT 1
      ) AS imagen_url
    FROM productos p
    JOIN variantes_producto v ON v.producto_id = p.id AND v.archivado_en_ms IS NULL
    LEFT JOIN niveles_inventario n ON n.variante_id = v.id
    ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
    GROUP BY p.id, v.id
    ORDER BY lower(p.marca_original), lower(p.nombre_modelo), lower(p.referencia_original), v.valor_talla_milesimas, v.etiqueta_talla`,
    args
  });

  const products = new Map<string, InventoryProductListItem>();
  for (const row of result.rows) {
    const id = String(row.id);
    let product = products.get(id);
    const state = String(row.estado) as ProductState;
    const quantity = Number(row.cantidad_variante ?? 0);
    const pvp = Number(row.precio_comparacion_centimos ?? row.precio_centimos ?? 0);
    if (!product) {
      product = {
        id,
        name: String(row.titulo_canonico),
        brand: String(row.marca_original ?? ''),
        model: String(row.nombre_modelo ?? ''),
        reference: String(row.referencia_original ?? ''),
        colorway: row.colorway_original === null ? null : String(row.colorway_original),
        type: String(row.tipo_producto ?? 'OTRO') as ProductType,
        state,
        stateLabel: PRODUCT_STATE_LABELS[state],
        sizes: [],
        stock: 0,
        priceCents: pvp,
        imageUrl: row.imagen_url === null ? null : String(row.imagen_url),
        shopifyStatus: 'No conectado',
        variants: []
      };
      products.set(id, product);
    }
    const size = String(row.etiqueta_talla ?? row.variante_id);
    product.sizes.push(size);
    product.stock += quantity;
    product.priceCents = Math.min(product.priceCents, pvp);
    product.variants.push({
      id: String(row.variante_id),
      size,
      sizeSystem: String(row.sistema_talla ?? 'DESCONOCIDO') as SizeSystem,
      quantity,
      locationId: row.ubicacion_principal_id === null ? null : String(row.ubicacion_principal_id)
    });
  }
  return [...products.values()];
}

export async function getInventoryStats(database?: QueryClient): Promise<InventoryStats> {
  const client = database ?? await getDatabaseClient();
  const result = await client.execute(`
    SELECT
      COUNT(*) AS productos_activos,
      COALESCE(SUM(stock_total), 0) AS unidades_disponibles,
      COALESCE(SUM(CASE WHEN stock_total = 0 THEN 1 ELSE 0 END), 0) AS productos_sin_stock
    FROM (
      SELECT p.id, COALESCE(SUM(n.cantidad), 0) AS stock_total
      FROM productos p
      LEFT JOIN variantes_producto v ON v.producto_id = p.id AND v.archivado_en_ms IS NULL
      LEFT JOIN niveles_inventario n ON n.variante_id = v.id
      WHERE p.estado <> 'ARCHIVADO' AND p.archivado_en_ms IS NULL
      GROUP BY p.id
    ) resumen
  `);
  return {
    activeProducts: Number(result.rows[0]?.productos_activos ?? 0),
    availableUnits: Number(result.rows[0]?.unidades_disponibles ?? 0),
    outOfStockProducts: Number(result.rows[0]?.productos_sin_stock ?? 0)
  };
}

export async function getFilterOptions(database?: QueryClient): Promise<InventoryFilterOptions> {
  const client = database ?? await getDatabaseClient();
  const [brands, sizes] = await client.batch([
    `SELECT DISTINCT marca_normalizada, marca_original FROM productos
     WHERE archivado_en_ms IS NULL ORDER BY lower(marca_original)`,
    `SELECT DISTINCT etiqueta_talla, valor_talla_milesimas FROM variantes_producto
     WHERE archivado_en_ms IS NULL ORDER BY valor_talla_milesimas, etiqueta_talla`
  ], 'read');
  return {
    brands: brands.rows.map((row) => `${String(row.marca_normalizada)}\t${String(row.marca_original)}`),
    sizes: sizes.rows.map((row) => String(row.etiqueta_talla))
  };
}

export async function getProductDetail(id: string, database?: QueryClient): Promise<InventoryProductDetail | null> {
  const client = database ?? await getDatabaseClient();
  const [productResult, imageResult, variantResult] = await client.batch([
    { sql: `SELECT id, titulo_canonico, marca_original, nombre_modelo, referencia_original,
                   colorway_original, tipo_producto, estado
            FROM productos WHERE id = ? LIMIT 1`, args: [id] },
    { sql: `SELECT r.uri_almacenamiento
            FROM biblioteca_contenido b
            JOIN recursos_contenido r ON r.biblioteca_contenido_id = b.id
            WHERE b.producto_id = ? AND r.tipo = 'IMAGEN'
              AND r.estado NOT IN ('ARCHIVADO', 'RECHAZADO')
            ORDER BY CASE r.estado WHEN 'APROBADO' THEN 0 ELSE 1 END, r.posicion`, args: [id] },
    { sql: `SELECT
              v.id, v.talla_original, v.etiqueta_talla, v.sistema_talla,
              v.barcode_original, v.precio_centimos, v.precio_comparacion_centimos,
              v.grupo_edad, v.publico_genero, v.estado,
              u.id AS ubicacion_id, u.nombre AS ubicacion_nombre, COALESCE(n.cantidad, 0) AS cantidad,
              (SELECT mi.coste_unitario_centimos
               FROM movimientos_inventario mi
               WHERE mi.variante_id = v.id AND mi.coste_unitario_centimos IS NOT NULL
               ORDER BY mi.ocurrido_en_ms DESC, mi.creado_en_ms DESC LIMIT 1) AS coste_centimos
            FROM variantes_producto v
            LEFT JOIN niveles_inventario n ON n.variante_id = v.id
            LEFT JOIN ubicaciones_inventario u ON u.id = n.ubicacion_id
            WHERE v.producto_id = ? AND v.archivado_en_ms IS NULL
            ORDER BY v.valor_talla_milesimas, v.etiqueta_talla, u.nombre`, args: [id] }
  ], 'read');
  const productRow = productResult.rows[0];
  if (!productRow) return null;

  const variants = new Map<string, InventoryProductDetail['variants'][number]>();
  for (const row of variantResult.rows) {
    const variantId = String(row.id);
    let variant = variants.get(variantId);
    if (!variant) {
      variant = {
        id: variantId,
        originalSize: String(row.talla_original ?? ''),
        size: String(row.etiqueta_talla ?? ''),
        sizeSystem: String(row.sistema_talla ?? 'DESCONOCIDO') as SizeSystem,
        barcode: row.barcode_original === null ? null : String(row.barcode_original),
        priceCents: Number(row.precio_centimos),
        compareAtPriceCents: row.precio_comparacion_centimos === null ? null : Number(row.precio_comparacion_centimos),
        costCents: row.coste_centimos === null ? null : Number(row.coste_centimos),
        quantity: 0,
        locations: [],
        gender: String(row.publico_genero ?? 'DESCONOCIDO') as InventoryProductDetail['variants'][number]['gender'],
        ageGroup: String(row.grupo_edad ?? 'DESCONOCIDO') as InventoryProductDetail['variants'][number]['ageGroup'],
        state: String(row.estado) as ProductState
      };
      variants.set(variantId, variant);
    }
    if (row.ubicacion_id !== null) {
      const quantity = Number(row.cantidad ?? 0);
      variant.quantity += quantity;
      variant.locations.push({ id: String(row.ubicacion_id), name: String(row.ubicacion_nombre), quantity });
    }
  }
  const state = String(productRow.estado) as ProductState;
  const variantList = [...variants.values()];
  return {
    id: String(productRow.id),
    name: String(productRow.titulo_canonico),
    brand: String(productRow.marca_original ?? ''),
    model: String(productRow.nombre_modelo ?? ''),
    reference: String(productRow.referencia_original ?? ''),
    colorway: productRow.colorway_original === null ? null : String(productRow.colorway_original),
    type: String(productRow.tipo_producto ?? 'OTRO') as ProductType,
    state,
    stateLabel: PRODUCT_STATE_LABELS[state],
    stock: variantList.reduce((sum, variant) => sum + variant.quantity, 0),
    images: imageResult.rows.map((row) => String(row.uri_almacenamiento)),
    variants: variantList
  };
}

export function formatMoney(cents: number | null): string {
  if (cents === null) return 'No disponible';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}
