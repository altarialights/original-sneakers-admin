import { ZodError } from 'zod';

export class ProductDetectionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProductDetectionError';
    this.code = code;
    this.status = status;
  }
}

export function blobFailure(error: unknown): ProductDetectionError {
  if (error instanceof ProductDetectionError) return error;

  const detail = errorText(error).toLowerCase();
  if (
    detail.includes('no blob credentials found')
    || detail.includes('no storeid was found')
    || detail.includes('missing blob store')
    || detail.includes('not configured')
    || detail.includes('no configurado')
  ) {
    return new ProductDetectionError(
      'El almacenamiento temporal no está configurado correctamente.',
      'BLOB_CONFIG_ERROR',
      503,
      { cause: error }
    );
  }
  if (
    detail.includes('oidc')
    || detail.includes('credential')
    || detail.includes('token')
    || detail.includes('jwt')
    || detail.includes('unauthorized')
    || detail.includes('forbidden')
    || /\b(?:401|403)\b/.test(detail)
  ) {
    return new ProductDetectionError(
      'No hemos podido autenticar el almacenamiento temporal.',
      'BLOB_AUTH_ERROR',
      503,
      { cause: error }
    );
  }
  return new ProductDetectionError(
    'Vercel Blob no está disponible en este momento. Inténtalo otra vez.',
    'BLOB_PROVIDER_ERROR',
    503,
    { cause: error }
  );
}

interface ErrorLike {
  name?: unknown;
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  message?: unknown;
  cause?: unknown;
}

export interface SanitizedBlobError {
  class: string;
  status: number | null;
  code: string | null;
  message: string;
  cause: SanitizedBlobError | string | null;
}

function asErrorLike(error: unknown): ErrorLike | undefined {
  return typeof error === 'object' && error !== null ? error as ErrorLike : undefined;
}

function errorText(error: unknown): string {
  const candidate = asErrorLike(error);
  const own = candidate
    ? [candidate.name, candidate.code, candidate.status, candidate.statusCode, candidate.message]
      .filter((value) => value !== undefined && value !== null)
      .join(' ')
    : String(error ?? '');
  return candidate?.cause === undefined ? own : `${own} ${errorText(candidate.cause)}`;
}

function redactSensitiveText(value: unknown, secretValues: readonly string[]): string {
  let result = String(value ?? '');
  for (const secret of secretValues) {
    if (secret.trim()) result = result.replaceAll(secret, '[REDACTED]');
  }
  return result
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\bvercel_blob_[A-Za-z0-9_-]+\b/g, '[REDACTED_BLOB_TOKEN]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .slice(0, 1_000);
}

function numericStatus(error: ErrorLike | undefined): number | null {
  const candidate = error?.status ?? error?.statusCode;
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  if (typeof candidate === 'string' && /^\d{3}$/.test(candidate)) return Number(candidate);
  return null;
}

export function sanitizeBlobError(
  error: unknown,
  secretValues: readonly string[] = [
    process.env.VERCEL_OIDC_TOKEN ?? '',
    process.env.BLOB_READ_WRITE_TOKEN ?? ''
  ],
  depth = 0
): SanitizedBlobError {
  const candidate = asErrorLike(error);
  const cause = candidate?.cause;
  let safeCause: SanitizedBlobError | string | null = null;
  if (cause !== undefined && cause !== null) {
    safeCause = depth >= 2 || typeof cause !== 'object'
      ? redactSensitiveText(cause, secretValues)
      : sanitizeBlobError(cause, secretValues, depth + 1);
  }
  const errorClass = candidate?.name ?? (error instanceof Error ? error.name : typeof error);
  return {
    class: redactSensitiveText(errorClass, secretValues),
    status: numericStatus(candidate),
    code: candidate?.code === undefined ? null : redactSensitiveText(candidate.code, secretValues),
    message: redactSensitiveText(candidate?.message ?? error, secretValues),
    cause: safeCause
  };
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
