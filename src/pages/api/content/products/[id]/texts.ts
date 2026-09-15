import type { APIRoute } from 'astro';
import { contentJsonError, contentJsonSuccess, readContentJson } from '../../../../../lib/content/api.ts';
import { generateTextsRequestSchema } from '../../../../../lib/content/schemas.ts';
import { generateAndSaveProductTexts, saveManualProductTexts } from '../../../../../lib/content/service.ts';

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const payload = generateTextsRequestSchema.parse(await readContentJson(request));
    const content = await generateAndSaveProductTexts(params.id, payload.field ?? null);
    return contentJsonSuccess({ content }, 201);
  } catch (error) {
    console.error('[content-generation] text:request-failed');
    return contentJsonError(error);
  }
};

export const PATCH: APIRoute = async ({ params, request }) => {
  try {
    const content = await saveManualProductTexts(params.id, await readContentJson(request));
    return contentJsonSuccess({ content, message: 'Cambios guardados' });
  } catch (error) {
    console.error('[content] text-save:failed');
    return contentJsonError(error);
  }
};
