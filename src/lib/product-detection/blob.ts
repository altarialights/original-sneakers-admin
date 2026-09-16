import { del, get, issueSignedToken, list } from '@vercel/blob';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  sourceDataImageKinds,
  type ProductKind,
  type SourceDataImageKind
} from './config.ts';
import { assertSessionBlobPath, parseTemporaryBlobPath, sessionBlobPrefix } from './blob-paths.ts';
import { blobFailure, ProductDetectionError } from './errors.ts';
import { imageDataUrl, readLimitedStream, validateImageBytes, validateImageMetadata } from './files.ts';

type OidcOptions = { oidcToken: string; storeId: string };

interface TemporaryUploadTokenOptions {
  issuer?: typeof issueSignedToken;
}

export async function issueTemporaryUploadToken(
  pathname: string,
  options: TemporaryUploadTokenOptions = {}
) {
  parseTemporaryBlobPath(pathname);
  const issuer = options.issuer ?? issueSignedToken;
  try {
    return await issuer({
      pathname,
      operations: ['put'],
      allowedContentTypes: [...ALLOWED_IMAGE_MIME_TYPES],
      maximumSizeInBytes: MAX_IMAGE_BYTES,
      validUntil: Date.now() + 10 * 60 * 1000
    });
  } catch (error) {
    throw blobFailure(error);
  }
}

export async function readPrivateSessionImages(
  sessionId: string,
  productKind: ProductKind,
  pathnames: Partial<Record<SourceDataImageKind, string>>,
  options: {
    auth?: OidcOptions;
    getter?: typeof get;
  } = {}
): Promise<Array<{ kind: SourceDataImageKind; dataUrl: string }>> {
  const auth = options.auth ?? {};
  const getter = options.getter ?? get;
  try {
    return await Promise.all(sourceDataImageKinds(productKind).map(async (kind) => {
      const candidatePathname = pathnames[kind] ?? '';
      let pathname: string;
      try {
        pathname = assertSessionBlobPath(candidatePathname, sessionId, productKind, kind);
      } catch (error) {
        if (productKind === 'ROPA' && process.env.NODE_ENV === 'development') {
          const reason = error instanceof ProductDetectionError ? error.code : 'VALIDACION_DESCONOCIDA';
          console.error(`[product-detection] clothing:path-validation kind=${kind} pathname=${candidatePathname || '(vacío)'} valid=false reason=${reason}`);
        }
        throw error;
      }
      if (productKind === 'ROPA' && process.env.NODE_ENV === 'development') {
        console.info(`[product-detection] clothing:path-validation kind=${kind} pathname=${pathname} valid=true`);
      }
      const path = parseTemporaryBlobPath(pathname);
      const result = await getter(pathname, { ...auth, access: 'private', useCache: false });
      if (!result || result.statusCode !== 200) {
        throw new ProductDetectionError(`Falta la foto de ${kind}.`, 'IMAGEN_NO_ENCONTRADA', 404);
      }
      validateImageMetadata(result.blob.contentType, result.blob.size);
      const bytes = await readLimitedStream(result.stream, result.blob.size);
      const mimeType = validateImageBytes(bytes, result.blob.contentType);
      const expectedExtension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];
      if (path.extension !== expectedExtension) {
        throw new ProductDetectionError('Esta imagen no es compatible.', 'EXTENSION_IMAGEN_INVALIDA');
      }
      console.info(`[product-detection] blob:${kind}:ready mime=${mimeType} bytes=${bytes.byteLength}`);
      return { kind, dataUrl: imageDataUrl(bytes, mimeType) };
    }));
  } catch (error) {
    if (error instanceof ProductDetectionError) throw error;
    throw blobFailure(error);
  }
}

export async function deleteTemporarySession(
  sessionId: string,
  options: {
    auth?: OidcOptions;
    lister?: typeof list;
    deleter?: typeof del;
  } = {}
): Promise<number> {
  const oidc = options.auth ?? {};
  const lister = options.lister ?? list;
  const deleter = options.deleter ?? del;
  const prefix = sessionBlobPrefix(sessionId);
  try {
    const result = await lister({ ...oidc, prefix, limit: 20 });
    const safePaths = result.blobs
      .map((blob) => blob.pathname)
      .filter((pathname) => {
        try {
          const parsed = parseTemporaryBlobPath(pathname);
          return parsed.sessionId === sessionId;
        } catch {
          return false;
        }
      });
    if (safePaths.length > 0) await deleter(safePaths, oidc);
    return safePaths.length;
  } catch (error) {
    throw blobFailure(error);
  }
}

export async function deleteTemporarySourceImages(
  sessionId: string,
  productKind: ProductKind,
  options: {
    auth?: OidcOptions;
    lister?: typeof list;
    deleter?: typeof del;
  } = {}
): Promise<number> {
  const oidc = options.auth ?? {};
  const lister = options.lister ?? list;
  const deleter = options.deleter ?? del;
  const prefix = sessionBlobPrefix(sessionId);
  const allowedKinds = new Set<SourceDataImageKind>(sourceDataImageKinds(productKind));
  try {
    const result = await lister({ ...oidc, prefix, limit: 20 });
    const safePaths = result.blobs.map((blob) => blob.pathname).filter((pathname) => {
      try {
        const parsed = parseTemporaryBlobPath(pathname);
        return parsed.sessionId === sessionId
          && parsed.productKind === productKind
          && allowedKinds.has(parsed.kind as SourceDataImageKind);
      } catch {
        return false;
      }
    });
    if (safePaths.length > 0) await deleter(safePaths, oidc);
    return safePaths.length;
  } catch (error) {
    throw blobFailure(error);
  }
}
