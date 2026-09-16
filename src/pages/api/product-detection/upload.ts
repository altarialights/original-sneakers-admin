import type { APIRoute } from 'astro';
import { handleUploadPresigned, type HandleUploadPresignedBody } from '@vercel/blob/client';
import { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_BYTES } from '../../../lib/product-detection/config.ts';
import { issueTemporaryUploadToken } from '../../../lib/product-detection/blob.ts';
import { parseTemporaryBlobPath } from '../../../lib/product-detection/blob-paths.ts';
import {
  blobFailure,
  detectionJsonError,
  ProductDetectionError,
  sanitizeBlobError
} from '../../../lib/product-detection/errors.ts';
import { getBlobConfigurationPresence } from '../../../lib/product-detection/env.ts';

export const prerender = false;

// @vercel/blob 2.8 requires a truthy webhook key before dispatching the request,
// even when no completion callback is configured. This route accepts only URL
// issuance events, so the callback-verification branch is deliberately unreachable.
const NO_CALLBACK_KEY = 'unused-no-upload-completed-callback';

export const POST: APIRoute = async ({ request }) => {
  const startedAt = Date.now();
  let kind = 'unknown';
  try {
    const body = await request.json() as HandleUploadPresignedBody;
    if (body.type !== 'blob.generate-presigned-url') {
      throw new ProductDetectionError('La solicitud de subida no es válida.', 'SOLICITUD_INVALIDA', 400);
    }
    const parsedPath = parseTemporaryBlobPath(body.payload.pathname);
    kind = parsedPath.kind;
    const result = await handleUploadPresigned({
      request,
      body,
      webhookPublicKey: NO_CALLBACK_KEY,
      getSignedToken: async (pathname) => {
        parseTemporaryBlobPath(pathname);
        return {
          token: await issueTemporaryUploadToken(pathname),
          urlOptions: {
            allowedContentTypes: [...ALLOWED_IMAGE_MIME_TYPES],
            maximumSizeInBytes: MAX_IMAGE_BYTES,
            addRandomSuffix: false,
            allowOverwrite: true,
            cacheControlMaxAge: 60
          }
        };
      }
    });
    return Response.json(result);
  } catch (error) {
    const classified = error instanceof ProductDetectionError ? error : blobFailure(error);
    const details = sanitizeBlobError(error);
    const configuration = await getBlobConfigurationPresence();
    console.error('[product-detection] blob-upload:error', JSON.stringify({
      ...details,
      status: details.status ?? classified.status,
      code: details.code ?? classified.code,
      classification: classified.code,
      durationMs: Date.now() - startedAt,
      kind,
      vercelEnv: process.env.VERCEL_ENV ?? 'local',
      ...configuration
    }));
    return detectionJsonError(classified);
  }
};
