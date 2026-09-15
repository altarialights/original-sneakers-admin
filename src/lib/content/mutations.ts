import type { Client, Transaction } from '@libsql/client';
import { getDatabaseClient } from '../db/index.ts';
import { uuidV7 } from '../inventory/ids.ts';
import { ContentError } from './errors.ts';
import { PUBLICATION_TEXT_FIELDS, type ContentReferenceRole, type ImageGenerationRequest, type PublicationTexts, type StoredContentReference, type StoredGeneratedImage } from './types.ts';

type WriteClient = Pick<Client, 'execute'>;

const TEXT_COLUMNS: Record<keyof PublicationTexts, string> = {
  tituloComercial: 'titulo_plantilla',
  descripcionCompleta: 'descripcion_plantilla_html',
  caracteristicasTecnicas: 'caracteristicas_tecnicas',
  historiaDatoCurioso: 'historia_dato_curioso',
  seoTitle: 'seo_title',
  metaDescription: 'meta_description'
};

async function withTransaction<T>(client: Client, callback: (tx: Transaction) => Promise<T>): Promise<T> {
  const tx = await client.transaction('write');
  try {
    const result = await callback(tx);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}

async function assertProductExists(productId: string, client: WriteClient): Promise<void> {
  const result = await client.execute({ sql: 'SELECT 1 FROM productos WHERE id = ? LIMIT 1', args: [productId] });
  if (result.rows.length === 0) throw new ContentError('El producto no existe.', 'PRODUCTO_NO_ENCONTRADO', 404);
}

async function createLibraryVersion(productId: string, client: WriteClient, now: number): Promise<string> {
  const previous = await client.execute({
    sql: `SELECT *, COALESCE((SELECT MAX(version) FROM biblioteca_contenido WHERE producto_id = ? AND locale = 'es-ES'), 0) AS ultima_version
          FROM biblioteca_contenido
          WHERE producto_id = ? AND locale = 'es-ES'
          ORDER BY version DESC LIMIT 1`,
    args: [productId, productId]
  });
  const row = previous.rows[0];
  const id = uuidV7(now);
  const version = Number(row?.ultima_version ?? 0) + 1;
  await client.execute({
    sql: `INSERT INTO biblioteca_contenido (
            id, producto_id, locale, version, estado, titulo_plantilla,
            descripcion_corta, descripcion_plantilla_html, caracteristicas_tecnicas,
            historia_dato_curioso, seo_title, meta_description, generador,
            version_generador, hash_prompt, huella_origen, creado_en_ms, actualizado_en_ms
          ) VALUES (?, ?, 'es-ES', ?, 'BORRADOR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, productId, version,
      row?.titulo_plantilla ?? null, row?.descripcion_corta ?? null,
      row?.descripcion_plantilla_html ?? null, row?.caracteristicas_tecnicas ?? null,
      row?.historia_dato_curioso ?? null, row?.seo_title ?? null,
      row?.meta_description ?? null, row?.generador ?? null,
      row?.version_generador ?? null, row?.hash_prompt ?? null,
      row?.huella_origen ?? null, now, now
    ]
  });
  if (row?.id) {
    const resources = await client.execute({
      sql: `SELECT tipo, origen, uri_almacenamiento, uri_origen, mime_type, hash_contenido,
                   ancho, alto, duracion_ms, texto_alt, posicion, proveedor,
                   id_recurso_proveedor, metadata_generacion_json, estado, creado_en_ms,
                   aprobado_en_ms
            FROM recursos_contenido
            WHERE biblioteca_contenido_id = ? AND estado NOT IN ('ARCHIVADO', 'RECHAZADO')
              AND archivado_en_ms IS NULL ORDER BY posicion`,
      args: [String(row.id)]
    });
    for (const resource of resources.rows) {
      await client.execute({
        sql: `INSERT INTO recursos_contenido (
                id, biblioteca_contenido_id, tipo, origen, uri_almacenamiento, uri_origen,
                mime_type, hash_contenido, ancho, alto, duracion_ms, texto_alt, posicion,
                proveedor, id_recurso_proveedor, metadata_generacion_json, estado,
                creado_en_ms, aprobado_en_ms
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          uuidV7(now), id, resource.tipo, resource.origen, resource.uri_almacenamiento,
          resource.uri_origen, resource.mime_type, resource.hash_contenido, resource.ancho,
          resource.alto, resource.duracion_ms, resource.texto_alt, resource.posicion,
          resource.proveedor, resource.id_recurso_proveedor, resource.metadata_generacion_json,
          resource.estado === 'APROBADO' ? 'BORRADOR' : resource.estado,
          resource.creado_en_ms, null
        ]
      });
    }
  }
  return id;
}

