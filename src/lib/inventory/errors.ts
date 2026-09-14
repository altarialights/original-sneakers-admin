export class InventoryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = 'InventoryError';
    this.code = code;
    this.status = status;
  }
}

export class InventoryNotFoundError extends InventoryError {
  constructor(message = 'No encontramos el elemento solicitado.') {
    super(message, 'NO_ENCONTRADO', 404);
  }
}

export class DuplicateProductError extends InventoryError {
  readonly productId: string;

  constructor(productId: string) {
    super('Este producto ya existe.', 'PRODUCTO_DUPLICADO', 409);
    this.productId = productId;
  }
}

export class DuplicateVariantError extends InventoryError {
  readonly variantId: string;

  constructor(variantId: string) {
    super('Esta talla ya existe. Puedes ajustar su cantidad.', 'VARIANTE_DUPLICADA', 409);
    this.variantId = variantId;
  }
}

export class ProductHasStockError extends InventoryError {
  readonly units: number;

  constructor(units: number) {
    super(`Este producto todavía tiene ${units} ${units === 1 ? 'unidad' : 'unidades'}.`, 'PRODUCTO_CON_STOCK', 409);
    this.units = units;
  }
}

export function publicInventoryError(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof ZodError) {
    return { status: 400, body: { ok: false, code: 'VALIDACION', message: error.issues[0]?.message ?? 'Revisa los datos.' } };
  }
  if (error instanceof DuplicateProductError) {
    return { status: error.status, body: { ok: false, code: error.code, message: error.message, productId: error.productId } };
  }
  if (error instanceof DuplicateVariantError) {
    return { status: error.status, body: { ok: false, code: error.code, message: error.message, variantId: error.variantId } };
  }
  if (error instanceof ProductHasStockError) {
    return { status: error.status, body: { ok: false, code: error.code, message: error.message, units: error.units } };
  }
  if (error instanceof InventoryError) {
    return { status: error.status, body: { ok: false, code: error.code, message: error.message } };
  }
  return { status: 500, body: { ok: false, code: 'ERROR_INTERNO', message: 'No hemos podido guardar los cambios.' } };
}
import { ZodError } from 'zod';
