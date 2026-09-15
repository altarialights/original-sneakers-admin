import { createHash } from 'node:crypto';
import type { Client } from '@libsql/client';
import { getDatabaseClient } from '../db/index.ts';
import { normalizeKey, normalizeProductReference } from '../inventory/normalization.ts';
import type { DuplicateCheck } from './duplicates.ts';
import type { ContentStatus, NormalizedProductDetection } from './schemas.ts';
import { generationReferenceImageKinds } from './config.ts';

type ReadonlyQueryClient = Pick<Client, 'execute'>;

export type VisualContentIdentity =
  | { kind: 'PRODUCT_ID'; value: string }
  | { kind: 'FINGERPRINT'; value: string };

export function visualContentFingerprint(input: {
  marca: unknown;
  referencia: unknown;
  colorway: unknown;
}): string {
  const canonical = JSON.stringify([
    normalizeKey(input.marca),
    normalizeKey(normalizeProductReference(input.referencia)),
    normalizeKey(input.colorway)
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function resolveVisualContentIdentity(
  detection: NormalizedProductDetection,
  duplicates: DuplicateCheck
): VisualContentIdentity {
  if (duplicates.productId) return { kind: 'PRODUCT_ID', value: duplicates.productId };
  return {
    kind: 'FINGERPRINT',
    value: visualContentFingerprint({
      marca: detection.producto.marca,
      referencia: detection.producto.referencia,
      colorway: detection.producto.colorway
    })
  };
}

export function emptyContentStatus(checked = true): ContentStatus {
  return {
    checked,
    hasGenerationReferences: false,
    hasGeneratedImages: false,
    generatedImageCount: 0
  };
}

export async function checkExistingContent(
  detection: NormalizedProductDetection,
  duplicates: DuplicateCheck,
  database?: ReadonlyQueryClient
): Promise<ContentStatus> {
  const identity = resolveVisualContentIdentity(detection, duplicates);
  const client = database ?? await getDatabaseClient();
  const identityPredicate = identity.kind === 'PRODUCT_ID'
    ? 'b.producto_id = ?'
    : 'b.huella_origen = ?';
  const referenceKinds = generationReferenceImageKinds(detection.productKind);
  const result = await client.execute({
    sql: `SELECT
            COALESCE(SUM(CASE
              WHEN r.tipo = 'IMAGEN'
                AND r.origen = 'GENERADO_IA'
                AND r.estado NOT IN ('RECHAZADO', 'ARCHIVADO')
                AND r.archivado_en_ms IS NULL
              THEN 1 ELSE 0 END), 0) AS generated_image_count,
            COUNT(DISTINCT CASE
              WHEN r.tipo = 'IMAGEN'
                AND r.origen IN ('ORIGINAL', 'IMPORTADO', 'MANUAL')
                AND r.estado NOT IN ('RECHAZADO', 'ARCHIVADO')
                AND r.archivado_en_ms IS NULL
                AND json_extract(r.metadata_generacion_json, '$.generationReferenceKind')
                  IN (?, ?)
              THEN json_extract(r.metadata_generacion_json, '$.generationReferenceKind')
              ELSE NULL END) AS generation_reference_count
          FROM biblioteca_contenido AS b
          JOIN recursos_contenido AS r ON r.biblioteca_contenido_id = b.id
          WHERE ${identityPredicate}
            AND b.estado NOT IN ('RECHAZADO', 'REEMPLAZADO')`,
    args: [...referenceKinds, identity.value]
  });
  const row = result.rows[0];
  const generatedImageCount = Number(row?.generated_image_count ?? 0);
  const generationReferenceCount = Number(row?.generation_reference_count ?? 0);
  return {
    checked: true,
    hasGenerationReferences: generationReferenceCount >= 2,
    hasGeneratedImages: generatedImageCount > 0,
    generatedImageCount
  };
}
