import type { Client } from '@libsql/client';
import { z } from 'zod';
import { deleteGeneratedContentImages, readContentImageDataUrl, uploadContentReference, uploadGeneratedContentImage } from './blob.ts';
import { ContentError } from './errors.ts';
import { archiveContentReferenceRecord, saveContentReferenceRecord, saveGeneratedImageRecord, savePublicationTexts } from './mutations.ts';
import { generatePublicationImagesWithOpenAI, generatePublicationTextsWithOpenAI } from './openai.ts';
import { getProductContent, getPublicationProduct } from './queries.ts';
import { assertAnglesForProduct, imageGenerationRequestSchema, publicationTextsSchema } from './schemas.ts';
import { CONTENT_REFERENCE_ROLES, PUBLICATION_TEXT_FIELDS } from './types.ts';
import type {
  GeneratedImage,
  GeneratedImageBatch,
  ContentReferenceRole,
  ImageGenerationFailure,
  ImageGenerationResult,
  ImageGenerationRequest,
  ImageReferenceInput,
  ProductContentLibrary,
  PublicationProduct,
  PublicationTextField,
  PublicationTexts,
  StoredContentReference,
  StoredGeneratedImage
} from './types.ts';

export function assertProductId(value: unknown): string {
  return z.uuid('El identificador del producto no es válido.').parse(value);
}

async function requireSupportedProduct(productId: string, database?: Client): Promise<PublicationProduct> {
  const product = await getPublicationProduct(productId, database);
  if (!product) throw new ContentError('El producto no existe.', 'PRODUCTO_NO_ENCONTRADO', 404);
  if (product.type !== 'CALZADO' && product.type !== 'ROPA') {
    throw new ContentError('La preparación de contenido solo está disponible para calzado y ropa.', 'TIPO_NO_SOPORTADO', 422);
  }
  return product;
}

async function readableReferences(
  library: ProductContentLibrary | null,
  reader: (url: string) => Promise<string>
): Promise<string[]> {
  if (!library) return [];
  const references: string[] = [];
  for (const image of library.images.slice(0, 3)) {
    try {
      references.push(await reader(image.url));
    } catch {
      console.warn(`[content-images] reference:unavailable assetId=${image.id}`);
    }
  }
  return references;
}

async function generationReferences(
  product: PublicationProduct,
  library: ProductContentLibrary | null,
  reader: (url: string) => Promise<string>
): Promise<ImageReferenceInput[]> {
  if (product.type !== 'CALZADO') return [];
  const lateral = library?.references.find((asset) => asset.metadata.role === 'REFERENCIA_LATERAL');
  const rear = library?.references.find((asset) => asset.metadata.role === 'REFERENCIA_TRASERA');
  if (!lateral || !rear) {
    throw new ContentError('No podemos generar imágenes de calzado sin las referencias visuales lateral y trasera.', 'REFERENCIAS_REQUERIDAS', 422);
  }
  const references: ImageReferenceInput[] = [];
  for (const asset of [lateral, rear]) {
    try {
      references.push({ role: asset.metadata.role as ContentReferenceRole, dataUrl: await reader(asset.url) });
    } catch {
      throw new ContentError('No pudimos leer una de las referencias visuales. Sustitúyela antes de generar.', 'REFERENCIA_NO_DISPONIBLE', 422);
    }
  }
  return references;
}

