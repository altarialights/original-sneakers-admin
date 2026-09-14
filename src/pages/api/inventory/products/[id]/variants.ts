import type { APIRoute } from 'astro';
import { jsonError, jsonSuccess, readJson } from '../../../../../lib/inventory/api.ts';
import { InventoryError } from '../../../../../lib/inventory/errors.ts';
import { addVariants } from '../../../../../lib/inventory/mutations.ts';
import { parseAddVariantsPayload } from '../../../../../lib/inventory/schemas.ts';

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
  try {
    if (!params.id) throw new InventoryError('Producto no válido.', 'ID_INVALIDO');
    const result = await addVariants(params.id, parseAddVariantsPayload(await readJson(request)));
    return jsonSuccess({ message: 'Producto añadido', ...result }, 201);
  } catch (error) {
    return jsonError(error);
  }
};

