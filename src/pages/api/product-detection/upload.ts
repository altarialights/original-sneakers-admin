import type { APIRoute } from 'astro';
import { handleUploadPresigned, type HandleUploadPresignedBody } from '@vercel/blob/client';
import { ALLOWED_IMAGE_MIME_TYPES, MAX_IMAGE_BYTES } from '../../../lib/product-detection/config.ts';
import { issueTemporaryUploadToken } from '../../../lib/product-detection/blob.ts';
import { parseTemporaryBlobPath } from '../../../lib/product-detection/blob-paths.ts';
import { detectionJsonError } from '../../../lib/product-detection/errors.ts';
import { getBlobWebhookPublicKey } from '../../../lib/product-detection/env.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json() as HandleUploadPresignedBody;
    const result = await handleUploadPresigned({
      request,
      body,
      webhookPublicKey: await getBlobWebhookPublicKey(),
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
    console.error('[product-detection] blob upload authorization failed');
    return detectionJsonError(error);
  }
};