export async function ensureEditableContentLibrary(productId: string, client: WriteClient): Promise<string> {
  await assertProductExists(productId, client);
  const current = await client.execute({
    sql: `SELECT id, estado FROM biblioteca_contenido
          WHERE producto_id = ? AND locale = 'es-ES'
            AND estado NOT IN ('RECHAZADO', 'REEMPLAZADO')
          ORDER BY version DESC LIMIT 1`,
    args: [productId]
  });
  if (current.rows[0] && current.rows[0].estado !== 'APROBADO') return String(current.rows[0].id);
  return createLibraryVersion(productId, client, Date.now());
}

export async function savePublicationTexts(
  productId: string,
  texts: Partial<PublicationTexts>,
  metadata: { model?: string; promptHash?: string; generated?: boolean } = {},
  database?: Client
): Promise<string> {
  const entries = PUBLICATION_TEXT_FIELDS
    .filter((field) => texts[field] !== undefined)
    .map((field) => [TEXT_COLUMNS[field], texts[field]!] as const);
  if (entries.length === 0) throw new ContentError('No hay cambios de texto para guardar.', 'SIN_CAMBIOS');
  const client = database ?? await getDatabaseClient();
  const libraryId = await withTransaction(client, async (tx) => {
    const libraryId = await ensureEditableContentLibrary(productId, tx);
    const now = Date.now();
    const assignments = entries.map(([column]) => `${column} = ?`);
    assignments.push('actualizado_en_ms = ?', "estado = ?");
    if (metadata.model) assignments.push('generador = ?', "version_generador = '1'");
    if (metadata.promptHash) assignments.push('hash_prompt = ?');
    const args: Array<string | number> = entries.map(([, value]) => value);
    args.push(now, metadata.generated ? 'GENERADO' : 'BORRADOR');
    if (metadata.model) args.push(metadata.model);
    if (metadata.promptHash) args.push(metadata.promptHash);
    args.push(libraryId);
    await tx.execute({ sql: `UPDATE biblioteca_contenido SET ${assignments.join(', ')} WHERE id = ?`, args });
    return libraryId;
  });
  return libraryId;
}

export async function saveGeneratedImageRecord(
  productId: string,
  image: StoredGeneratedImage,
  request: ImageGenerationRequest,
  replaceExisting: boolean,
  database?: Client
): Promise<string> {
  const client = database ?? await getDatabaseClient();
  const startedAt = performance.now();
  console.info(`[content-images] resource:insert:start angle=${image.angle} mode=${replaceExisting ? 'REPLACE' : 'APPEND'}`);
  const libraryId = await withTransaction(client, async (tx) => {
    const libraryId = await ensureEditableContentLibrary(productId, tx);
    const now = Date.now();
    if (replaceExisting) {
      await tx.execute({
        sql: `UPDATE recursos_contenido SET estado = 'ARCHIVADO', archivado_en_ms = ?
              WHERE biblioteca_contenido_id = ? AND tipo = 'IMAGEN'
                AND origen = 'GENERADO_IA'
                AND estado NOT IN ('ARCHIVADO', 'RECHAZADO') AND archivado_en_ms IS NULL`,
        args: [now, libraryId]
      });
    }
    const maxPositionResult = await tx.execute({
      sql: 'SELECT COALESCE(MAX(posicion), -1) AS max_position FROM recursos_contenido WHERE biblioteca_contenido_id = ?',
      args: [libraryId]
    });
    const position = Number(maxPositionResult.rows[0]?.max_position ?? -1) + 1;
    const metadata = JSON.stringify({
      angle: image.angle,
      quality: image.quality,
      model: image.model,
      promptHash: image.promptHash,
      blobPathname: image.pathname,
      blobUrl: image.url,
      contentHash: image.hash,
      generatedAt: new Date(now).toISOString(),
      durationMs: image.durationMs,
      request: { quantity: request.quantity, angles: request.angles, mode: request.mode }
    });
    await tx.execute({
      sql: `INSERT INTO recursos_contenido (
              id, biblioteca_contenido_id, tipo, origen, uri_almacenamiento, mime_type,
              hash_contenido, ancho, alto, duracion_ms, texto_alt, posicion, proveedor,
              id_recurso_proveedor, metadata_generacion_json, estado, creado_en_ms
            ) VALUES (?, ?, 'IMAGEN', 'GENERADO_IA', ?, ?, ?, 1024, 1024, ?, ?, ?, 'OPENAI', ?, ?, 'REQUIERE_REVISION', ?)`,
      args: [
        uuidV7(now + position), libraryId, image.url, image.mimeType, image.hash,
        image.durationMs, `Vista ${image.angle.replaceAll('-', ' ')} de producto`, position,
        image.providerId, metadata, now
      ]
    });
    await tx.execute({
      sql: `UPDATE biblioteca_contenido
            SET estado = 'GENERADO', actualizado_en_ms = ?
            WHERE id = ?`,
      args: [now, libraryId]
    });
    return libraryId;
  });
  console.info(`[content-images] resource:insert:completed angle=${image.angle} durationMs=${Math.round(performance.now() - startedAt)}`);
  return libraryId;
}

