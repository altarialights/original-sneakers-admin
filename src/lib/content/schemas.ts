import { z } from 'zod';
import { PUBLICATION_TEXT_FIELDS } from './types.ts';

const editableText = z.string().trim().max(12_000, 'El texto es demasiado largo.');

export const publicationTextsSchema = z.object({
  tituloComercial: editableText.max(180, 'El título es demasiado largo.'),
  descripcionCompleta: editableText,
  seoTitle: editableText.max(180, 'El SEO title es demasiado largo.'),
  metaDescription: editableText.max(500, 'La meta description es demasiado larga.')
});

export const generateTextsRequestSchema = z.object({
  field: z.enum(PUBLICATION_TEXT_FIELDS).nullable().optional()
});

export const imageGenerationRequestSchema = z.object({
  quantity: z.coerce.number().int('La cantidad debe ser un número entero.').min(1, 'Genera al menos una imagen.').max(8, 'Puedes generar como máximo 8 imágenes cada vez.'),
  angles: z.array(z.string().trim().min(1)).min(1, 'Selecciona al menos un ángulo.').max(8),
  quality: z.enum(['RAPIDA', 'ESTANDAR', 'PREMIUM']),
  mode: z.enum(['APPEND', 'REPLACE'])
});

export const FOOTWEAR_ANGLES = [
  'lateral-exterior', 'lateral-interior', 'frontal', 'trasera', 'superior',
  'tres-cuartos', 'suela', 'detalle-logo-etiqueta-air-unit'
] as const;

export const CLOTHING_ANGLES = [
  'frontal', 'trasera', 'detalle-pecho-logo', 'detalle-etiqueta',
  'prenda-completa-fondo-limpio', 'detalle-tejido-manga-estampado'
] as const;

export function allowedAnglesFor(type: string): readonly string[] {
  return type === 'ROPA' ? CLOTHING_ANGLES : FOOTWEAR_ANGLES;
}

export function assertAnglesForProduct(type: string, angles: string[]): void {
  const allowed = new Set(allowedAnglesFor(type));
  if (angles.some((angle) => !allowed.has(angle))) {
    throw new z.ZodError([{ code: 'custom', path: ['angles'], message: 'Hay un ángulo que no corresponde a este tipo de producto.' }]);
  }
}
