import type { APIRoute } from 'astro';
import { contentJsonError, contentJsonSuccess } from '../../../../../../lib/content/api.ts';
import { publicContentPayload } from '../../../../../../lib/content/presentation.ts';
import { removeProductContentReference, saveProductContentReference } from '../../../../../../lib/content/service.ts';
import { ContentError } from '../../../../../../lib/content/errors.ts';

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
  try {
    if (!(request.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      throw new ContentError('Selecciona una imagen para subir.', 'REFERENCIA_REQUERIDA', 400);
    }
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') throw new ContentError('Selecciona una imagen para subir.', 'REFERENCIA_REQUERIDA', 400);
    const content = await saveProductContentReference(params.id, params.role, file);
    return contentJsonSuccess({ content: publicContentPayload(content) }, 201);
  } catch (error) {
    return contentJsonError(error);
  }
};

export const DELETE: APIRoute = async ({ params }) => {
  try {
    const content = await removeProductContentReference(params.id, params.role);
    return contentJsonSuccess({ content: publicContentPayload(content) });
  } catch (error) {
    return contentJsonError(error);
  }
};
