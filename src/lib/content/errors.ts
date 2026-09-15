import { ZodError } from 'zod';

export class ContentError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = 'ContentError';
    this.code = code;
    this.status = status;
  }
}

export function publicContentError(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: { ok: false, code: 'VALIDACION', message: error.issues[0]?.message ?? 'Revisa la configuración elegida.' }
    };
  }
  if (error instanceof ContentError) {
    return { status: error.status, body: { ok: false, code: error.code, message: error.message } };
  }
  return {
    status: 500,
    body: { ok: false, code: 'ERROR_INTERNO', message: 'No hemos podido preparar el contenido. Lo que ya tenías sigue guardado.' }
  };
}
