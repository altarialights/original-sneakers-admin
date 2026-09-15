import { createHash } from 'node:crypto';
import {
  BlobAccessError,
  BlobContentTypeNotAllowedError,
  BlobFileTooLargeError,
  BlobPathnameMismatchError,
  BlobServiceNotAvailable,
  BlobServiceRateLimited,
  BlobStoreNotFoundError,
  del,
  get,
  put
} from '@vercel/blob';
import { uuidV7 } from '../inventory/ids.ts';
import { getContentBlobConfig } from './config.ts';
import { ContentError } from './errors.ts';
import type { ContentReferenceRole, GeneratedImage, StoredContentReference, StoredGeneratedImage } from './types.ts';

const MAX_REFERENCE_BYTES = 15 * 1024 * 1024;

type ContentBlobAuth = Awaited<ReturnType<typeof getContentBlobConfig>>;

function blobDiagnostic(error: unknown): string {
  if (!error || typeof error !== 'object') return 'name=Unknown';
  const value = error as { name?: unknown; code?: unknown; status?: unknown };
  return `name=${String(value.name ?? 'Error')} code=${String(value.code ?? 'n/a')} status=${String(value.status ?? 'n/a')}`;
}

function publicBlobError(error: unknown): ContentError {
  if (error instanceof ContentError) return error;
  if (error instanceof BlobAccessError || error instanceof BlobStoreNotFoundError) {
    return new ContentError('No podemos acceder a la biblioteca de imágenes. Revisa la conexión de Vercel Blob y vuelve a intentarlo.', 'BLOB_ACCESO', 503);
  }
  if (error instanceof BlobContentTypeNotAllowedError || error instanceof BlobPathnameMismatchError) {
    return new ContentError('Blob ha rechazado el formato o el nombre de la imagen. Puedes reintentar solo esta vista.', 'BLOB_FORMATO', 422);
  }
  if (error instanceof BlobFileTooLargeError) {
    return new ContentError('La imagen supera el tamaño admitido por la biblioteca. Puedes reintentar solo esta vista.', 'BLOB_TAMANO', 422);
  }
  if (error instanceof BlobServiceRateLimited || error instanceof BlobServiceNotAvailable) {
    return new ContentError('Vercel Blob no está disponible temporalmente. Conservaremos las demás imágenes y podrás reintentar esta vista.', 'BLOB_TEMPORAL', 503);
  }
  return new ContentError('No se pudo guardar esta imagen en la biblioteca. Las demás imágenes válidas se conservarán y podrás reintentar esta vista.', 'BLOB_GUARDADO', 503);
}

export async function uploadGeneratedContentImage(
  productId: string,
  image: GeneratedImage,
  options: { uploader?: typeof put; auth?: ContentBlobAuth } = {}
): Promise<StoredGeneratedImage> {
  const pathname = `contenido-productos/${productId}/generadas/${uuidV7()}.webp`;
  const startedAt = performance.now();
  console.info(`[content-images] blob:upload:start angle=${image.angle} bytes=${image.bytes.byteLength} mime=${image.mimeType}`);
  try {
    const auth = options.auth ?? await getContentBlobConfig();
    const stored = await (options.uploader ?? put)(pathname, Buffer.from(image.bytes), {
      ...auth,
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: image.mimeType,
      cacheControlMaxAge: 31_536_000
    });
    console.info(`[content-images] blob:upload:completed angle=${image.angle} durationMs=${Math.round(performance.now() - startedAt)} pathnameLength=${stored.pathname.length}`);
    return {
      ...image,
      url: stored.url,
      pathname: stored.pathname,
      hash: createHash('sha256').update(image.bytes).digest('hex')
    };
  } catch (error) {
    console.error(`[content-images] generate:failed stage=BLOB angle=${image.angle} ${blobDiagnostic(error)}`);
    throw publicBlobError(error);
  }
}

const REFERENCE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif'
};

export async function uploadContentReference(
  productId: string,
  role: ContentReferenceRole,
  bytes: Uint8Array,
  mimeType: string,
  originalName: string,
  options: { uploader?: typeof put; auth?: ContentBlobAuth } = {}
): Promise<StoredContentReference> {
  const extension = REFERENCE_EXTENSIONS[mimeType];
  if (!extension) throw new ContentError('El formato de la referencia no es compatible.', 'REFERENCIA_FORMATO', 415);
  const rolePath = role === 'REFERENCIA_LATERAL' ? 'lateral' : 'trasera';
  const pathname = `contenido-productos/${productId}/referencias/${rolePath}-${uuidV7()}.${extension}`;
  try {
    const stored = await (options.uploader ?? put)(pathname, Buffer.from(bytes), {
      ...(options.auth ?? await getContentBlobConfig()),
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: mimeType,
      cacheControlMaxAge: 31_536_000
    });
    return {
      url: stored.url,
      pathname: stored.pathname,
      hash: createHash('sha256').update(bytes).digest('hex'),
      mimeType,
      role,
      originalName
    };
  } catch (error) {
    throw publicBlobError(error);
  }
}

export async function deleteGeneratedContentImages(pathnames: string[]): Promise<void> {
  if (pathnames.length === 0) return;
  try {
    await del(pathnames, { ...await getContentBlobConfig() });
  } catch {
    console.warn(`[content-images] blob:cleanup-failed count=${pathnames.length}`);
  }
}

export async function streamPrivateContentImage(
  urlOrPathname: string,
  downloadName?: string,
  options: { getter?: typeof get; auth?: ContentBlobAuth } = {}
): Promise<Response> {
  try {
    const result = await (options.getter ?? get)(urlOrPathname, { ...(options.auth ?? await getContentBlobConfig()), access: 'private' });
    if (!result || result.statusCode !== 200) throw new ContentError('La imagen no está disponible.', 'IMAGEN_NO_ENCONTRADA', 404);
    const headers: Record<string, string> = {
        'content-type': result.blob.contentType,
        'content-length': String(result.blob.size),
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff'
    };
    if (downloadName) headers['content-disposition'] = `attachment; filename="${downloadName.replace(/["\r\n]/g, '')}"`;
    return new Response(result.stream, { headers });
  } catch (error) {
    if (error instanceof ContentError) throw error;
    console.error(`[content-images] asset:read-failed ${blobDiagnostic(error)}`);
    throw publicBlobError(error);
  }
}

export async function readContentImageDataUrl(urlOrPathname: string): Promise<string> {
  let response: Response;
  try {
    const result = await get(urlOrPathname, { ...await getContentBlobConfig(), access: 'private' });
    if (!result || result.statusCode !== 200) throw new Error('not-found');
    if (result.blob.size > MAX_REFERENCE_BYTES) throw new ContentError('Una imagen de referencia es demasiado grande.', 'REFERENCIA_GRANDE');
    response = new Response(result.stream, { headers: { 'content-type': result.blob.contentType } });
  } catch (error) {
    if (error instanceof ContentError) throw error;
    response = await fetch(urlOrPathname);
    if (!response.ok) throw new ContentError('No hemos podido leer una imagen de referencia.', 'REFERENCIA_NO_DISPONIBLE', 422);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_REFERENCE_BYTES) throw new ContentError('Una imagen de referencia es demasiado grande.', 'REFERENCIA_GRANDE');
  }
  const contentType = response.headers.get('content-type')?.split(';')[0] || 'image/webp';
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_REFERENCE_BYTES) throw new ContentError('Una imagen de referencia es demasiado grande.', 'REFERENCIA_GRANDE');
  return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
}
