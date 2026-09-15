import type { APIRoute } from 'astro';
import { createDetectionSessionId } from '../../../lib/product-detection/blob-paths.ts';
import { productKindSchema } from '../../../lib/product-detection/schemas.ts';
import { detectionJsonError } from '../../../lib/product-detection/errors.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { productKind } = await request.json();
    const selected = productKindSchema.parse(productKind);
    return Response.json({ ok: true, sessionId: createDetectionSessionId(), productKind: selected });
  } catch (error) {
    return detectionJsonError(error);
  }
};