export async function saveContentReferenceRecord(
  productId: string,
  reference: StoredContentReference,
  database?: Client
): Promise<{ libraryId: string; replacedUris: string[] }> {
  const client = database ?? await getDatabaseClient();
  return withTransaction(client, async (tx) => {
    const libraryId = await ensureEditableContentLibrary(productId, tx);
    const previous = await tx.execute({
      sql: `SELECT uri_almacenamiento FROM recursos_contenido
            WHERE biblioteca_contenido_id = ? AND tipo = 'IMAGEN' AND origen = 'ORIGINAL'
              AND json_extract(metadata_generacion_json, '$.role') = ?
              AND estado NOT IN ('ARCHIVADO', 'RECHAZADO') AND archivado_en_ms IS NULL`,
      args: [libraryId, reference.role]
    });
    const now = Date.now();
    await tx.execute({
      sql: `UPDATE recursos_contenido SET estado = 'ARCHIVADO', archivado_en_ms = ?
            WHERE biblioteca_contenido_id = ? AND tipo = 'IMAGEN' AND origen = 'ORIGINAL'
              AND json_extract(metadata_generacion_json, '$.role') = ?
              AND estado NOT IN ('ARCHIVADO', 'RECHAZADO') AND archivado_en_ms IS NULL`,
      args: [now, libraryId, reference.role]
    });
    const positionResult = await tx.execute({
      sql: 'SELECT COALESCE(MAX(posicion), -1) AS max_position FROM recursos_contenido WHERE biblioteca_contenido_id = ?',
      args: [libraryId]
    });
    const position = Number(positionResult.rows[0]?.max_position ?? -1) + 1;
    const label = reference.role === 'REFERENCIA_LATERAL' ? 'lateral' : 'trasera';
    await tx.execute({
      sql: `INSERT INTO recursos_contenido (
              id, biblioteca_contenido_id, tipo, origen, uri_almacenamiento, mime_type,
              hash_contenido, texto_alt, posicion, metadata_generacion_json, estado, creado_en_ms
            ) VALUES (?, ?, 'IMAGEN', 'ORIGINAL', ?, ?, ?, ?, ?, ?, 'BORRADOR', ?)`,
      args: [
        uuidV7(now + position), libraryId, reference.url, reference.mimeType, reference.hash,
        `Referencia ${label} real del producto`, position,
        JSON.stringify({
          role: reference.role,
          blobPathname: reference.pathname,
          contentHash: reference.hash,
          originalName: reference.originalName,
          uploadedAt: new Date(now).toISOString()
        }),
        now
      ]
    });
    await tx.execute({
      sql: `UPDATE biblioteca_contenido SET actualizado_en_ms = ?, estado = 'BORRADOR' WHERE id = ?`,
      args: [now, libraryId]
    });
    return { libraryId, replacedUris: previous.rows.map((row) => String(row.uri_almacenamiento)) };
  });
}

export async function archiveContentReferenceRecord(
  productId: string,
  role: ContentReferenceRole,
  database?: Client
): Promise<string[]> {
  const client = database ?? await getDatabaseClient();
  return withTransaction(client, async (tx) => {
    const libraryId = await ensureEditableContentLibrary(productId, tx);
    const result = await tx.execute({
      sql: `SELECT uri_almacenamiento FROM recursos_contenido
            WHERE biblioteca_contenido_id = ? AND tipo = 'IMAGEN' AND origen = 'ORIGINAL'
              AND json_extract(metadata_generacion_json, '$.role') = ?
              AND estado NOT IN ('ARCHIVADO', 'RECHAZADO') AND archivado_en_ms IS NULL`,
      args: [libraryId, role]
    });
    const now = Date.now();
    await tx.execute({
      sql: `UPDATE recursos_contenido SET estado = 'ARCHIVADO', archivado_en_ms = ?
            WHERE biblioteca_contenido_id = ? AND tipo = 'IMAGEN' AND origen = 'ORIGINAL'
              AND json_extract(metadata_generacion_json, '$.role') = ?
              AND estado NOT IN ('ARCHIVADO', 'RECHAZADO') AND archivado_en_ms IS NULL`,
      args: [now, libraryId, role]
    });
    await tx.execute({ sql: 'UPDATE biblioteca_contenido SET actualizado_en_ms = ? WHERE id = ?', args: [now, libraryId] });
    return result.rows.map((row) => String(row.uri_almacenamiento));
  });
}
