import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createClient, type Client } from '@libsql/client';
import type OpenAI from 'openai';
import { createProduct } from '../src/lib/inventory/mutations.ts';
import { getProductDetail } from '../src/lib/inventory/queries.ts';
import { uuidV7 } from '../src/lib/inventory/ids.ts';
import { getContentImageResource, getProductContent, getPublicationProduct } from '../src/lib/content/queries.ts';
import { decodeGeneratedImageAsset, generatePublicationImagesWithOpenAI, generatePublicationTextsWithOpenAI, IMAGE_GENERATION_CONCURRENCY } from '../src/lib/content/openai.ts';
import { streamPrivateContentImage, uploadGeneratedContentImage } from '../src/lib/content/blob.ts';
import { contentImageFilename, publicSizeFacts } from '../src/lib/content/formatters.ts';
import { publicContentPayload } from '../src/lib/content/presentation.ts';
import { saveContentReferenceRecord } from '../src/lib/content/mutations.ts';
import {
  generateAndSaveProductImages,
  generateAndSaveProductTexts,
  saveProductContentReference,
  saveManualProductTexts
} from '../src/lib/content/service.ts';
import type {
  ContentReferenceRole,
  GeneratedImage,
  ImageGenerationRequest,
  PublicationProduct,
  PublicationTextField,
  PublicationTexts
} from '../src/lib/content/types.ts';
import { PUBLICATION_TEXT_FIELDS } from '../src/lib/content/types.ts';

interface TestDatabase { client: Client; }

let databasePromise: Promise<TestDatabase> | undefined;
let productSequence = 0;

async function createTestDatabase(): Promise<TestDatabase> {
  databasePromise ??= (async () => {
    const client = createClient({ url: 'file::memory:?cache=shared', intMode: 'number' });
    await client.executeMultiple(await readFile(new URL('../migrations/001_inicial.sql', import.meta.url), 'utf8'));
    await client.executeMultiple(await readFile(new URL('../migrations/002_contenido_editorial.sql', import.meta.url), 'utf8'));
    const now = Date.now();
    await client.execute({
      sql: `INSERT INTO ubicaciones_inventario
            (id, codigo, nombre, tipo, esta_activa, creado_en_ms, actualizado_en_ms)
            VALUES (?, 'TIENDA', 'Tienda', 'TIENDA', 1, ?, ?)`,
      args: [uuidV7(), now, now]
    });
    return { client };
  })();
  return databasePromise;
}

async function usingDatabase(callback: (database: TestDatabase) => Promise<void>): Promise<void> {
  const database = await createTestDatabase();
  await callback(database);
}

async function createTestProduct(client: Client, type: 'CALZADO' | 'ROPA' = 'CALZADO'): Promise<string> {
  productSequence += 1;
  const created = await createProduct({
    brand: 'Nike',
    model: type === 'CALZADO' ? 'Air Max DN8' : 'Air Graphic Tee',
    reference: `${type === 'CALZADO' ? 'II7634' : 'HM0185'}-${String(productSequence).padStart(3, '0')}`,
    colorway: 'Azul',
    type,
    variants: [{
      size: type === 'CALZADO' ? '45' : 'L',
      sizeSystem: type === 'CALZADO' ? 'EU' : 'ALFABETICO',
      quantity: 1,
      pvpCents: 0,
      costCents: 499,
      barcode: null,
      location: 'Tienda',
      gender: 'HOMBRE',
      ageGroup: 'ADULTO'
    }]
  }, client);
  return created.productId;
}

const completeTexts: PublicationTexts = {
  tituloComercial: 'Nike Air Max DN8',
  descripcionCompleta: '👟 Nike Air Max DN8\n\nUna descripción comercial completa y lista para publicar.\n\n📋 CARACTERÍSTICAS TÉCNICAS\n• Color azul\n\n✅ AUTENTICIDAD GARANTIZADA\n• Producto 100 % original Nike\n• Nuevas a estrenar\n\n🚚 ENVÍOS NACIONALES\n• Gratis en pedidos superiores a 59,90€\n• Pedidos inferiores a 59,90€, coste 3,90€\n• Entrega en 48 - 72 horas',
  caracteristicasTecnicas: '• Talla 45 EU\n• Color azul',
  historiaDatoCurioso: 'Una propuesta inspirada en la estética de la familia Air Max.',
  seoTitle: 'Nike Air Max DN8 azul',
  metaDescription: 'Descubre las Nike Air Max DN8 en color azul.'
};

test('consulta producto y biblioteca reales sin inventar contenido vacío', () => usingDatabase(async ({ client }) => {
  const productId = await createTestProduct(client);
  const product = await getPublicationProduct(productId, client);
  assert.match(product?.reference ?? '', /^II7634-/);
  assert.equal(product?.type, 'CALZADO');
  assert.equal(await getProductContent(productId, client), null);
}));

