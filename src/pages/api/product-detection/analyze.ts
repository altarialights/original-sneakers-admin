import type { APIRoute } from 'astro';
import { detectionJsonError } from '../../../lib/product-detection/errors.ts';
import { analyzeProductPhotos } from '../../../lib/product-detection/service.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
      return Response.json(
        { ok: false, code: 'JSON_REQUERIDO', message: 'La solicitud no es válida.' },
        { status: 415 }
      );
    }
    const body = await request.json();
    const result = await analyzeProductPhotos(body);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error('[product-detection] analysis failed');
    return detectionJsonError(error);
  }
};

