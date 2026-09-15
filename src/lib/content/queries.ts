import type { Client } from '@libsql/client';
import { getDatabaseClient } from '../db/index.ts';
import { getProductDetail } from '../inventory/queries.ts';
import type { ContentImageAsset, ContentImageResource, ContentReferenceRole, ProductContentLibrary, PublicationProduct, PublicationTexts } from './types.ts';

type QueryClient = Pick<Client, 'execute' | 'batch'>;

export const EMPTY_PUBLICATION_TEXTS: PublicationTexts = {
  tituloComercial: '',
  descripcionCompleta: '',
  caracteristicasTecnicas: '',
  historiaDatoCurioso: '',
  seoTitle: '',
  metaDescription: ''
};

function textValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function sizeEquivalences(value: unknown): Record<string, string> {
  const metadata = safeMetadata(value);
  const raw = metadata.equivalencias_talla;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).flatMap(([system, size]) => (
    typeof size === 'string' && size.trim() ? [[system.toUpperCase(), size.trim()]] : []
  )));
}

export async function getPublicationProduct(id: string, database?: QueryClient): Promise<PublicationProduct | null> {
  const client = database ?? await getDatabaseClient();
  const detail = await getProductDetail(id, client);
  if (!detail) return null;
  const [variantExtra, subtypeResult, equivalenceResult] = await client.batch([
    {
      sql: 'SELECT id, longitud_pie_mm FROM variantes_producto WHERE producto_id = ? AND archivado_en_ms IS NULL',
      args: [id]
    },
    {
      sql: `SELECT json_extract(metadata_json, '$.tipo_prenda') AS tipo_prenda
            FROM movimientos_inventario m
            JOIN variantes_producto v ON v.id = m.variante_id
            WHERE v.producto_id = ? AND json_extract(metadata_json, '$.tipo_prenda') IS NOT NULL
            ORDER BY m.ocurrido_en_ms DESC, m.creado_en_ms DESC LIMIT 1`,
      args: [id]
    },
    {
      sql: `SELECT v.id AS variante_id, m.metadata_json
            FROM variantes_producto v
            JOIN movimientos_inventario m ON m.variante_id = v.id
            WHERE v.producto_id = ? AND v.archivado_en_ms IS NULL
              AND json_type(m.metadata_json, '$.equivalencias_talla') = 'object'
            ORDER BY m.ocurrido_en_ms DESC, m.creado_en_ms DESC`,
      args: [id]
    }
  ], 'read');
  const footLengths = new Map(variantExtra.rows.map((row) => [String(row.id), row.longitud_pie_mm === null ? null : Number(row.longitud_pie_mm)]));
  const equivalences = new Map<string, Record<string, string>>();
  for (const row of equivalenceResult.rows) {
    const variantId = String(row.variante_id);
    if (!equivalences.has(variantId)) equivalences.set(variantId, sizeEquivalences(row.metadata_json));
  }
  return {
    ...detail,
    subtype: subtypeResult.rows[0]?.tipo_prenda ? String(subtypeResult.rows[0].tipo_prenda) : null,
    variants: detail.variants.map((variant) => ({
      ...variant,
      footLengthMm: footLengths.get(variant.id) ?? null,
      sizeEquivalences: equivalences.get(variant.id) ?? {}
    }))
  };
}