export async function generateAndSaveProductImages(
  productIdInput: unknown,
  requestInput: unknown,
  dependencies: {
    database?: Client;
    generator?: (product: PublicationProduct, request: ImageGenerationRequest, references: ImageReferenceInput[]) => Promise<GeneratedImageBatch | GeneratedImage[]>;
    uploader?: (productId: string, image: GeneratedImage) => Promise<StoredGeneratedImage>;
    referenceReader?: (url: string) => Promise<string>;
    cleanup?: (pathnames: string[]) => Promise<void>;
    recordSaver?: (productId: string, image: StoredGeneratedImage, request: ImageGenerationRequest, replaceExisting: boolean, database?: Client) => Promise<string>;
  } = {}
): Promise<ImageGenerationResult> {
  const productId = assertProductId(productIdInput);
  const request = imageGenerationRequestSchema.parse(requestInput);
  const product = await requireSupportedProduct(productId, dependencies.database);
  assertAnglesForProduct(product.type, request.angles);
  const before = await getProductContent(productId, dependencies.database);
  const references = await generationReferences(product, before, dependencies.referenceReader ?? readContentImageDataUrl);
  const generatedResult = await (dependencies.generator ?? generatePublicationImagesWithOpenAI)(product, request, references);
  const batch: GeneratedImageBatch = Array.isArray(generatedResult)
    ? { images: generatedResult, failures: [] }
    : generatedResult;
  const failures: ImageGenerationFailure[] = [...batch.failures];
  let saved = 0;
  for (const image of batch.images) {
    let stored: StoredGeneratedImage;
    try {
      stored = await (dependencies.uploader ?? uploadGeneratedContentImage)(productId, image);
    } catch (error) {
      const message = error instanceof ContentError
        ? error.message
        : 'No se pudo guardar esta imagen en Blob. Puedes reintentar solo esta vista.';
      failures.push({ angle: image.angle, stage: 'BLOB', message });
      console.error(`[content-images] generate:failed stage=BLOB angle=${image.angle} code=${error instanceof ContentError ? error.code : 'BLOB_ERROR'}`);
      continue;
    }
    try {
      await (dependencies.recordSaver ?? saveGeneratedImageRecord)(
        productId,
        stored,
        request,
        request.mode === 'REPLACE' && saved === 0,
        dependencies.database
      );
      saved += 1;
    } catch (error) {
      await (dependencies.cleanup ?? deleteGeneratedContentImages)([stored.pathname]);
      const message = error instanceof ContentError
        ? error.message
        : 'La imagen llegó a Blob, pero no se pudo asociar a la biblioteca. Puedes reintentar solo esta vista.';
      failures.push({ angle: image.angle, stage: 'RESOURCE', message });
      console.error(`[content-images] generate:failed stage=RESOURCE angle=${image.angle} code=${error instanceof ContentError ? error.code : 'RESOURCE_ERROR'}`);
    }
  }
  if (saved === 0) {
    const detail = failures[0]?.message ?? 'No se recibió ninguna imagen utilizable.';
    console.error(`[content-images] generate:failed requested=${request.quantity} generated=${batch.images.length} saved=0 failed=${failures.length}`);
    throw new ContentError(`No se pudo guardar ninguna imagen. ${detail}`, 'IMAGENES_NO_GUARDADAS', 502);
  }
  const content = await getProductContent(productId, dependencies.database);
  if (!content) throw new ContentError('Las imágenes se guardaron, pero no pudimos volver a cargar la biblioteca.', 'CONTENIDO_NO_DISPONIBLE', 500);
  const failed = Math.max(request.quantity - saved, failures.length);
  const summary = {
    requested: request.quantity,
    generated: batch.images.length,
    saved,
    failed,
    failedAngles: failures.map((failure) => failure.angle),
    failures,
    message: failed > 0
      ? `${saved} de ${request.quantity} imágenes preparadas. Puedes reintentar únicamente las ${failed} vistas fallidas.`
      : `${saved} ${saved === 1 ? 'imagen preparada' : 'imágenes preparadas'}.`
  };
  console.info(`[content-images] generate:completed requested=${request.quantity} generated=${batch.images.length} saved=${saved} failed=${failed}`);
  return { content, summary };
}

const MAX_REFERENCE_UPLOAD_BYTES = 10 * 1024 * 1024;
const REFERENCE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface ReferenceFileInput {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function hasReferenceSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/webp') return Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP';
  return false;
}

export async function validateContentReferenceFile(file: ReferenceFileInput): Promise<{ bytes: Uint8Array; mimeType: string; originalName: string }> {
  const mimeType = file.type.toLowerCase().split(';')[0];
  if (!REFERENCE_MIME_TYPES.has(mimeType)) throw new ContentError('Usa una imagen JPG, PNG o WebP.', 'REFERENCIA_FORMATO', 415);
  if (file.size <= 0 || file.size > MAX_REFERENCE_UPLOAD_BYTES) throw new ContentError('La referencia debe pesar menos de 10 MB.', 'REFERENCIA_TAMANO', 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || !hasReferenceSignature(bytes, mimeType)) {
    throw new ContentError('El archivo no contiene una imagen válida.', 'REFERENCIA_CONTENIDO', 422);
  }
  return { bytes, mimeType, originalName: file.name.slice(0, 180) || 'referencia' };
}

