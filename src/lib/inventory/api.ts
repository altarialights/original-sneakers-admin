import { InventoryError, publicInventoryError } from './errors.ts';

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) throw new InventoryError('La solicitud no es válida.', 'JSON_REQUERIDO');
  try {
    return await request.json();
  } catch {
    throw new InventoryError('No hemos podido leer los datos enviados.', 'JSON_INVALIDO');
  }
}

export function jsonSuccess(body: Record<string, unknown>, status = 200): Response {
  return Response.json({ ok: true, ...body }, { status });
}

export function jsonError(error: unknown): Response {
  const result = publicInventoryError(error);
  return Response.json(result.body, { status: result.status });
}

