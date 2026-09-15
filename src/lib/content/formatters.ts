import type { ContentImageResource, PublicationProduct, PublicSizeFact } from './types.ts';

function sizeFact(product: PublicationProduct, variant: PublicationProduct['variants'][number]): PublicSizeFact {
  if (product.type !== 'CALZADO') {
    return {
      label: `${variant.size} ${variant.sizeSystem}`,
      size: variant.size,
      sizeSystem: variant.sizeSystem,
      footLengthCm: null,
      quantity: variant.quantity,
      gender: variant.gender
    };
  }
  const confirmedEu = variant.sizeEquivalences.EU?.trim().replace(',', '.')
    || (variant.sizeSystem === 'EU' ? variant.size : null);
  const confirmedCm = variant.sizeEquivalences.CM?.trim().replace(',', '.')
    || (variant.footLengthMm === null ? null : String(variant.footLengthMm / 10));
  const size = confirmedEu ?? variant.size;
  const sizeSystem = confirmedEu ? 'EU' : variant.sizeSystem;
  const parsedCm = confirmedCm === null ? null : Number(confirmedCm);
  const footLengthCm = Number.isFinite(parsedCm) ? parsedCm : null;
  return {
    label: `${size} ${sizeSystem}${footLengthCm === null || sizeSystem === 'CM' ? '' : ` · ${footLengthCm} cm`}`,
    size,
    sizeSystem,
    footLengthCm,
    quantity: variant.quantity,
    gender: variant.gender
  };
}

/** Solo usa equivalencias confirmadas guardadas para la variante; nunca tablas genéricas. */
export function publicSizeFacts(product: PublicationProduct): PublicSizeFact[] {
  const grouped = new Map<string, PublicSizeFact>();
  for (const fact of product.variants.map((variant) => sizeFact(product, variant))) {
    const key = `${fact.label}|${fact.gender}`;
    const previous = grouped.get(key);
    grouped.set(key, previous ? { ...previous, quantity: previous.quantity + fact.quantity } : fact);
  }
  return [...grouped.values()];
}

export function filenameSlug(value: string): string {
  return value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'imagen-producto';
}

export function contentImageFilename(resource: ContentImageResource): string {
  const view = resource.angle
    ?? (resource.role === 'REFERENCIA_LATERAL' ? 'referencia-lateral' : resource.role === 'REFERENCIA_TRASERA' ? 'referencia-trasera' : 'imagen');
  const extension = resource.mimeType === 'image/jpeg' ? 'jpg'
    : resource.mimeType === 'image/png' ? 'png'
      : resource.mimeType === 'image/avif' ? 'avif' : 'webp';
  return `${filenameSlug(`${resource.brand}-${resource.model}-${view}`)}.${extension}`;
}
