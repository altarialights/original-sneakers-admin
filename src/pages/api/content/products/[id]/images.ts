import type { APIRoute } from 'astro';
import { contentJsonError, contentJsonSuccess, readContentJson } from '../../../../../lib/content/api.ts';
import { generateAndSaveProductImages } from '../../../../../lib/content/service.ts';
import { publicContentPayload } from '../../../../../lib/content/presentation.ts';

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
  try {
    const result = await generateAndSaveProductImages(params.id, await readContentJson(request));
    return contentJsonSuccess({ content: publicContentPayload(result.content), summary: result.summary }, result.summary.failed > 0 ? 207 : 201);
  } catch (error) {
    console.error('[content-images] generate:failed stage=REQUEST');
    return contentJsonError(error);
  }
};