test('guarda los cuatro textos finales sin exigir ni sobrescribir columnas legacy', () => usingDatabase(async ({ client }) => {
  const productId = await createTestProduct(client);
  await client.execute({
    sql: `INSERT INTO biblioteca_contenido
          (id, producto_id, locale, version, estado, caracteristicas_tecnicas, historia_dato_curioso, creado_en_ms, actualizado_en_ms)
          VALUES (?, ?, 'es-ES', 1, 'BORRADOR', 'Legacy técnico', 'Legacy historia', ?, ?)`,
    args: [uuidV7(), productId, Date.now(), Date.now()]
  });
  const editableTexts = {
    tituloComercial: completeTexts.tituloComercial,
    descripcionCompleta: completeTexts.descripcionCompleta,
    seoTitle: completeTexts.seoTitle,
    metaDescription: completeTexts.metaDescription
  };
  const saved = await saveManualProductTexts(productId, editableTexts, client);
  assert.equal(saved.hasTexts, true);
  assert.deepEqual(PUBLICATION_TEXT_FIELDS.map((field) => saved.texts[field]), PUBLICATION_TEXT_FIELDS.map((field) => editableTexts[field]));
  assert.equal(saved.texts.caracteristicasTecnicas, 'Legacy técnico');
  assert.equal(saved.texts.historiaDatoCurioso, 'Legacy historia');
  assert.equal(saved.state, 'BORRADOR');
}));

test('generar textos persiste contenido y regenerar un bloque conserva el resto', () => usingDatabase(async ({ client }) => {
  const productId = await createTestProduct(client);
  const generator = async (
    _product: PublicationProduct,
    fields: PublicationTextField[]
  ): Promise<{ texts: Partial<PublicationTexts>; model: string; promptHash: string }> => ({
    texts: Object.fromEntries(fields.map((field) => [field, completeTexts[field]])),
    model: 'test-text-model',
    promptHash: 'a'.repeat(64)
  });
  const generated = await generateAndSaveProductTexts(productId, null, { database: client, generator });
  assert.deepEqual(PUBLICATION_TEXT_FIELDS.map((field) => generated.texts[field]), PUBLICATION_TEXT_FIELDS.map((field) => completeTexts[field]));
  const regenerated = await generateAndSaveProductTexts(productId, 'descripcionCompleta', {
    database: client,
    generator: async (_product, fields) => ({
      texts: { [fields[0]]: 'Descripción completa regenerada.' },
      model: 'test-text-model',
      promptHash: 'b'.repeat(64)
    })
  });
  assert.equal(regenerated.texts.descripcionCompleta, 'Descripción completa regenerada.');
  assert.equal(regenerated.texts.tituloComercial, completeTexts.tituloComercial);
}));

const webpBytes = Uint8Array.from(Buffer.from('524946460400000057454250', 'hex'));

function fakeReferenceFile(name = 'referencia.webp') {
  return {
    name,
    type: 'image/webp',
    size: webpBytes.byteLength,
    arrayBuffer: async () => webpBytes.buffer.slice(webpBytes.byteOffset, webpBytes.byteOffset + webpBytes.byteLength) as ArrayBuffer
  };
}

async function seedReference(client: Client, productId: string, role: ContentReferenceRole): Promise<void> {
  const name = role === 'REFERENCIA_LATERAL' ? 'lateral' : 'trasera';
  await saveContentReferenceRecord(productId, {
    url: `https://blob.test/referencias/${name}.webp`,
    pathname: `contenido/referencias/${name}.webp`,
    hash: (role === 'REFERENCIA_LATERAL' ? 'd' : 'e').repeat(64),
    mimeType: 'image/webp',
    role,
    originalName: `${name}.webp`
  }, client);
}

async function seedRequiredReferences(client: Client, productId: string): Promise<void> {
  await seedReference(client, productId, 'REFERENCIA_LATERAL');
  await seedReference(client, productId, 'REFERENCIA_TRASERA');
}

function fakeImages(request: ImageGenerationRequest): GeneratedImage[] {
  return Array.from({ length: request.quantity }, (_, index) => ({
    bytes: Uint8Array.from(webpBytes),
    mimeType: 'image/webp',
    angle: request.angles[index % request.angles.length],
    quality: request.quality,
    model: 'test-image-model',
    durationMs: 10,
    providerId: null,
    promptHash: String(index + 1).padStart(64, '0')
  }));
}

