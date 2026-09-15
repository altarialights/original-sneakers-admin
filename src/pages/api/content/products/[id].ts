import type { APIRoute } from 'astro';
import { contentJsonError, contentJsonSuccess } from '../../../../lib/content/api.ts';
import { ContentError } from '../../../../lib/content/errors.ts';
import { getProductContent, getPublicationProduct } from '../../../../lib/content/queries.ts';
import { assertProductId } from '../../../../lib/content/service.ts';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  try {
    const productId = assertProductId(params.id);
    const product = await getPublicationProduct(productId);
    if (!product) throw new ContentError('El producto no existe.', 'PRODUCTO_NO_ENCONTRADO', 404);
    const content = await getProductContent(productId);
    return contentJsonSuccess({ product, content });
  } catch (error) {
    console.error('[content] load:error');
    return contentJsonError(error);
  }
};
