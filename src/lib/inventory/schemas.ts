import { z } from 'zod';
import { barcodeToString, moneyToCents, normalizeProductReference, normalizeText } from './normalization.ts';
import { InventoryError } from './errors.ts';
import type { CreateProductInput, ProductFieldsInput, VariantFieldsInput } from './types.ts';

const productType = z.enum(['CALZADO', 'ROPA', 'ACCESORIO', 'OTRO']);
const sizeSystem = z.enum(['EU', 'US', 'UK', 'CM', 'ALFABETICO', 'EDAD', 'ALTURA', 'DESCONOCIDO']);
const gender = z.enum(['UNISEX', 'HOMBRE', 'MUJER', 'NINO', 'NINA', 'DESCONOCIDO']);
const ageGroup = z.enum(['BEBE', 'INFANTIL', 'ADULTO', 'DESCONOCIDO']);
const requiredText = (label: string) => z.string().transform(normalizeText).pipe(z.string().min(1, `${label} es obligatorio.`));
const requiredReference = z.string().transform(normalizeProductReference).pipe(z.string().min(1, 'Referencia es obligatoria.'));
const optionalText = z.union([z.string(), z.null(), z.undefined()]).transform((value) => normalizeText(value) || null);
const moneyValue = z.union([z.string(), z.number()]);
const optionalMoneyValue = z.union([z.string(), z.number(), z.null(), z.undefined()]);

const productFieldsSchema = z.object({
  brand: requiredText('Marca'),
  model: requiredText('Modelo'),
  reference: requiredReference,
  colorway: optionalText,
  type: productType
});

const variantFieldsSchema = z.object({
  size: requiredText('Talla'),
  sizeSystem,
  quantity: z.coerce.number().int('Cantidad debe ser un número entero.').positive('Cantidad debe ser mayor que cero.'),
  pvp: moneyValue,
  offer: optionalMoneyValue,
  cost: moneyValue,
  barcode: z.union([z.string(), z.number(), z.null(), z.undefined()]),
  location: requiredText('Ubicación'),
  gender: gender.default('DESCONOCIDO'),
  ageGroup: ageGroup.default('DESCONOCIDO')
});

export const createProductPayloadSchema = productFieldsSchema.extend({
  variants: z.array(variantFieldsSchema).min(1, 'Añade al menos una talla.')
});

export const addVariantsPayloadSchema = z.object({
  variants: z.array(variantFieldsSchema).min(1, 'Añade al menos una talla.')
});

export const updateProductPayloadSchema = productFieldsSchema;

export const updateVariantPayloadSchema = z.object({
  size: requiredText('Talla'),
  sizeSystem,
  pvp: moneyValue,
  offer: optionalMoneyValue,
  barcode: z.union([z.string(), z.number(), z.null(), z.undefined()]),
  gender: gender.default('DESCONOCIDO'),
  ageGroup: ageGroup.default('DESCONOCIDO')
});

export const stockAdjustmentPayloadSchema = z.object({
  locationId: z.uuid('Ubicación no válida.'),
  reason: z.enum(['VENTA', 'COMPRA', 'AJUSTE', 'DEVOLUCION']),
  delta: z.coerce.number().int('El cambio debe ser un número entero.').refine((value) => value !== 0, 'El cambio no puede ser cero.')
}).superRefine((value, context) => {
  if (value.reason === 'VENTA' && value.delta > 0) context.addIssue({ code: 'custom', path: ['delta'], message: 'Una venta debe reducir el stock.' });
  if ((value.reason === 'COMPRA' || value.reason === 'DEVOLUCION') && value.delta < 0) {
    context.addIssue({ code: 'custom', path: ['delta'], message: 'Esta operación debe aumentar el stock.' });
  }
});

export const archivePayloadSchema = z.object({ force: z.boolean().default(false) });

function cents(value: string | number, field: string): number {
  const parsed = moneyToCents(value, field);
  if (parsed === null || parsed < 0) {
    throw new InventoryError(`${field} debe ser mayor o igual que cero.`, 'VALIDACION', 400);
  }
  return parsed;
}

function optionalCents(value: string | number | null | undefined, field: string): number | null {
  if (value === null || value === undefined || normalizeText(value) === '') return null;
  return cents(value, field);
}

function parsedVariant(value: z.infer<typeof variantFieldsSchema>): VariantFieldsInput {
  return {
    size: value.size,
    sizeSystem: value.sizeSystem,
    quantity: value.quantity,
    pvpCents: cents(value.pvp, 'PVP'),
    offerCents: optionalCents(value.offer, 'Precio oferta'),
    costCents: cents(value.cost, 'Coste'),
    barcode: barcodeToString(value.barcode),
    location: value.location,
    gender: value.gender,
    ageGroup: value.ageGroup
  };
}

export function parseCreateProductPayload(value: unknown): CreateProductInput {
  const parsed = createProductPayloadSchema.parse(value);
  return { ...parsed, variants: parsed.variants.map(parsedVariant) };
}

export function parseAddVariantsPayload(value: unknown): VariantFieldsInput[] {
  return addVariantsPayloadSchema.parse(value).variants.map(parsedVariant);
}

export function parseUpdateProductPayload(value: unknown): ProductFieldsInput {
  return updateProductPayloadSchema.parse(value);
}

export function parseUpdateVariantPayload(value: unknown) {
  const parsed = updateVariantPayloadSchema.parse(value);
  return {
    size: parsed.size,
    sizeSystem: parsed.sizeSystem,
    pvpCents: cents(parsed.pvp, 'PVP'),
    offerCents: optionalCents(parsed.offer, 'Precio oferta'),
    barcode: barcodeToString(parsed.barcode),
    gender: parsed.gender,
    ageGroup: parsed.ageGroup
  };
}
