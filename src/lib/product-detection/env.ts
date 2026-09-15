import { DEFAULT_OPENAI_VISION_MODEL } from './config.ts';
import { ProductDetectionError } from './errors.ts';

type DetectionSecret =
  | 'OPENAI_API_KEY'
  | 'OPENAI_VISION_MODEL'
  | 'BLOB_STORE_ID'
  | 'BLOB_WEBHOOK_PUBLIC_KEY'
  | 'VERCEL_OIDC_TOKEN';

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

export interface BlobOidcOptions {
  oidcToken: string;
  storeId: string;
}

export async function getBlobOidcOptions(
  environment: NodeJS.ProcessEnv = process.env,
  fallback?: SecretReader
): Promise<BlobOidcOptions> {
  const [oidcToken, storeId] = await Promise.all([
    readDetectionSecret('VERCEL_OIDC_TOKEN', environment, fallback),
    readDetectionSecret('BLOB_STORE_ID', environment, fallback)
  ]);
  if (!oidcToken || !storeId) {
    throw new ProductDetectionError(
      'El almacenamiento temporal no está configurado. En local, ejecuta: pnpm dlx vercel env pull .env.local',
      'BLOB_OIDC_NO_CONFIGURADO',
      503
    );
  }
  return { oidcToken, storeId };
}

export async function getBlobWebhookPublicKey(environment: NodeJS.ProcessEnv = process.env): Promise<string> {
  const key = await readDetectionSecret('BLOB_WEBHOOK_PUBLIC_KEY', environment);
  if (!key) {
    throw new ProductDetectionError(
      'El almacenamiento temporal no está configurado. Falta BLOB_WEBHOOK_PUBLIC_KEY.',
      'BLOB_WEBHOOK_NO_CONFIGURADO',
      503
    );
  }
  return key;
}
