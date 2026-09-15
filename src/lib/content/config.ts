import { ContentError } from './errors.ts';
import type { ImageQuality } from './types.ts';

export const DEFAULT_CONTENT_TEXT_MODEL = 'gpt-5.4-mini';
export const DEFAULT_CONTENT_IMAGE_MODEL = 'gpt-image-2';
export const CONTENT_GENERATION_TIMEOUT_MS = 240_000;

export const OPENAI_IMAGE_QUALITY: Record<ImageQuality, 'low' | 'medium' | 'high'> = {
  RAPIDA: 'low',
  ESTANDAR: 'medium',
  PREMIUM: 'high'
};

export const ANGLE_LABELS: Record<string, string> = {
  'lateral-exterior': 'lateral exterior',
  'lateral-interior': 'lateral interior',
  frontal: 'frontal',
  trasera: 'trasera',
  superior: 'superior',
  'tres-cuartos': 'tres cuartos',
  suela: 'suela',
  'detalle-logo-etiqueta-air-unit': 'detalle de logo, etiqueta o unidad de amortiguación visible',
  'detalle-pecho-logo': 'detalle del pecho o logo',
  'detalle-etiqueta': 'detalle de etiqueta',
  'prenda-completa-fondo-limpio': 'prenda completa sobre fondo limpio',
  'detalle-tejido-manga-estampado': 'detalle de tejido, manga o estampado'
};

type ContentSecret = 'OPENAI_API_KEY' | 'OPENAI_CONTENT_TEXT_MODEL' | 'OPENAI_CONTENT_IMAGE_MODEL' | 'VERCEL_OIDC_TOKEN' | 'BLOB_STORE_ID';

async function astroSecret(name: ContentSecret): Promise<string | undefined> {
  try {
    const { getSecret } = await import('astro:env/server');
    return getSecret(name)?.trim();
  } catch {
    return undefined;
  }
}

export async function getContentBlobConfig(environment: NodeJS.ProcessEnv = process.env): Promise<{
  oidcToken: string;
  storeId: string;
}> {
  const oidcToken = environment.VERCEL_OIDC_TOKEN?.trim() || await astroSecret('VERCEL_OIDC_TOKEN');
  const storeId = environment.BLOB_STORE_ID?.trim() || await astroSecret('BLOB_STORE_ID');
  if (!oidcToken || !storeId) {
    throw new ContentError('La biblioteca de imágenes no está configurada. Revisa la conexión con Vercel Blob.', 'BLOB_NO_CONFIGURADO', 503);
  }
  return { oidcToken, storeId };
}

export async function getContentOpenAIConfig(environment: NodeJS.ProcessEnv = process.env): Promise<{
  apiKey: string;
  textModel: string;
  imageModel: string;
}> {
  const apiKey = environment.OPENAI_API_KEY?.trim() || await astroSecret('OPENAI_API_KEY');
  if (!apiKey) throw new ContentError('La generación editorial no está configurada. Falta OPENAI_API_KEY.', 'OPENAI_NO_CONFIGURADO', 503);
  return {
    apiKey,
    textModel: environment.OPENAI_CONTENT_TEXT_MODEL?.trim()
      || await astroSecret('OPENAI_CONTENT_TEXT_MODEL')
      || DEFAULT_CONTENT_TEXT_MODEL,
    imageModel: environment.OPENAI_CONTENT_IMAGE_MODEL?.trim()
      || await astroSecret('OPENAI_CONTENT_IMAGE_MODEL')
      || DEFAULT_CONTENT_IMAGE_MODEL
  };
}
