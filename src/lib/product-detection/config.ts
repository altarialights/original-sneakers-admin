export const PRODUCT_KINDS = ['CALZADO', 'ROPA'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const SOURCE_DATA_IMAGE_KINDS_BY_PRODUCT = {
  CALZADO: ['caja', 'ticket', 'etiqueta'] as const,
  ROPA: ['etiquetaRopa', 'ticket', 'prendaCompleta'] as const
};
export const GENERATION_REFERENCE_IMAGE_KINDS_BY_PRODUCT = {
  CALZADO: ['referenciaLateral', 'referenciaTrasera'] as const,
  ROPA: ['referenciaFrontal', 'referenciaTrasera'] as const
};
export const SOURCE_DATA_IMAGE_KINDS = ['caja', 'ticket', 'etiqueta', 'etiquetaRopa', 'prendaCompleta'] as const;
export const GENERATION_REFERENCE_IMAGE_KINDS = ['referenciaLateral', 'referenciaFrontal', 'referenciaTrasera'] as const;
export const PRODUCT_IMAGE_KINDS = [...SOURCE_DATA_IMAGE_KINDS, ...GENERATION_REFERENCE_IMAGE_KINDS] as const;

export type SourceDataImageKind = (typeof SOURCE_DATA_IMAGE_KINDS)[number];
export type GenerationReferenceImageKind = (typeof GENERATION_REFERENCE_IMAGE_KINDS)[number];
export type ProductImageKind = (typeof PRODUCT_IMAGE_KINDS)[number];

export function sourceDataImageKinds(productKind: ProductKind): readonly SourceDataImageKind[] {
  return SOURCE_DATA_IMAGE_KINDS_BY_PRODUCT[productKind];
}
export function generationReferenceImageKinds(productKind: ProductKind): readonly GenerationReferenceImageKind[] {
  return GENERATION_REFERENCE_IMAGE_KINDS_BY_PRODUCT[productKind];
}
export function productImageKindBelongsTo(productKind: ProductKind, kind: ProductImageKind): boolean {
  return sourceDataImageKinds(productKind).some((candidate) => candidate === kind)
    || generationReferenceImageKinds(productKind).some((candidate) => candidate === kind);
}

export const PRODUCT_IMAGE_LABELS: Record<ProductImageKind, string> = {
  caja: 'CAJA', ticket: 'TICKET', etiqueta: 'ETIQUETA DE LA ZAPATILLA',
  etiquetaRopa: 'ETIQUETA DE LA PRENDA', prendaCompleta: 'FOTO COMPLETA DE LA PRENDA',
  referenciaLateral: 'REFERENCIA VISUAL: PERFIL LATERAL', referenciaFrontal: 'REFERENCIA VISUAL: FRONTAL COMPLETO',
  referenciaTrasera: 'REFERENCIA VISUAL: VISTA TRASERA'
};
export const PRODUCT_IMAGE_PATH_SEGMENTS: Record<ProductImageKind, string> = {
  caja: 'caja', ticket: 'ticket', etiqueta: 'etiqueta-zapatilla', etiquetaRopa: 'etiqueta-prenda',
  prendaCompleta: 'prenda-completa', referenciaLateral: 'referencia-lateral',
  referenciaFrontal: 'referencia-frontal', referenciaTrasera: 'referencia-trasera'
};

export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const TEMPORARY_UPLOAD_PREFIX = 'altas-temporales';
export const DEFAULT_OPENAI_VISION_MODEL = 'gpt-5.4-mini';
export const OPENAI_TIMEOUT_MS = 180_000;
export type OpenAIImageDetail = 'auto' | 'high';
export const OPENAI_IMAGE_DETAIL_BY_KIND: Record<SourceDataImageKind, OpenAIImageDetail> = {
  caja: 'high',
  ticket: 'high',
  etiqueta: 'high',
  etiquetaRopa: 'high',
  prendaCompleta: 'high'
};

export type OpenAIReasoningEffort = 'none' | 'minimal';
export function reasoningEffortForVisionModel(model: string): OpenAIReasoningEffort | undefined {
  if (/^gpt-5\.4-(?:mini|nano)(?:-|$)/.test(model)) return 'none';
  if (/^gpt-5(?:-(?:mini|nano))?(?:-|$)/.test(model)) return 'minimal';
  return undefined;
}

interface OpenAIModelTokenPrice {
  input: number;
  cachedInput: number;
  output: number;
}

// Diagnóstico local en USD por millón de tokens. Revisar cuando cambie el tarifario oficial.
const OPENAI_MODEL_TOKEN_PRICES: Readonly<Record<string, OpenAIModelTokenPrice>> = {
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, cachedInput: 0.02, output: 1.25 }
};

export function estimateOpenAIRequestCostUsd(
  model: string,
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number }
): number | null {
  const price = OPENAI_MODEL_TOKEN_PRICES[model];
  if (!price) return null;
  const cachedInputTokens = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const uncachedInputTokens = usage.inputTokens - cachedInputTokens;
  return (
    uncachedInputTokens * price.input
    + cachedInputTokens * price.cachedInput
    + usage.outputTokens * price.output
  ) / 1_000_000;
}
export const MIME_EXTENSION: Record<AllowedImageMimeType, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'
};
