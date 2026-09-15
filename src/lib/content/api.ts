import { ContentError, publicContentError } from './errors.ts';

export async function readContentJson(request: Request): Promise<unknown> {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    throw new ContentError('La solicitud no es válida.', 'JSON_REQUERIDO');
  }
  try {
    return await request.json();
  } catch {
    throw new ContentError('No hemos podido leer los datos enviados.', 'JSON_INVALIDO');
  }
}

export function contentJsonError(error: unknown): Response {
  const result = publicContentError(error);
  return Response.json(result.body, { status: result.status });
}

export function contentJsonSuccess(body: Record<string, unknown>, status = 200): Response {
  return Response.json({ ok: true, ...body }, { status });
}
