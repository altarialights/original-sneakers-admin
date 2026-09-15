import type { ContentImageAsset, ProductContentLibrary } from './types.ts';

function publicAsset(asset: ContentImageAsset): Record<string, unknown> {
  return {
    id: asset.id,
    resourceType: 'IMAGEN',
    mimeType: asset.mimeType,
    alt: asset.alt,
    position: asset.position,
    origin: asset.origin,
    state: asset.state,
    createdAt: new Date(asset.createdAtMs).toISOString(),
    width: asset.width,
    height: asset.height,
    viewUrl: `/api/content/assets/${encodeURIComponent(asset.id)}`,
    metadata: {
      angle: asset.metadata.angle ?? null,
      role: asset.metadata.role ?? null,
      quality: asset.metadata.quality ?? null
    }
  };
}

/** Respuesta para navegador: no incluye URI ni pathname privados de Blob. */
export function publicContentPayload(content: ProductContentLibrary): Record<string, unknown> {
  return {
    id: content.id,
    productId: content.productId,
    locale: content.locale,
    version: content.version,
    state: content.state,
    texts: content.texts,
    hasTexts: content.hasTexts,
    images: content.images.map(publicAsset),
    references: content.references.map(publicAsset),
    generator: content.generator,
    generatorVersion: content.generatorVersion,
    createdAt: new Date(content.createdAtMs).toISOString(),
    updatedAt: new Date(content.updatedAtMs).toISOString()
  };
}
