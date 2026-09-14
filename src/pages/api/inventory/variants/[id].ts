import type { APIRoute } from 'astro';
import { jsonError, jsonSuccess, readJson } from '../../../../lib/inventory/api.ts';
import { InventoryError } from '../../../../lib/inventory/errors.ts';
import { updateVariant } from '../../../../lib/inventory/mutations.ts';
import { parseUpdateVariantPayload } from '../../../../lib/inventory/schemas.ts';

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request }) => {
  try {
    if (!params.id) throw new InventoryError('Talla no válida.', 'ID_INVALIDO');
    await updateVariant(params.id, parseUpdateVariantPayload(await readJson(request)));
    return jsonSuccess({ message: 'Cambios guardados' });
  } catch (error) {
    return jsonError(error);
  }
};

