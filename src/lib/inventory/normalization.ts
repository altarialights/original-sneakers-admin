export {
  barcodeToString,
  hasValidGtinCheckDigit,
  inspectGtin,
  moneyToCents,
  normalizeGtin,
  normalizeKey,
  normalizeProductReference,
  normalizeReferenceForComparison,
  normalizeText,
  parseSize
} from '../../../scripts/stock-import/core.ts';

import { normalizeKey, normalizeProductReference, normalizeText } from '../../../scripts/stock-import/core.ts';

export function canonicalProductKey(input: {
  brand: unknown;
  model: unknown;
  reference: unknown;
  colorway: unknown;
}): string {
  return JSON.stringify([
    normalizeKey(input.brand),
    normalizeKey(input.model),
    normalizeKey(normalizeProductReference(input.reference)),
    normalizeKey(input.colorway)
  ]);
}

export function locationCode(value: unknown): string {
  return normalizeKey(value).replace(/[^A-Z0-9]+/g, '_');
}

export function variantSignature(sizeSystem: string, size: unknown): string {
  const normalizedSize = normalizeText(size).replace(/(?<=\d),(?=\d)/g, '.');
  return JSON.stringify({ sistema_talla: sizeSystem, talla: normalizedSize });
}
