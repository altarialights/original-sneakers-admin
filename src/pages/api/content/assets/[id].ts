import type { APIRoute } from 'astro';
import { z } from 'zod';
import { contentJsonError } from '../../../../lib/content/api.ts';
import { streamPrivateContentImage } from '../../../../lib/content/blob.ts';
import { ContentError } from '../../../../lib/content/errors.ts';
import { contentImageFilename } from '../../../../lib/content/formatters.ts';
import { getContentImageResource } from '../../../../lib/content/queries.ts';

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  try {
    const resourceId = z.uuid('El recurso solicitado no es válido.').parse(params.id);
    const resource = await getContentImageResource(resourceId);
    if (!resource) throw new ContentError('La imagen no existe o ya no está disponible.', 'IMAGEN_NO_ENCONTRADA', 404);
    const downloadName = new URL(request.url).searchParams.get('download') === '1'
      ? contentImageFilename(resource)
      : undefined;
    return await streamPrivateContentImage(resource.storageUri, downloadName);
  } catch (error) {
    console.error('[content-assets] read failed', error);
    return contentJsonError(error);
  }
};
