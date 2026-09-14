import type { APIRoute } from 'astro';
import { InventoryError } from '../../../../lib/inventory/errors.ts';
import { jsonError, jsonSuccess, readJson } from '../../../../lib/inventory/api.ts';
import { updateProduct } from '../../../../lib/inventory/mutations.ts';
import { parseUpdateProductPayload } from '../../../../lib/inventory/schemas.ts';

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request }) => {
  try {
    if (!params.id) throw new InventoryError('Producto no válido.', 'ID_INVALIDO');
    await updateProduct(params.id, parseUpdateProductPayload(await readJson(request)));
    return jsonSuccess({ message: 'Cambios guardados' });
  } catch (error) {
    return jsonError(error);
  }
};