export async function getProductContent(productId: string, database?: QueryClient): Promise<ProductContentLibrary | null> {
  const client = database ?? await getDatabaseClient();
  const libraryResult = await client.execute({
    sql: `SELECT id, producto_id, locale, version, estado, titulo_plantilla,
                 descripcion_corta, descripcion_plantilla_html, caracteristicas_tecnicas,
                 historia_dato_curioso, seo_title, meta_description, generador,
                 version_generador, creado_en_ms, actualizado_en_ms
          FROM biblioteca_contenido
          WHERE producto_id = ? AND locale = 'es-ES'
            AND estado NOT IN ('RECHAZADO', 'REEMPLAZADO')
          ORDER BY version DESC LIMIT 1`,
    args: [productId]
  });
  const row = libraryResult.rows[0];
  if (!row) return null;
  const imageResult = await client.execute({
    sql: `SELECT id, uri_almacenamiento, mime_type, texto_alt, posicion, origen, ancho, alto,
                 estado, creado_en_ms, metadata_generacion_json
          FROM recursos_contenido
          WHERE biblioteca_contenido_id = ? AND tipo = 'IMAGEN'
            AND estado NOT IN ('ARCHIVADO', 'RECHAZADO') AND archivado_en_ms IS NULL
          ORDER BY posicion`,
    args: [String(row.id)]
  });
  const texts: PublicationTexts = {
    tituloComercial: textValue(row.titulo_plantilla),
    descripcionCompleta: textValue(row.descripcion_plantilla_html),
    caracteristicasTecnicas: textValue(row.caracteristicas_tecnicas),
    historiaDatoCurioso: textValue(row.historia_dato_curioso),
    seoTitle: textValue(row.seo_title),
    metaDescription: textValue(row.meta_description)
  };
  const assets: ContentImageAsset[] = imageResult.rows.map((image) => ({
    id: String(image.id),
    url: String(image.uri_almacenamiento),
    mimeType: String(image.mime_type),
    alt: image.texto_alt === null ? null : String(image.texto_alt),
    position: Number(image.posicion),
    origin: String(image.origen) as ContentImageAsset['origin'],
    state: String(image.estado),
    createdAtMs: Number(image.creado_en_ms),
    width: image.ancho === null ? null : Number(image.ancho),
    height: image.alto === null ? null : Number(image.alto),
    metadata: safeMetadata(image.metadata_generacion_json)
  }));
  const isReference = (asset: ContentImageAsset): boolean => (
    asset.metadata.role === 'REFERENCIA_LATERAL' || asset.metadata.role === 'REFERENCIA_TRASERA'
  );
  return {
    id: String(row.id),
    productId: String(row.producto_id),
    locale: String(row.locale),
    version: Number(row.version),
    state: String(row.estado),
    texts,
    hasTexts: Object.values(texts).some((value) => value.trim().length > 0),
    images: assets.filter((asset) => !isReference(asset)),
    references: assets.filter(isReference),
    generator: row.generador === null ? null : String(row.generador),
    generatorVersion: row.version_generador === null ? null : String(row.version_generador),
    createdAtMs: Number(row.creado_en_ms),
    updatedAtMs: Number(row.actualizado_en_ms)
  };
}

export async function getContentImageResource(resourceId: string, database?: QueryClient): Promise<ContentImageResource | null> {
  const client = database ?? await getDatabaseClient();
  const result = await client.execute({
    sql: `SELECT r.id, r.uri_almacenamiento, r.mime_type, r.metadata_generacion_json,
                 p.marca_original AS marca, p.nombre_modelo AS modelo,
                 p.referencia_original AS referencia
          FROM recursos_contenido r
          JOIN biblioteca_contenido b ON b.id = r.biblioteca_contenido_id
          JOIN productos p ON p.id = b.producto_id
          WHERE r.id = ? AND r.tipo = 'IMAGEN'
            AND r.estado NOT IN ('ARCHIVADO', 'RECHAZADO') AND r.archivado_en_ms IS NULL
          LIMIT 1`,
    args: [resourceId]
  });
  const row = result.rows[0];
  if (!row) return null;
  const metadata = safeMetadata(row.metadata_generacion_json);
  const role = metadata.role === 'REFERENCIA_LATERAL' || metadata.role === 'REFERENCIA_TRASERA'
    ? metadata.role as ContentReferenceRole
    : null;
  return {
    id: String(row.id),
    storageUri: String(row.uri_almacenamiento),
    mimeType: String(row.mime_type),
    brand: String(row.marca),
    model: String(row.modelo),
    reference: String(row.referencia),
    angle: typeof metadata.angle === 'string' ? metadata.angle : null,
    role
  };
}
