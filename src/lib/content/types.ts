import type { InventoryProductDetail, InventoryVariantDetail, ProductType } from '../inventory/types.ts';

export const PUBLICATION_TEXT_FIELDS = [
  'tituloComercial',
  'descripcionCompleta',
  'seoTitle',
  'metaDescription'
] as const;

export type PublicationTextField = (typeof PUBLICATION_TEXT_FIELDS)[number];

export interface PublicationTexts {
  tituloComercial: string;
  descripcionCompleta: string;
  caracteristicasTecnicas: string;
  historiaDatoCurioso: string;
  seoTitle: string;
  metaDescription: string;
}

export interface ContentImageMetadata {
  angle?: string;
  role?: ContentReferenceRole;
  quality?: ImageQuality;
  model?: string;
  generationId?: string;
  generatedAt?: string;
  durationMs?: number;
  [key: string]: unknown;
}

export interface ContentImageAsset {
  id: string;
  url: string;
  mimeType: string;
  alt: string | null;
  position: number;
  origin: 'ORIGINAL' | 'IMPORTADO' | 'GENERADO_IA' | 'MANUAL';
  state: string;
  createdAtMs: number;
  width: number | null;
  height: number | null;
  metadata: ContentImageMetadata;
}

export const CONTENT_REFERENCE_ROLES = ['REFERENCIA_LATERAL', 'REFERENCIA_TRASERA'] as const;
export type ContentReferenceRole = (typeof CONTENT_REFERENCE_ROLES)[number];

export interface ProductContentLibrary {
  id: string;
  productId: string;
  locale: string;
  version: number;
  state: string;
  texts: PublicationTexts;
  hasTexts: boolean;
  images: ContentImageAsset[];
  references: ContentImageAsset[];
  generator: string | null;
  generatorVersion: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ContentVariant extends InventoryVariantDetail {
  footLengthMm: number | null;
  sizeEquivalences: Record<string, string>;
}

export interface PublicationProduct extends Omit<InventoryProductDetail, 'variants'> {
  subtype: string | null;
  variants: ContentVariant[];
}

export type SupportedPublicationProductType = Extract<ProductType, 'CALZADO' | 'ROPA'>;
export type ImageQuality = 'RAPIDA' | 'ESTANDAR' | 'PREMIUM';
export type ImageWriteMode = 'APPEND' | 'REPLACE';

export interface ImageGenerationRequest {
  quantity: number;
  angles: string[];
  quality: ImageQuality;
  mode: ImageWriteMode;
}

export interface ImageReferenceInput {
  role: ContentReferenceRole;
  dataUrl: string;
}

export interface GeneratedImage {
  bytes: Uint8Array;
  mimeType: 'image/webp';
  angle: string;
  quality: ImageQuality;
  model: string;
  durationMs: number;
  providerId: string | null;
  promptHash: string;
}

export interface StoredGeneratedImage extends Omit<GeneratedImage, 'bytes'> {
  url: string;
  pathname: string;
  hash: string;
}

export interface StoredContentReference {
  url: string;
  pathname: string;
  hash: string;
  mimeType: string;
  role: ContentReferenceRole;
  originalName: string;
}

export interface ContentImageResource {
  id: string;
  storageUri: string;
  mimeType: string;
  brand: string;
  model: string;
  reference: string;
  angle: string | null;
  role: ContentReferenceRole | null;
}

export type ImageFailureStage = 'OPENAI' | 'DECODE' | 'BLOB' | 'RESOURCE';

export interface ImageGenerationFailure {
  angle: string;
  stage: ImageFailureStage;
  message: string;
}

export interface GeneratedImageBatch {
  images: GeneratedImage[];
  failures: ImageGenerationFailure[];
}

export interface ImageSaveSummary {
  requested: number;
  generated: number;
  saved: number;
  failed: number;
  failedAngles: string[];
  failures: ImageGenerationFailure[];
  message: string;
}

export interface ImageGenerationResult {
  content: ProductContentLibrary;
  summary: ImageSaveSummary;
}

export interface PublicSizeFact {
  label: string;
  size: string;
  sizeSystem: string;
  footLengthCm: number | null;
  quantity: number;
  gender: InventoryVariantDetail['gender'];
}