export async function saveProductContentReference(
  productIdInput: unknown,
  roleInput: unknown,
  file: ReferenceFileInput,
  dependencies: {
    database?: Client;
    uploader?: (productId: string, role: ContentReferenceRole, bytes: Uint8Array, mimeType: string, originalName: string) => Promise<StoredContentReference>;
    cleanup?: (uris: string[]) => Promise<void>;
  } = {}
): Promise<ProductContentLibrary> {
  const productId = assertProductId(productIdInput);
  const role = z.enum(CONTENT_REFERENCE_ROLES).parse(roleInput);
  const product = await requireSupportedProduct(productId, dependencies.database);
  if (product.type !== 'CALZADO') throw new ContentError('Las referencias lateral y trasera solo se solicitan para calzado.', 'REFERENCIA_TIPO', 422);
  const validated = await validateContentReferenceFile(file);
  const stored = await (dependencies.uploader ?? uploadContentReference)(productId, role, validated.bytes, validated.mimeType, validated.originalName);
  let replacedUris: string[];
  try {
    const saved = await saveContentReferenceRecord(productId, stored, dependencies.database);
    replacedUris = saved.replacedUris;
  } catch (error) {
    await (dependencies.cleanup ?? deleteGeneratedContentImages)([stored.pathname]);
    throw error;
  }
  try {
    await (dependencies.cleanup ?? deleteGeneratedContentImages)(replacedUris);
  } catch {
    console.warn(`[content-images] reference:cleanup-failed role=${role} count=${replacedUris.length}`);
  }
  const content = await getProductContent(productId, dependencies.database);
  if (!content) throw new ContentError('La referencia se guardó, pero no pudimos recargarla.', 'CONTENIDO_NO_DISPONIBLE', 500);
  return content;
}

export async function removeProductContentReference(
  productIdInput: unknown,
  roleInput: unknown,
  dependencies: { database?: Client; cleanup?: (uris: string[]) => Promise<void> } = {}
): Promise<ProductContentLibrary> {
  const productId = assertProductId(productIdInput);
  const role = z.enum(CONTENT_REFERENCE_ROLES).parse(roleInput);
  const product = await requireSupportedProduct(productId, dependencies.database);
  if (product.type !== 'CALZADO') throw new ContentError('Este producto no utiliza referencias de calzado.', 'REFERENCIA_TIPO', 422);
  const uris = await archiveContentReferenceRecord(productId, role, dependencies.database);
  try {
    await (dependencies.cleanup ?? deleteGeneratedContentImages)(uris);
  } catch {
    console.warn(`[content-images] reference:cleanup-failed role=${role} count=${uris.length}`);
  }
  const content = await getProductContent(productId, dependencies.database);
  if (!content) throw new ContentError('No pudimos recargar la biblioteca.', 'CONTENIDO_NO_DISPONIBLE', 500);
  return content;
}

export async function generateAndSaveProductTexts(
  productIdInput: unknown,
  field: PublicationTextField | null = null,
  dependencies: {
    database?: Client;
    generator?: (
      product: PublicationProduct,
      fields: PublicationTextField[],
      references: string[]
    ) => Promise<{ texts: Partial<PublicationTexts>; model: string; promptHash: string }>;
    referenceReader?: (url: string) => Promise<string>;
  } = {}
): Promise<ProductContentLibrary> {
  const productId = assertProductId(productIdInput);
  const product = await requireSupportedProduct(productId, dependencies.database);
  const before = await getProductContent(productId, dependencies.database);
  const references = await readableReferences(
    before ? { ...before, images: [...before.references, ...before.images] } : null,
    dependencies.referenceReader ?? readContentImageDataUrl
  );
  const fields: PublicationTextField[] = field ? [field] : [...PUBLICATION_TEXT_FIELDS];
  const result = await (dependencies.generator ?? generatePublicationTextsWithOpenAI)(product, fields, references);
  await savePublicationTexts(productId, result.texts, {
    model: result.model,
    promptHash: result.promptHash,
    generated: true
  }, dependencies.database);
  const content = await getProductContent(productId, dependencies.database);
  if (!content) throw new ContentError('Los textos se guardaron, pero no pudimos volver a cargar la biblioteca.', 'CONTENIDO_NO_DISPONIBLE', 500);
  return content;
}

export async function saveManualProductTexts(
  productIdInput: unknown,
  textsInput: unknown,
  database?: Client
): Promise<ProductContentLibrary> {
  const productId = assertProductId(productIdInput);
  await requireSupportedProduct(productId, database);
  const texts = publicationTextsSchema.parse(textsInput);
  await savePublicationTexts(productId, texts, { generated: false }, database);
  const content = await getProductContent(productId, database);
  if (!content) throw new ContentError('Los cambios se guardaron, pero no pudimos volver a cargar la biblioteca.', 'CONTENIDO_NO_DISPONIBLE', 500);
  return content;
}
