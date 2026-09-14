import type { APIRoute } from 'astro';
import { jsonError, jsonSuccess, readJson } from '../../../../../lib/inventory/api.ts';
import { InventoryError } from '../../../../../lib/inventory/errors.ts';
import { archiveProduct } from '../../../../../lib/inventory/mutations.ts';
import { archivePayloadSchema } from '../../../../../lib/inventory/schemas.ts';

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
  try {
    if (!params.id) throw new InventoryError('Producto no válido.', 'ID_INVALIDO');
    const { force } = archivePayloadSchema.parse(await readJson(request));
    await archiveProduct(params.id, force);
    return jsonSuccess({ message: 'Producto dado de baja' });
  } catch (error) {
    return jsonError(error);
  }
};

