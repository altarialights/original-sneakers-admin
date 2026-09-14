import type { APIRoute } from 'astro';
import { jsonError, jsonSuccess, readJson } from '../../../../lib/inventory/api.ts';
import { createProduct } from '../../../../lib/inventory/mutations.ts';
import { parseCreateProductPayload } from '../../../../lib/inventory/schemas.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const result = await createProduct(parseCreateProductPayload(await readJson(request)));
    return jsonSuccess({ message: 'Producto añadido', ...result }, 201);
  } catch (error) {
    return jsonError(error);
  }
};

