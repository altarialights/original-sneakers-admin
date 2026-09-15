import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  MIME_EXTENSION,
  PRODUCT_IMAGE_KINDS,
  PRODUCT_IMAGE_PATH_SEGMENTS,
  PRODUCT_KINDS,
  TEMPORARY_UPLOAD_PREFIX,
  type AllowedImageMimeType,
  type ProductImageKind,
  type ProductKind,
  productImageKindBelongsTo
} from './config.ts';
import { ProductDetectionError } from './errors.ts';

const sessionIdSchema = z.uuid();
const pathPattern = new RegExp(
  `^${TEMPORARY_UPLOAD_PREFIX}/([0-9a-f-]{36})/(${PRODUCT_KINDS.join('|')})/(${Object.values(PRODUCT_IMAGE_PATH_SEGMENTS).join('|')})\\.(jpg|png|webp)$`
);

export function createDetectionSessionId(): string {
  return randomUUID();
}

export function assertSessionId(value: unknown): string {
  const result = sessionIdSchema.safeParse(value);
  if (!result.success) throw new ProductDetectionError('La sesión de fotos no es válida.', 'SESION_INVALIDA');
  return result.data;
}

export function buildTemporaryBlobPath(
  sessionId: string,
  productKind: ProductKind,
  kind: ProductImageKind,
  mimeType: AllowedImageMimeType
): string {
  if (!productImageKindBelongsTo(productKind, kind)) throw new ProductDetectionError('La foto no corresponde al tipo de producto.', 'TIPO_IMAGEN_INVALIDO');
  return `${TEMPORARY_UPLOAD_PREFIX}/${assertSessionId(sessionId)}/${productKind}/${PRODUCT_IMAGE_PATH_SEGMENTS[kind]}.${MIME_EXTENSION[mimeType]}`;
}

export function parseTemporaryBlobPath(pathname: string): {
  sessionId: string;
  productKind: ProductKind;
  kind: ProductImageKind;
  extension: 'jpg' | 'png' | 'webp';
} {
  const match = pathPattern.exec(pathname);
  if (!match) throw new ProductDetectionError('La ruta de la imagen no es válida.', 'RUTA_BLOB_INVALIDA');
  return {
    sessionId: assertSessionId(match[1]),
    productKind: match[2] as ProductKind,
    kind: PRODUCT_IMAGE_KINDS.find((kind) => PRODUCT_IMAGE_PATH_SEGMENTS[kind] === match[3]) as ProductImageKind,
    extension: match[4] as 'jpg' | 'png' | 'webp'
  };
}

export function assertSessionBlobPath(pathname: string, sessionId: string, productKind: ProductKind, kind: ProductImageKind): string {
  const parsed = parseTemporaryBlobPath(pathname);
  if (parsed.sessionId !== assertSessionId(sessionId) || parsed.productKind !== productKind || parsed.kind !== kind) {
    throw new ProductDetectionError('La ruta de la imagen no es válida.', 'RUTA_BLOB_INVALIDA');
  }
  return pathname;
}

export function sessionBlobPrefix(sessionId: string): string {
  return `${TEMPORARY_UPLOAD_PREFIX}/${assertSessionId(sessionId)}/`;
}
