import type { APIRoute } from 'astro';
import { readJson, jsonError, jsonSuccess } from '../../../lib/inventory/api.ts';
import { approveProductFromPhotos } from '../../../lib/product-detection/approval.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const result = await approveProductFromPhotos(await readJson(request));
    return jsonSuccess({ message: 'Producto añadido al stock', ...result }, result.idempotent ? 200 : 201);
  } catch (error) {
    return jsonError(error);
  }
};
