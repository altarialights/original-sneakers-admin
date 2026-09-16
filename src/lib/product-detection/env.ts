import { DEFAULT_OPENAI_VISION_MODEL } from './config.ts';
import { ProductDetectionError } from './errors.ts';

type DetectionSecret =
  | 'OPENAI_API_KEY'
  | 'OPENAI_VISION_MODEL';

type SecretReader = (name: DetectionSecret) => string | undefined;

async function astroSecret(name: DetectionSecret): Promise<string | undefined> {
  try {
    const { getSecret } = await import('astro:env/server');
    return getSecret(name)?.trim();
  } catch {
    return undefined;
  }
}

export async function readDetectionSecret(
  name: DetectionSecret,
  environment: NodeJS.ProcessEnv = process.env,
  fallback?: SecretReader
): Promise<string | undefined> {
  return environment[name]?.trim() || fallback?.(name)?.trim() || await astroSecret(name);
}

export async function getOpenAIConfig(environment: NodeJS.ProcessEnv = process.env): Promise<{
  apiKey: string;
  model: string;
}> {
  const apiKey = await readDetectionSecret('OPENAI_API_KEY', environment);
  if (!apiKey) {
    throw new ProductDetectionError(
      'El análisis de imágenes no está configurado. Falta OPENAI_API_KEY.',
      'OPENAI_NO_CONFIGURADO',
      503
    );
  }
  const model = await readDetectionSecret('OPENAI_VISION_MODEL', environment) || DEFAULT_OPENAI_VISION_MODEL;
  return { apiKey, model };
}

export interface BlobConfigurationPresence {
  storeIdConfigured: boolean;
  oidcEnvVarVisible: boolean;
  legacyReadWriteTokenVisible: boolean;
}

export function getBlobConfigurationPresence(
  environment: NodeJS.ProcessEnv = process.env
): BlobConfigurationPresence {
  return {
    storeIdConfigured: Boolean(environment.BLOB_STORE_ID?.trim()),
    oidcEnvVarVisible: Boolean(environment.VERCEL_OIDC_TOKEN?.trim()),
    legacyReadWriteTokenVisible: Boolean(environment.BLOB_READ_WRITE_TOKEN?.trim())
  };
}
