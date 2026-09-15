import type { APIRoute } from 'astro';
import { deleteTemporarySession } from '../../../../lib/product-detection/blob.ts';
import { assertSessionId } from '../../../../lib/product-detection/blob-paths.ts';
import { detectionJsonError } from '../../../../lib/product-detection/errors.ts';

export const prerender = false;

export const DELETE: APIRoute = async ({ params }) => {
  try {
    const sessionId = assertSessionId(params.id);
    const deleted = await deleteTemporarySession(sessionId);
    return Response.json({ ok: true, deleted });
  } catch (error) {
    console.error('[product-detection] session cleanup failed');
    return detectionJsonError(error);
  }
};

