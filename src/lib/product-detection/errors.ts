import { ZodError } from 'zod';

export class ProductDetectionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = 'ProductDetectionError';
    this.code = code;
    this.status = status;
  }
}

export function blobFailure(error: unknown): ProductDetectionError {
  const detail = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : '';
  if (detail.includes('oidc') || detail.includes('credential') || detail.includes('token') || detail.includes('jwt')) {
    return new ProductDetectionError(
      'No hemos podido autenticar el almacenamiento temporal. En local, actualiza VERCEL_OIDC_TOKEN con: pnpm dlx vercel env pull .env.local',
      'BLOB_OIDC_INVALIDO',
      503
    );
  }
  return new ProductDetectionError(
    'No hemos podido guardar o recuperar las imágenes. Inténtalo otra vez.',
    'BLOB_ERROR',
    503
  );
}

export function publicProductDetectionError(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof ProductDetectionError) {
    return { status: error.status, body: { ok: false, code: error.code, message: error.message } };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: { ok: false, code: 'SOLICITUD_INVALIDA', message: 'Revisa las imágenes enviadas.' }
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      code: 'ERROR_INTERNO',
      message: 'No hemos podido analizar correctamente las imágenes. Inténtalo otra vez.'
    }
  };
}

export function detectionJsonError(error: unknown): Response {
  const result = publicProductDetectionError(error);
  return Response.json(result.body, { status: result.status });
}