test('generar, ampliar y regenerar imágenes conserva assets históricos', () => usingDatabase(async ({ client }) => {
  const productId = await createTestProduct(client);
  await seedRequiredReferences(client, productId);
  let uploaded = 0;
  const dependencies = {
    database: client,
    generator: async (_product: PublicationProduct, request: ImageGenerationRequest) => fakeImages(request),
    uploader: async (_productId: string, image: GeneratedImage) => {
      uploaded += 1;
      return { ...image, url: `https://blob.test/${uploaded}.webp`, pathname: `contenido/${uploaded}.webp`, hash: String(uploaded).padStart(64, '0') };
    },
    referenceReader: async () => 'data:image/webp;base64,AQID',
    cleanup: async () => undefined
  };
  const first = await generateAndSaveProductImages(productId, {
    quantity: 2, angles: ['lateral-exterior', 'trasera'], quality: 'ESTANDAR', mode: 'REPLACE'
  }, dependencies);
  assert.equal(first.content.images.length, 2);
  const appended = await generateAndSaveProductImages(productId, {
    quantity: 1, angles: ['superior'], quality: 'RAPIDA', mode: 'APPEND'
  }, dependencies);
  assert.equal(appended.content.images.length, 3);
  const replaced = await generateAndSaveProductImages(productId, {
    quantity: 1, angles: ['frontal'], quality: 'PREMIUM', mode: 'REPLACE'
  }, dependencies);
  assert.equal(replaced.content.images.length, 1);
  const rows = await client.execute({
    sql: `SELECT r.estado, COUNT(*) AS total
          FROM recursos_contenido r JOIN biblioteca_contenido b ON b.id = r.biblioteca_contenido_id
          WHERE b.producto_id = ? AND r.origen = 'GENERADO_IA' GROUP BY r.estado ORDER BY r.estado`,
    args: [productId]
  });
  assert.deepEqual(rows.rows.map((row) => [row.estado, Number(row.total)]), [['ARCHIVADO', 3], ['REQUIERE_REVISION', 1]]);
  const references = await getProductContent(productId, client);
  assert.equal(references?.references.length, 2);
  const active = await client.execute({
    sql: `SELECT r.mime_type, r.proveedor, r.metadata_generacion_json
          FROM recursos_contenido r JOIN biblioteca_contenido b ON b.id = r.biblioteca_contenido_id
          WHERE b.producto_id = ? AND r.estado = 'REQUIERE_REVISION' LIMIT 1`,
    args: [productId]
  });
  const metadata = JSON.parse(String(active.rows[0].metadata_generacion_json)) as Record<string, unknown>;
  assert.equal(active.rows[0].mime_type, 'image/webp');
  assert.equal(active.rows[0].proveedor, 'OPENAI');
  assert.equal(metadata.model, 'test-image-model');
  assert.equal(metadata.quality, 'PREMIUM');
  assert.equal(metadata.angle, 'frontal');
  assert.match(String(metadata.promptHash), /^[0-9a-f]{64}$/);
  assert.match(String(metadata.blobPathname), /^contenido\//);
  const stockDetail = await getProductDetail(productId, client);
  assert.equal(stockDetail?.images.length, 1);
  assert.match(stockDetail?.images[0] ?? '', /^\/api\/content\/assets\/[0-9a-f-]{36}$/);
  assert.doesNotMatch(stockDetail?.images[0] ?? '', /blob\.test/);
}));

test('valida ángulos por tipo y admite flujo real de ropa', () => usingDatabase(async ({ client }) => {
  const productId = await createTestProduct(client, 'ROPA');
  await assert.rejects(generateAndSaveProductImages(productId, {
    quantity: 1, angles: ['suela'], quality: 'ESTANDAR', mode: 'REPLACE'
  }, {
    database: client,
    generator: async (_product, request) => fakeImages(request),
    uploader: async () => { throw new Error('no debe subir'); }
  }), /no corresponde/);
  const result = await generateAndSaveProductImages(productId, {
    quantity: 1, angles: ['frontal'], quality: 'ESTANDAR', mode: 'REPLACE'
  }, {
    database: client,
    generator: async (_product, request) => fakeImages(request),
    uploader: async (_id, image) => ({ ...image, url: 'https://blob.test/ropa.webp', pathname: 'contenido/ropa.webp', hash: 'c'.repeat(64) }),
    cleanup: async () => undefined
  });
  assert.equal(result.content.images[0].metadata.angle, 'frontal');
}));

test('producto inexistente devuelve un estado controlado', () => usingDatabase(async ({ client }) => {
  await assert.rejects(saveManualProductTexts(uuidV7(), completeTexts, client), /no existe/);
}));

test('OpenAI editorial traduce la calidad y genera una imagen por ángulo sin llamada real', () => usingDatabase(async ({ client }) => {
  const productId = await createTestProduct(client, 'ROPA');
  const product = await getPublicationProduct(productId, client);
  assert.ok(product);
  const calls: Array<Record<string, unknown>> = [];
  const fakeClient = {
    images: {
      generate: async (body: Record<string, unknown>) => {
        calls.push(body);
        return { data: [{ b64_json: Buffer.from(webpBytes).toString('base64') }] };
      }
    }
  } as unknown as OpenAI;
  const images = await generatePublicationImagesWithOpenAI(product, {
    quantity: 2,
    angles: ['frontal', 'trasera'],
    quality: 'PREMIUM',
    mode: 'REPLACE'
  }, [], { client: fakeClient, apiKey: 'test', model: 'test-image-model' });
  assert.equal(images.images.length, 2);
  assert.deepEqual(images.images.map((image) => image.angle), ['frontal', 'trasera']);
  assert.equal(images.failures.length, 0);
  assert.equal(calls[0].quality, 'high');
  assert.equal(calls[0].output_format, 'webp');
}));

test('OpenAI editorial usa el formato estructurado y genera la descripción completa de ropa', () => usingDatabase(async ({ client }) => {
  const productId = await createTestProduct(client, 'ROPA');
  const product = await getPublicationProduct(productId, client);
  assert.ok(product);
  let request: Record<string, unknown> | undefined;
  const fakeClient = {
    responses: {
      parse: async (body: Record<string, unknown>) => {
        request = body;
        return {
          output_parsed: { descripcionCompleta: '👕 Nike Air Graphic Tee\n\nCamiseta Nike nueva y original.\n\n📋 CARACTERÍSTICAS\n• Color azul\n\n✅ AUTENTICIDAD GARANTIZADA\n• Producto 100 % original Nike\n• Nueva a estrenar\n\n🚚 ENVÍOS NACIONALES\n• Gratis en pedidos superiores a 59,90€\n• Pedidos inferiores a 59,90€, coste 3,90€\n• Entrega en 48 - 72 horas' },
          usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 }
        };
      }
    }
  } as unknown as OpenAI;
  const generated = await generatePublicationTextsWithOpenAI(
    product,
    ['descripcionCompleta'],
    ['data:image/webp;base64,AQID'],
    { client: fakeClient, apiKey: 'test', model: 'test-text-model' }
  );
  assert.match(generated.texts.descripcionCompleta ?? '', /📋 CARACTERÍSTICAS/);
  assert.match(JSON.stringify(request), /input_image/);
  assert.doesNotMatch(JSON.stringify(request), /historiaDatoCurioso|caracteristicasTecnicas/);
  assert.match(JSON.stringify(request), /DATO CURIOSO es opcional/);
  assert.doesNotMatch(JSON.stringify(request), /longitudPieCm":\d/);
}));

test('Structured Output editorial completo contiene exactamente los cuatro campos públicos', () => usingDatabase(async ({ client }) => {
  const product = await getPublicationProduct(await createTestProduct(client), client);
  assert.ok(product);
  let request: Record<string, unknown> | undefined;
  const fakeClient = { responses: { parse: async (body: Record<string, unknown>) => {
    request = body;
    return { output_parsed: {
      tituloComercial: completeTexts.tituloComercial,
      descripcionCompleta: completeTexts.descripcionCompleta,
      seoTitle: completeTexts.seoTitle,
      metaDescription: completeTexts.metaDescription
    } };
  } } } as unknown as OpenAI;
  await generatePublicationTextsWithOpenAI(product, [...PUBLICATION_TEXT_FIELDS], [], {
    client: fakeClient, apiKey: 'test', model: 'test-text-model'
  });
  const serialized = JSON.stringify(request);
  for (const field of PUBLICATION_TEXT_FIELDS) assert.match(serialized, new RegExp(field));
  assert.doesNotMatch(serialized, /historiaDatoCurioso|caracteristicasTecnicas/);
}));

test('calzado admite descripción completa sin dato curioso y exige todas las secciones fijas', () => usingDatabase(async ({ client }) => {
  const product = await getPublicationProduct(await createTestProduct(client), client);
  assert.ok(product);
  const validClient = { responses: { parse: async () => ({ output_parsed: { descripcionCompleta: completeTexts.descripcionCompleta } }) } } as unknown as OpenAI;
  const generated = await generatePublicationTextsWithOpenAI(product, ['descripcionCompleta'], [], {
    client: validClient, apiKey: 'test', model: 'test-text-model'
  });
  assert.match(generated.texts.descripcionCompleta ?? '', /📋 CARACTERÍSTICAS TÉCNICAS/);
  assert.match(generated.texts.descripcionCompleta ?? '', /✅ AUTENTICIDAD GARANTIZADA/);
  assert.match(generated.texts.descripcionCompleta ?? '', /🚚 ENVÍOS NACIONALES/);
  assert.doesNotMatch(generated.texts.descripcionCompleta ?? '', /🤓 DATO CURIOSO/);

  const invalidClient = { responses: { parse: async () => ({ output_parsed: {
    descripcionCompleta: `${completeTexts.descripcionCompleta.replace('🚚 ENVÍOS NACIONALES', '')}\n🤓 DATO CURIOSO\n\n🚚 ENVÍOS NACIONALES`
  } }) } } as unknown as OpenAI;
  await assert.rejects(generatePublicationTextsWithOpenAI(product, ['descripcionCompleta'], [], {
    client: invalidClient, apiKey: 'test', model: 'test-text-model'
  }), /estructura editorial completa/);
}));

test('conserva éxitos parciales y permite identificar solo las vistas fallidas', () => usingDatabase(async ({ client }) => {
  const productId = await createTestProduct(client);
  await seedRequiredReferences(client, productId);
  let upload = 0;
  const result = await generateAndSaveProductImages(productId, {
    quantity: 3, angles: ['frontal', 'trasera', 'superior'], quality: 'ESTANDAR', mode: 'REPLACE'
  }, {
    database: client,
    generator: async (_product, request) => fakeImages(request),
    uploader: async (_id, image) => {
      upload += 1;
      if (upload === 2) throw new Error('fallo simulado');
      return { ...image, url: `https://blob.test/${upload}.webp`, pathname: `contenido/${upload}.webp`, hash: String(upload).padStart(64, '0') };
    },
    referenceReader: async () => `data:image/webp;base64,${Buffer.from(webpBytes).toString('base64')}`,
    cleanup: async () => undefined
  });
  assert.equal(result.summary.saved, 2);
  assert.equal(result.summary.failed, 1);
  assert.deepEqual(result.summary.failedAngles, ['trasera']);
  assert.equal(result.content.images.length, 2);
}));

test('Blob de contenido usa WebP privado y un path estable sin llamada real', async () => {
  let capturedPath = '';
  let capturedOptions: Record<string, unknown> = {};
  const uploader = (async (pathname: string, _body: unknown, options: Record<string, unknown>) => {
    capturedPath = pathname;
    capturedOptions = options;
    return { url: `https://store.private.blob.vercel-storage.com/${pathname}`, downloadUrl: '', pathname, contentType: 'image/webp', contentDisposition: 'inline', cacheControl: '', etag: 'test' };
  }) as unknown as typeof import('@vercel/blob').put;
  const image = fakeImages({ quantity: 1, angles: ['frontal'], quality: 'ESTANDAR', mode: 'APPEND' })[0];
  await uploadGeneratedContentImage(uuidV7(), image, { uploader, auth: { oidcToken: 'oidc-test', storeId: 'store-test' } });
  assert.match(capturedPath, /^contenido-productos\/[0-9a-f-]{36}\/generadas\/[0-9a-f-]{36}\.webp$/);
  assert.equal(capturedOptions.access, 'private');
  assert.equal(capturedOptions.contentType, 'image/webp');
});

test('decodifica respuesta URL WebP y rechaza un binario con extensión fingida', async () => {
  const decoded = await decodeGeneratedImageAsset(
    { url: 'https://openai.test/image.webp' },
    async () => new Response(webpBytes, { status: 200, headers: { 'content-type': 'image/webp' } })
  );
  assert.deepEqual(decoded, webpBytes);
  await assert.rejects(
    decodeGeneratedImageAsset(
      { url: 'https://openai.test/image.webp' },
      async () => new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/webp' } })
    ),
    /no llegó en WebP/
  );
});

test('guarda y recupera las dos referencias reales con roles separados', () => usingDatabase(async ({ client }) => {
  const productId = await createTestProduct(client);
  const product = await getPublicationProduct(productId, client);
  assert.ok(product);
  let upload = 0;
  const uploader = async (_productId: string, role: ContentReferenceRole, _bytes: Uint8Array, mimeType: string, originalName: string) => {
    upload += 1;
    return {
      url: `https://blob.test/reference-${upload}.webp`, pathname: `contenido/reference-${upload}.webp`,
      hash: String(upload).padStart(64, '0'), mimeType, role, originalName
    };
  };
  await saveProductContentReference(productId, 'REFERENCIA_LATERAL', fakeReferenceFile('lateral.webp'), { database: client, uploader, cleanup: async () => undefined });
  const content = await saveProductContentReference(productId, 'REFERENCIA_TRASERA', fakeReferenceFile('trasera.webp'), { database: client, uploader, cleanup: async () => undefined });
  assert.deepEqual(content.references.map((asset) => asset.metadata.role).sort(), ['REFERENCIA_LATERAL', 'REFERENCIA_TRASERA']);
  assert.equal(content.images.length, 0);
  const lateral = content.references.find((asset) => asset.metadata.role === 'REFERENCIA_LATERAL');
  assert.ok(lateral);
  const servedResource = await getContentImageResource(lateral.id, client);
  assert.equal(servedResource?.storageUri, 'https://blob.test/reference-1.webp');
  assert.equal(servedResource?.reference, product.reference);
  assert.equal(servedResource?.role, 'REFERENCIA_LATERAL');
}));

test('servidor no llama a OpenAI si falta lateral o trasera en calzado', () => usingDatabase(async ({ client }) => {
  const missingLateralId = await createTestProduct(client);
  await seedReference(client, missingLateralId, 'REFERENCIA_TRASERA');
  const missingRearId = await createTestProduct(client);
  await seedReference(client, missingRearId, 'REFERENCIA_LATERAL');
  let calls = 0;
  const dependencies = {
    database: client,
    generator: async (_product: PublicationProduct, request: ImageGenerationRequest) => { calls += 1; return fakeImages(request); },
    referenceReader: async () => 'data:image/webp;base64,UklGRgQAAABXRUJQ'
  };
  const request = { quantity: 1, angles: ['frontal'], quality: 'ESTANDAR', mode: 'REPLACE' };
  await assert.rejects(generateAndSaveProductImages(missingLateralId, request, dependencies), /referencias visuales lateral y trasera/);
  await assert.rejects(generateAndSaveProductImages(missingRearId, request, dependencies), /referencias visuales lateral y trasera/);
  assert.equal(calls, 0);
}));

test('generación recibe lateral y trasera reales y no las archiva al regenerar IA', () => usingDatabase(async ({ client }) => {
  const productId = await createTestProduct(client);
  await seedRequiredReferences(client, productId);
  let receivedRoles: string[] = [];
  await generateAndSaveProductImages(productId, {
    quantity: 1, angles: ['frontal'], quality: 'ESTANDAR', mode: 'REPLACE'
  }, {
    database: client,
    referenceReader: async (url) => `data:image/webp;base64,${Buffer.from(url).toString('base64')}`,
    generator: async (_product, request, references) => {
      receivedRoles = references.map((reference) => reference.role);
      return fakeImages(request);
    },
    uploader: async (_id, image) => ({ ...image, url: 'https://blob.test/generated.webp', pathname: 'contenido/generated.webp', hash: 'f'.repeat(64) }),
    cleanup: async () => undefined
  });
  assert.deepEqual(receivedRoles, ['REFERENCIA_LATERAL', 'REFERENCIA_TRASERA']);
  assert.equal((await getProductContent(productId, client))?.references.length, 2);
}));

test('OpenAI genera tres ángulos concurrentemente y limita lotes a tres', () => usingDatabase(async ({ client }) => {
  const productId = await createTestProduct(client);
  const product = await getPublicationProduct(productId, client);
  assert.ok(product);
  let active = 0;
  let maximum = 0;
  let referencesPassed = false;
  const fakeClient = {
    images: {
      edit: async (body: Record<string, unknown>) => {
        referencesPassed ||= Array.isArray(body.image) && body.image.length === 2
          && /imagen 1 es la vista LATERAL real/.test(String(body.prompt));
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return { data: [{ b64_json: Buffer.from(webpBytes).toString('base64') }] };
      }
    }
  } as unknown as OpenAI;
  const references = [
    { role: 'REFERENCIA_LATERAL' as const, dataUrl: `data:image/webp;base64,${Buffer.from(webpBytes).toString('base64')}` },
    { role: 'REFERENCIA_TRASERA' as const, dataUrl: `data:image/webp;base64,${Buffer.from(webpBytes).toString('base64')}` }
  ];
  const result = await generatePublicationImagesWithOpenAI(product, {
    quantity: 5, angles: ['frontal', 'trasera', 'superior'], quality: 'RAPIDA', mode: 'APPEND'
  }, references, { client: fakeClient, apiKey: 'test', model: 'test-image-model' });
  assert.equal(IMAGE_GENERATION_CONCURRENCY, 3);
  assert.equal(maximum, 3);
  assert.equal(result.images.length, 5);
  assert.equal(referencesPassed, true);
}));

test('un fallo OpenAI transitorio reintenta una sola vez en secuencial sin repetir éxitos', () => usingDatabase(async ({ client }) => {
  const productId = await createTestProduct(client);
  const product = await getPublicationProduct(productId, client);
  assert.ok(product);
  let call = 0;
  const fakeClient = {
    images: {
      edit: async () => {
        const current = call++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (current === 1) throw Object.assign(new Error('fallo'), { status: 500 });
        return { data: [{ b64_json: Buffer.from(webpBytes).toString('base64') }] };
      }
    }
  } as unknown as OpenAI;
  const dataUrl = `data:image/webp;base64,${Buffer.from(webpBytes).toString('base64')}`;
  const result = await generatePublicationImagesWithOpenAI(product, {
    quantity: 3, angles: ['frontal', 'trasera', 'superior'], quality: 'RAPIDA', mode: 'APPEND'
  }, [{ role: 'REFERENCIA_LATERAL', dataUrl }, { role: 'REFERENCIA_TRASERA', dataUrl }], { client: fakeClient, apiKey: 'test', model: 'test-image-model' });
  assert.equal(result.images.length, 3);
  assert.equal(result.failures.length, 0);
  assert.equal(call, 4);
}));

test('gpt-image-2 usa edits con dos referencias y omite input_fidelity no soportado', () => usingDatabase(async ({ client }) => {
  const productId = await createTestProduct(client);
  const product = await getPublicationProduct(productId, client);
  assert.ok(product);
  let request: Record<string, unknown> | undefined;
  const fakeClient = { images: { edit: async (body: Record<string, unknown>) => {
    request = body;
    return { data: [{ b64_json: Buffer.from(webpBytes).toString('base64') }] };
  } } } as unknown as OpenAI;
  const dataUrl = `data:image/webp;base64,${Buffer.from(webpBytes).toString('base64')}`;
  const result = await generatePublicationImagesWithOpenAI(product, {
    quantity: 1, angles: ['frontal'], quality: 'RAPIDA', mode: 'APPEND'
  }, [{ role: 'REFERENCIA_TRASERA', dataUrl }, { role: 'REFERENCIA_LATERAL', dataUrl }], { client: fakeClient, apiKey: 'test', model: 'gpt-image-2' });
  assert.equal(result.images.length, 1);
  assert.equal(Array.isArray(request?.image) && request.image.length, 2);
  assert.equal('input_fidelity' in (request ?? {}), false);
  assert.match(String(request?.prompt), /forma de la mediasuela/);
}));

test('referencia binaria inválida se rechaza antes de llamar a OpenAI', () => usingDatabase(async ({ client }) => {
  const productId = await createTestProduct(client);
  const product = await getPublicationProduct(productId, client);
  assert.ok(product);
  let calls = 0;
  const fakeClient = { images: { edit: async () => { calls += 1; return { data: [] }; } } } as unknown as OpenAI;
  await assert.rejects(generatePublicationImagesWithOpenAI(product, {
    quantity: 1, angles: ['frontal'], quality: 'RAPIDA', mode: 'APPEND'
  }, [
    { role: 'REFERENCIA_LATERAL', dataUrl: 'data:image/webp;base64,AQID' },
    { role: 'REFERENCIA_TRASERA', dataUrl: 'data:image/webp;base64,AQID' }
  ], { client: fakeClient, apiKey: 'test', model: 'gpt-image-2' }), /no contiene una imagen utilizable/);
  assert.equal(calls, 0);
}));

test('prioriza EU y CM asociado en calzado, omite US; ropa nunca publica CM', () => usingDatabase(async ({ client }) => {
  const productId = await createTestProduct(client);
  const product = await getPublicationProduct(productId, client);
  assert.ok(product);
  const base = product.variants[0];
  const footwear: PublicationProduct = {
    ...product,
    variants: [
      { ...base, id: uuidV7(), size: '8', sizeSystem: 'US', footLengthMm: 250, sizeEquivalences: { US: '8', EU: '39', CM: '25' } },
      { ...base, id: uuidV7(), size: '39', sizeSystem: 'EU', footLengthMm: 250 }
    ]
  };
  assert.deepEqual(publicSizeFacts(footwear).map((size) => size.label), ['39 EU · 25 cm']);
  const clothing: PublicationProduct = { ...footwear, type: 'ROPA', variants: [{ ...base, size: 'M', sizeSystem: 'ALFABETICO', footLengthMm: 250 }] };
  assert.deepEqual(publicSizeFacts(clothing).map((size) => size.label), ['M ALFABETICO']);
}));

test('una variante histórica US usa EU/CM de su movimiento confirmado sin reescribir inventario', () => usingDatabase(async ({ client }) => {
  productSequence += 1;
  const created = await createProduct({
    brand: 'Nike', model: 'Shox R4', reference: `HQ7739-${productSequence}`, colorway: 'Gris y negro', type: 'CALZADO',
    variants: [{ size: '8', sizeSystem: 'US', quantity: 3, pvpCents: 0, costCents: 1000, barcode: null, location: 'Tienda', gender: 'MUJER', ageGroup: 'ADULTO' }]
  }, client);
  const variantRow = await client.execute({ sql: 'SELECT id FROM variantes_producto WHERE producto_id = ? LIMIT 1', args: [created.productId] });
  const location = await client.execute({ sql: 'SELECT id FROM ubicaciones_inventario LIMIT 1', args: [] });
  const now = Date.now();
  await client.execute({
    sql: `INSERT INTO movimientos_inventario (
            id, variante_id, ubicacion_id, tipo, delta, saldo_posterior, clave_idempotencia,
            origen, metadata_json, ocurrido_en_ms, creado_en_ms, creado_por
          ) VALUES (?, ?, ?, 'COMPRA', 1, 4, ?, 'MANUAL', ?, ?, ?, 'test')`,
    args: [
      uuidV7(now), String(variantRow.rows[0].id), String(location.rows[0].id), `equivalencias-test:${uuidV7(now)}`,
      JSON.stringify({ metodo_alta: 'FOTOS', equivalencias_talla: { US: '8', EU: '39', CM: '25' } }), now + 1, now + 1
    ]
  });
  const product = await getPublicationProduct(created.productId, client);
  assert.ok(product);
  assert.deepEqual(publicSizeFacts(product).map((size) => size.label), ['39 EU · 25 cm']);
  assert.equal(product.variants[0].size, '8');
  assert.equal(product.variants[0].sizeSystem, 'US');
}));

test('sin equivalencia EU confirmada conserva US y nunca inventa conversión', () => usingDatabase(async ({ client }) => {
  const productId = await createTestProduct(client);
  const product = await getPublicationProduct(productId, client);
  assert.ok(product);
  const base = product.variants[0];
  const historical: PublicationProduct = {
    ...product,
    variants: [{ ...base, size: '8', sizeSystem: 'US', footLengthMm: null, sizeEquivalences: { US: '8' } }]
  };
  assert.deepEqual(publicSizeFacts(historical).map((size) => size.label), ['8 US']);
}));

test('payload de navegador devuelve endpoints registrados sin URL ni pathname privados', () => usingDatabase(async ({ client }) => {
  const productId = await createTestProduct(client);
  await seedRequiredReferences(client, productId);
  const content = await getProductContent(productId, client);
  assert.ok(content);
  const payload = publicContentPayload(content);
  const serialized = JSON.stringify(payload);
  assert.match(serialized, /\/api\/content\/assets\//);
  assert.doesNotMatch(serialized, /blob\.test|blobPathname|uri_almacenamiento/);
}));

test('descarga privada conserva MIME y usa filename legible calculado en servidor', async () => {
  const filename = contentImageFilename({
    id: uuidV7(), storageUri: 'private-value', mimeType: 'image/webp', brand: 'Nike', model: 'Shox R4',
    reference: 'HQ7739-001', angle: 'lateral-exterior', role: null
  });
  assert.equal(filename, 'nike-shox-r4-lateral-exterior.webp');
  const getter = (async () => ({
    statusCode: 200,
    stream: new Blob([webpBytes], { type: 'image/webp' }).stream(),
    headers: new Headers(),
    blob: {
      url: '', downloadUrl: '', pathname: '', contentDisposition: 'inline', cacheControl: '', uploadedAt: new Date(),
      etag: 'test', contentType: 'image/webp', size: webpBytes.byteLength
    }
  })) as unknown as typeof import('@vercel/blob').get;
  const response = await streamPrivateContentImage('private-value', filename, { getter, auth: { oidcToken: 'test', storeId: 'test' } });
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="nike-shox-r4-lateral-exterior.webp"');
});

test('la ruta dinámica usa biblioteca real y no ofrece publicación externa', async () => {
  const page = await readFile(new URL('../src/pages/contenido/[id].astro', import.meta.url), 'utf8');
  const assetRoute = await readFile(new URL('../src/pages/api/content/assets/[id].ts', import.meta.url), 'utf8');
  const referenceRoute = await readFile(new URL('../src/pages/api/content/products/[id]/references/[role].ts', import.meta.url), 'utf8');
  const imageRoute = await readFile(new URL('../src/pages/api/content/products/[id]/images.ts', import.meta.url), 'utf8');
  assert.match(page, /getProductContent/);
  assert.match(page, /Generar imágenes/);
  assert.match(page, /Descripción completa/);
  assert.match(page, /Título comercial/);
  assert.match(page, /SEO title/);
  assert.match(page, /Meta description/);
  assert.doesNotMatch(page, /Historia \/ dato curioso|Características técnicas/);
  assert.match(page, /\/api\/content\/assets/);
  assert.match(page, /Referencias visuales del producto/);
  assert.match(page, /REFERENCIA_LATERAL/);
  assert.match(page, /REFERENCIA_TRASERA/);
  assert.match(page, /showSkeletons\(quantity, selectedAngles\)/);
  assert.match(page, /selectedCount = angleInputs\.filter/);
  assert.match(page, /Math\.max\(selectedAngles\.length/);
  assert.match(page, /imageForm\.getAttribute\('aria-busy'\) === 'true'/);
  assert.match(page, /renderGallery\(data\.content\.images/);
  assert.match(page, /response\.blob\(\)/);
  assert.match(page, /ClipboardItem/);
  assert.match(page, /\?download=1/);
  assert.match(page, /data-references-required/);
  assert.match(page, /Para generar imágenes fieles del producto/);
  assert.doesNotMatch(page, /window\.location\.reload\(\), 500/);
  assert.doesNotMatch(page, /Descripción corta|Descripción larga/);
  assert.doesNotMatch(page, /mockProducts|Publicar en Shopify|Preparar publicación en Shopify/);
  assert.match(assetRoute, /z\.uuid/);
  assert.match(assetRoute, /getContentImageResource/);
  assert.doesNotMatch(assetRoute, /searchParams\.get\('path/);
  assert.match(referenceRoute, /multipart\/form-data/);
  assert.match(referenceRoute, /saveProductContentReference/);
  assert.match(imageRoute, /publicContentPayload/);
});

test('la ficha de stock permite seleccionar y descargar imágenes y muestra los cuatro textos', async () => {
  const page = await readFile(new URL('../src/pages/stock/[id].astro', import.meta.url), 'utf8');
  assert.match(page, /getProductContent/);
  assert.match(page, /data-gallery-thumb/);
  assert.match(page, /data-gallery-main/);
  assert.match(page, /data-download-current/);
  assert.match(page, /data-download-all/);
  assert.match(page, /Descargar una/);
  assert.match(page, /Descargar todas/);
  assert.match(page, /Título comercial/);
  assert.match(page, /Descripción completa/);
  assert.match(page, /SEO title/);
  assert.match(page, /Meta description/);
  assert.match(page, /content\.texts\.tituloComercial/);
  assert.match(page, /content\.texts\.descripcionCompleta/);
});
