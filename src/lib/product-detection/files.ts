import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  type AllowedImageMimeType
} from './config.ts';
import { ProductDetectionError } from './errors.ts';

export function isAllowedImageMime(value: string): value is AllowedImageMimeType {
  return ALLOWED_IMAGE_MIME_TYPES.includes(value as AllowedImageMimeType);
}

export function validateImageMetadata(mimeType: string, size: number): void {
  if (!isAllowedImageMime(mimeType)) {
    throw new ProductDetectionError('Esta imagen no es compatible.', 'IMAGEN_NO_COMPATIBLE');
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new ProductDetectionError('Esta imagen no es compatible.', 'IMAGEN_VACIA');
  }
  if (size > MAX_IMAGE_BYTES) {
    throw new ProductDetectionError(
      'La imagen supera el tamaño máximo permitido.',
      'IMAGEN_DEMASIADO_GRANDE',
      413
    );
  }
}

export function detectImageMime(bytes: Uint8Array): AllowedImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'image/png';
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) return 'image/webp';
  return null;
}

export function validateImageBytes(bytes: Uint8Array, declaredMime: string): AllowedImageMimeType {
  validateImageMetadata(declaredMime, bytes.byteLength);
  const detected = detectImageMime(bytes);
  if (!detected || detected !== declaredMime) {
    throw new ProductDetectionError('Esta imagen no es compatible.', 'CONTENIDO_IMAGEN_INVALIDO');
  }
  return detected;
}

export async function readLimitedStream(
  stream: ReadableStream<Uint8Array>,
  expectedSize: number,
  maximumSize = MAX_IMAGE_BYTES
): Promise<Uint8Array> {
  if (expectedSize > maximumSize) {
    throw new ProductDetectionError(
      'La imagen supera el tamaño máximo permitido.',
      'IMAGEN_DEMASIADO_GRANDE',
      413
    );
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumSize) {
      await reader.cancel();
      throw new ProductDetectionError(
        'La imagen supera el tamaño máximo permitido.',
        'IMAGEN_DEMASIADO_GRANDE',
        413
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function imageDataUrl(bytes: Uint8Array, mimeType: AllowedImageMimeType): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

