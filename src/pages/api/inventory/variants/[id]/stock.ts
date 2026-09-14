import type { APIRoute } from 'astro';
import { jsonError, jsonSuccess, readJson } from '../../../../../lib/inventory/api.ts';
import { InventoryError } from '../../../../../lib/inventory/errors.ts';
import { adjustStock } from '../../../../../lib/inventory/mutations.ts';
import { stockAdjustmentPayloadSchema } from '../../../../../lib/inventory/schemas.ts';

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
  try {
    if (!params.id) throw new InventoryError('Talla no válida.', 'ID_INVALIDO');
    const result = await adjustStock(params.id, stockAdjustmentPayloadSchema.parse(await readJson(request)));
    return jsonSuccess({ message: 'Stock actualizado', ...result });
  } catch (error) {
    return jsonError(error);
  }
};

