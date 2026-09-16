import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type OpenAI from 'openai';
import {
  assertSessionBlobPath,
  buildTemporaryBlobPath,
  parseTemporaryBlobPath
} from '../src/lib/product-detection/blob-paths.ts';
import { deleteTemporarySession, deleteTemporarySourceImages, issueTemporaryUploadToken, readPrivateSessionImages } from '../src/lib/product-detection/blob.ts';
import { approveProductFromPhotos } from '../src/lib/product-detection/approval.ts';
import {
  DEFAULT_OPENAI_VISION_MODEL,
  estimateOpenAIRequestCostUsd,
  OPENAI_TIMEOUT_MS,
  reasoningEffortForVisionModel,
  sourceDataImageKinds
} from '../src/lib/product-detection/config.ts';
import {
  checkExistingContent,
  resolveVisualContentIdentity,
  visualContentFingerprint
} from '../src/lib/product-detection/content-status.ts';
import { getBlobConfigurationPresence, getBlobOidcOptions, getOpenAIConfig } from '../src/lib/product-detection/env.ts';
import { blobFailure, sanitizeBlobError } from '../src/lib/product-detection/errors.ts';
import { detectImageMime, validateImageBytes, validateImageMetadata } from '../src/lib/product-detection/files.ts';
import { checkDetectionDuplicates } from '../src/lib/product-detection/duplicates.ts';
import { extractProductWithOpenAI, publicOpenAIError } from '../src/lib/product-detection/openai.ts';
import { analyzeProductPhotos } from '../src/lib/product-detection/service.ts';
import { canContinueProductFlow, generationReferenceState } from '../src/lib/product-detection/generation-flow.ts';
import {
  reconcileProductDetection
} from '../src/lib/product-detection/normalize.ts';
import type { ModelProductDetection } from '../src/lib/product-detection/schemas.ts';
import {
  analyzeRequestSchema,
  groupTemporarySourceDataAssets,
  modelProductDetectionSchema
} from '../src/lib/product-detection/schemas.ts';
import { inspectGtin, normalizeGtin, normalizeProductReference, normalizeReferenceForComparison } from '../src/lib/inventory/normalization.ts';

const SESSION_ID = '123e4567-e89b-42d3-a456-426614174000';
const FOOTWEAR_IMAGE_KINDS = ['caja', 'ticket', 'etiqueta', 'referenciaLateral', 'referenciaTrasera'] as const;
const CLOTHING_SOURCE_IMAGE_KINDS = ['etiquetaRopa', 'ticket', 'prendaCompleta'] as const;
const OPENAI_IMAGES = sourceDataImageKinds('CALZADO').map((kind) => ({ kind, dataUrl: 'data:image/jpeg;base64,/9j/' }));

function analyzeRequest() {
  return {
    sessionId: SESSION_ID,
    productKind: 'CALZADO' as const,
    imagenes: Object.fromEntries(sourceDataImageKinds('CALZADO').map((kind) => [kind, {
      pathname: buildTemporaryBlobPath(SESSION_ID, 'CALZADO', kind, 'image/jpeg')
    }]))
  };
}

function clothingAnalyzeRequest() {
  return {
    sessionId: SESSION_ID,
    productKind: 'ROPA' as const,
    imagenes: Object.fromEntries(CLOTHING_SOURCE_IMAGE_KINDS.map((kind) => [kind, {
      pathname: buildTemporaryBlobPath(SESSION_ID, 'ROPA', kind, 'image/jpeg')
    }]))
  };
}

function modelFixture(overrides: Partial<ModelProductDetection> = {}): ModelProductDetection {
  const base: ModelProductDetection = {
    imagenes: {
      caja: { usable: true, motivo: null },
      ticket: { usable: true, motivo: null },
      etiqueta: { usable: true, motivo: null }
    },
    producto: {
      marca: 'Nike',
      modelo: 'Air Force 1 Retro PRM',
      referencia: 'IR0871 400',
      colorway: 'Hydrogen Blue / Football Grey',
      subtipo: null,
      tipoProducto: 'CALZADO',
      genero: 'MUJER'
    },
    variante: {
      tallaOriginal: 'EUR 42.5',
      sistemaTalla: 'EU',
      upc: '00198730356907',
      cantidad: 1
    },
    ticket: {
      proveedor: 'Nike Clearance Store Alicante',
      fechaCompra: '2026-09-11',
      fechaOrigenCompra: null,
      fechaOperacion: null,
      lineas: [{
        descripcion: 'Air Force 1',
        codigo: '00198730356907',
        precioOriginalCentimos: 7999,
        descuentoCentimos: 4000,
        precioFinalCentimos: 3999
      }]
    },
    evidencias: {
      marca: ['caja'], modelo: ['caja'], referencia: ['caja', 'etiqueta'],
      colorway: ['caja'], tipoProducto: ['caja'], genero: ['caja'],
      talla: ['caja', 'etiqueta'], sistemaTalla: ['caja'], upc: ['caja', 'etiqueta'],
      proveedor: ['ticket'], fechaCompra: ['ticket']
    },
    observaciones: {
      caja: { referencia: 'IR0871 400', talla: 'EUR 42.5', filasTalla: [], upc: '00198730356907', barcodeDigits: null },
      etiqueta: { referencia: 'IR0871-400', talla: '42.5', filasTalla: [], upc: '00198730356907', barcodeDigits: null }
    },
    revision: []
  };
  return { ...base, ...overrides };
}

function footwearSizeRow(genero: 'HOMBRE' | 'MUJER', US: string, CM: string) {
  return {
    etiqueta: genero === 'HOMBRE' ? 'MENS' : 'WMNS',
    genero,
    EU: '45', US, UK: '10', CM, BR: '43'
  };
}

function fixtureWithMensAndWmnsRows(genero: ModelProductDetection['producto']['genero']) {
  const fixture = modelFixture();
  fixture.producto.genero = genero;
  fixture.observaciones.caja.talla = 'MENS y WMNS, consultar filasTalla';
  fixture.observaciones.etiqueta.talla = 'MENS y WMNS, consultar filasTalla';
  fixture.observaciones.caja.filasTalla = [
    footwearSizeRow('HOMBRE', '11', '29'),
    footwearSizeRow('MUJER', '12.5', '29.5')
  ];
  fixture.observaciones.etiqueta.filasTalla = [
    footwearSizeRow('HOMBRE', '11', '29'),
    footwearSizeRow('MUJER', '12.5', '29.5')
  ];
  return fixture;
}

test('acepta contenido JPEG válido', () => {
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]);
  assert.equal(detectImageMime(bytes), 'image/jpeg');
  assert.equal(validateImageBytes(bytes, 'image/jpeg'), 'image/jpeg');
});

test('acepta contenido PNG válido', () => {
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(detectImageMime(bytes), 'image/png');
  assert.equal(validateImageBytes(bytes, 'image/png'), 'image/png');
});

test('rechaza MIME no permitido', () => {
  assert.throws(() => validateImageMetadata('application/pdf', 100), /no es compatible/);
});

test('rechaza archivos mayores de 10 MB', () => {
  assert.throws(() => validateImageMetadata('image/jpeg', 10 * 1024 * 1024 + 1), /tamaño máximo/);
});

test('acepta una respuesta estructurada válida de OpenAI sin hacer una llamada real', async () => {
  const client = {
    responses: { parse: async () => ({ output_parsed: modelFixture(), usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }) }
  } as unknown as OpenAI;
  const result = await extractProductWithOpenAI(OPENAI_IMAGES, 'CALZADO', { client, apiKey: 'test', model: 'test-model' });
  assert.equal(result.producto.marca, 'Nike');
});

test('bloquea una respuesta estructurada inválida de OpenAI', async () => {
  const client = { responses: { parse: async () => ({ output_parsed: { producto: {} }, usage: undefined }) } } as unknown as OpenAI;
  await assert.rejects(
    extractProductWithOpenAI(OPENAI_IMAGES, 'CALZADO', { client, apiKey: 'test', model: 'test-model' }),
    (error: Error & { code?: string }) => error.code === 'OPENAI_RESPUESTA_INVALIDA'
  );
});

test('OpenAI usa 180 segundos mediante el timeout nativo del SDK y no un AbortSignal', async () => {
  let requestOptions: Record<string, unknown> | undefined;
  const client = {
    responses: { parse: async (_request: unknown, options: Record<string, unknown>) => {
      requestOptions = options;
      return { output_parsed: modelFixture(), usage: undefined };
    } }
  } as unknown as OpenAI;
  await extractProductWithOpenAI(OPENAI_IMAGES, 'CALZADO', { client, apiKey: 'test', model: 'test-model' });
  assert.equal(OPENAI_TIMEOUT_MS, 180_000);
  assert.equal(requestOptions?.timeout, 180_000);
  assert.equal('signal' in (requestOptions ?? {}), false);
});

test('gpt-5.4-mini mantiene Structured Outputs con reasoning none, salida breve e imágenes high', async () => {
  let request: Record<string, any> | undefined;
  const client = {
    responses: { parse: async (value: Record<string, any>) => {
      request = value;
      return { output_parsed: modelFixture(), usage: undefined };
    } }
  } as unknown as OpenAI;
  await extractProductWithOpenAI(OPENAI_IMAGES, 'CALZADO', { client, apiKey: 'test', model: 'gpt-5.4-mini' });
  assert.deepEqual(request?.reasoning, { effort: 'none' });
  assert.equal(request?.text.verbosity, 'low');
  assert.ok(request?.text.format);
  const imageInputs = request?.input[0].content.filter((item: { type: string }) => item.type === 'input_image');
  assert.deepEqual(imageInputs.map((item: { detail: string }) => item.detail), ['high', 'high', 'high']);
});

test('OPENAI_VISION_MODEL cambia el modelo sin modificar código y aplica el esfuerzo mínimo compatible', async () => {
  assert.equal(DEFAULT_OPENAI_VISION_MODEL, 'gpt-5.4-mini');
  assert.equal((await getOpenAIConfig({ OPENAI_API_KEY: 'test', OPENAI_VISION_MODEL: 'gpt-5-mini' })).model, 'gpt-5-mini');
  assert.equal((await getOpenAIConfig({ OPENAI_API_KEY: 'test', OPENAI_VISION_MODEL: 'gpt-5.4-nano' })).model, 'gpt-5.4-nano');
  assert.equal(reasoningEffortForVisionModel('gpt-5-mini'), 'minimal');
  assert.equal(reasoningEffortForVisionModel('gpt-5.4-mini'), 'none');
  assert.equal(reasoningEffortForVisionModel('gpt-5.4-nano'), 'none');
});

test('estima coste OpenAI solo desde la tabla central de precios y contempla caché', () => {
  assert.equal(estimateOpenAIRequestCostUsd('modelo-desconocido', { inputTokens: 100, outputTokens: 10 }), null);
  assert.equal(estimateOpenAIRequestCostUsd('gpt-5.4-mini', {
    inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 100_000
  }), 1.065);
});

test('clasifica los errores OpenAI sin convertirlos todos en timeout', () => {
  assert.equal(publicOpenAIError({ status: 401, name: 'AuthenticationError' }).code, 'OPENAI_AUTHENTICATION_ERROR');
  assert.equal(publicOpenAIError({ status: 429, name: 'RateLimitError' }).code, 'OPENAI_RATE_LIMIT');
  assert.equal(publicOpenAIError({ status: 400, name: 'BadRequestError' }).code, 'OPENAI_REQUEST_INVALID');
  assert.equal(publicOpenAIError({ status: 422, name: 'UnprocessableEntityError' }).code, 'OPENAI_REQUEST_INVALID');
  assert.equal(publicOpenAIError({ status: 500, name: 'InternalServerError' }).code, 'OPENAI_SERVER_ERROR');
  assert.equal(publicOpenAIError({ name: 'APIConnectionTimeoutError' }).code, 'OPENAI_TIMEOUT');
  assert.equal(publicOpenAIError(new Error('fallo desconocido')).code, 'OPENAI_ERROR');
});

test('normaliza GTIN-12 y GTIN-14 a la misma representación canónica', () => {
  assert.equal(normalizeGtin('198480903925'), '00198480903925');
  assert.equal(normalizeGtin('00198480903925'), '00198480903925');
  assert.equal(normalizeGtin('198480903925'), normalizeGtin('00198480903925'));
  assert.equal(normalizeGtin('198730356907'), '00198730356907');
  assert.equal(normalizeGtin('00198730356907'), '00198730356907');
});

test('limpia separadores, rechaza longitudes inválidas y conserva ceros', () => {
  assert.equal(normalizeGtin(' 00198480903925 '), '00198480903925');
  assert.equal(normalizeGtin('0019 8480-9039 25'), '00198480903925');
  assert.equal(normalizeGtin('12345'), null);
  assert.equal(normalizeGtin('96385074'), '00000096385074');
  assert.equal(normalizeGtin('00000096385074'), '00000096385074');
});

test('distingue formato válido de dígito de control incorrecto', () => {
  assert.deepEqual(inspectGtin('198480903924'), {
    original: '198480903924',
    canonical: '00198480903924',
    formatValid: true,
    checkDigitValid: false
  });
});

test('normaliza una referencia separada por espacio', () => {
  assert.equal(normalizeProductReference('IR0871 400'), 'IR0871-400');
});

test('normaliza espacios, guiones y slash equivalentes en referencias', () => {
  assert.equal(normalizeReferenceForComparison(' II7634  001 '), 'II7634-001');
  assert.equal(normalizeReferenceForComparison('II7634-001'), 'II7634-001');
  assert.equal(normalizeReferenceForComparison('ii7634/001'), 'II7634-001');
  assert.equal(normalizeReferenceForComparison('II7634–001'), 'II7634-001');
  assert.equal(normalizeReferenceForComparison('II7634\u200B-001'), 'II7634-001');
});

test('conserva completos los prefijos alfabéticos de las referencias', () => {
  assert.equal(normalizeReferenceForComparison('II7634-001'), 'II7634-001');
  assert.equal(normalizeReferenceForComparison('ABC1234 / 007'), 'ABC1234-007');
  assert.notEqual(normalizeReferenceForComparison('II7634-001'), '7634-001');
});

test('normaliza W NIKE SHOX R4 como SHOX R4 e infiere Mujer', () => {
  const fixture = modelFixture();
  fixture.producto.marca = 'NIKE';
  fixture.producto.modelo = 'W NIKE SHOX R4';
  fixture.producto.genero = 'DESCONOCIDO';
  fixture.evidencias.genero = [];
  const result = reconcileProductDetection(fixture);
  assert.equal(result.producto.modelo, 'SHOX R4');
  assert.equal(result.producto.genero, 'MUJER');
  assert.deepEqual(result.estados.genero.evidencias, ['caja']);
});

test('elimina NIKE duplicado al inicio del modelo', () => {
  const fixture = modelFixture();
  fixture.producto.marca = 'NIKE';
  fixture.producto.modelo = 'NIKE AIR MAX DN8';
  assert.equal(reconcileProductDetection(fixture).producto.modelo, 'AIR MAX DN8');
});

test('elimina ADIDAS duplicado al inicio del modelo', () => {
  const fixture = modelFixture();
  fixture.producto.marca = 'ADIDAS';
  fixture.producto.modelo = 'ADIDAS CAMPUS 00S';
  assert.equal(reconcileProductDetection(fixture).producto.modelo, 'CAMPUS 00S');
});

test('normaliza WMNS NIKE DUNK LOW como DUNK LOW e infiere Mujer', () => {
  const fixture = modelFixture();
  fixture.producto.marca = 'NIKE';
  fixture.producto.modelo = 'WMNS NIKE DUNK LOW';
  fixture.producto.genero = null;
  fixture.evidencias.genero = [];
  const result = reconcileProductDetection(fixture);
  assert.equal(result.producto.modelo, 'DUNK LOW');
  assert.equal(result.producto.genero, 'MUJER');
});

test('no elimina letras ni prefijos que no están ligados a la marca', () => {
  const fixture = modelFixture();
  fixture.producto.marca = 'NIKE';
  fixture.producto.modelo = 'W SHOX R4';
  fixture.producto.genero = 'DESCONOCIDO';
  const result = reconcileProductDetection(fixture);
  assert.equal(result.producto.modelo, 'W SHOX R4');
  assert.equal(result.producto.genero, 'DESCONOCIDO');
});

test('ropa normaliza M NSW SW AIR GRAPHIC TEE como AIR GRAPHIC TEE y Hombre', () => {
  const fixture = modelFixture();
  fixture.producto.marca = 'NIKE';
  fixture.producto.modelo = 'M NSW SW AIR GRAPHIC TEE';
  fixture.producto.genero = 'HOMBRE';
  fixture.producto.tipoProducto = 'ROPA';
  const result = reconcileProductDetection(fixture, 'ROPA');
  assert.equal(result.producto.modelo, 'AIR GRAPHIC TEE');
  assert.equal(result.producto.genero, 'HOMBRE');
  assert.equal(result.producto.referencia, 'IR0871-400');
  assert.equal(result.variante.gtinNormalizado, '00198730356907');
  assert.equal(result.compra.costeCentimos, 3999);
});

test('ropa normaliza W NSW TEE como TEE e infiere Mujer', () => {
  const fixture = modelFixture();
  fixture.producto.marca = 'NIKE';
  fixture.producto.modelo = 'W NSW TEE';
  fixture.producto.genero = 'DESCONOCIDO';
  fixture.producto.tipoProducto = 'ROPA';
  fixture.evidencias.genero = [];
  const result = reconcileProductDetection(fixture, 'ROPA');
  assert.equal(result.producto.modelo, 'TEE');
  assert.equal(result.producto.genero, 'MUJER');
  assert.deepEqual(result.estados.genero.evidencias, ['caja']);
});

test('ropa elimina NIKE duplicado del modelo', () => {
  const fixture = modelFixture();
  fixture.producto.marca = 'NIKE';
  fixture.producto.modelo = 'NIKE AIR GRAPHIC TEE';
  fixture.producto.tipoProducto = 'ROPA';
  assert.equal(reconcileProductDetection(fixture, 'ROPA').producto.modelo, 'AIR GRAPHIC TEE');
});

test('la talla M de ropa no se interpreta como prefijo de género del modelo', () => {
  const fixture = modelFixture();
  fixture.producto.marca = 'NIKE';
  fixture.producto.modelo = 'AIR GRAPHIC TEE';
  fixture.producto.genero = 'DESCONOCIDO';
  fixture.producto.tipoProducto = 'ROPA';
  fixture.variante.tallaOriginal = 'M';
  fixture.variante.sistemaTalla = 'ALFABETICO';
  fixture.observaciones.caja.talla = 'M';
  const result = reconcileProductDetection(fixture, 'ROPA');
  assert.equal(result.producto.modelo, 'AIR GRAPHIC TEE');
  assert.equal(result.producto.genero, 'DESCONOCIDO');
  assert.equal(result.variante.tallaNormalizada, 'M');
});

test('la limpieza de abreviaturas NSW no se aplica al flujo de calzado', () => {
  const fixture = modelFixture();
  fixture.producto.marca = 'NIKE';
  fixture.producto.modelo = 'M NSW SW AIR GRAPHIC TEE';
  fixture.producto.genero = 'HOMBRE';
  const result = reconcileProductDetection(fixture, 'CALZADO');
  assert.equal(result.producto.modelo, 'M NSW SW AIR GRAPHIC TEE');
});

test('no autocorrige caracteres OCR ambiguos y exige revisión si las fuentes discrepan', () => {
  const fixture = modelFixture();
  fixture.producto.referencia = 'U7634-001';
  fixture.observaciones.caja.referencia = 'U7634-001';
  fixture.observaciones.etiqueta.referencia = 'II7634-001';
  const result = reconcileProductDetection(fixture);
  assert.equal(result.producto.referencia, 'II7634-001');
  assert.equal(result.estados.referencia.estado, 'REVISAR');
  assert.deepEqual(result.estados.referencia.evidencias, ['etiqueta']);
  assert.equal(normalizeReferenceForComparison('U7634-001'), 'U7634-001');
});

test('normaliza EUR 42.5 reutilizando parseSize', () => {
  assert.equal(reconcileProductDetection(modelFixture()).variante.tallaNormalizada, '42.5');
});

test('para calzado prioriza EU sobre US y UK y conserva las equivalencias', () => {
  const fixture = modelFixture();
  fixture.variante.sistemaTalla = 'US';
  fixture.variante.tallaOriginal = 'US 11';
  fixture.observaciones.caja.talla = 'EU 45 / US 11 / UK 10';
  fixture.observaciones.etiqueta.talla = 'US 11 / UK 10 / EUR 45';
  const result = reconcileProductDetection(fixture);
  assert.equal(result.variante.tallaNormalizada, '45');
  assert.equal(result.variante.sistemaTalla, 'EU');
  assert.deepEqual(result.variante.equivalenciasTalla, { EU: '45', US: '11', UK: '10' });
  assert.equal(result.estados.talla.estado, 'CONFIRMADO');
});

test('conserva CM 29 como equivalencia secundaria sin desplazar EU 45', () => {
  for (const centimeters of ['29', '29.0', '29,0']) {
    const fixture = modelFixture();
    fixture.observaciones.caja.talla = `EUR 45 / CM ${centimeters}`;
    fixture.observaciones.etiqueta.talla = `EU 45 / CM ${centimeters}`;
    const result = reconcileProductDetection(fixture);
    assert.equal(result.variante.tallaNormalizada, '45');
    assert.equal(result.variante.sistemaTalla, 'EU');
    assert.equal(result.variante.equivalenciasTalla.CM, '29');
  }
});

test('normaliza CM 29.5 y 29,5 sin convertirlos en 295', () => {
  for (const centimeters of ['29.5', '29,5']) {
    const fixture = modelFixture();
    fixture.observaciones.caja.talla = `EUR 45 / CM ${centimeters}`;
    fixture.observaciones.etiqueta.talla = `EUR 45 / CM ${centimeters}`;
    assert.equal(reconcileProductDetection(fixture).variante.equivalenciasTalla.CM, '29.5');
  }
});

test('normaliza 29,5 aislado cuando el sistema detectado es CM', () => {
  const fixture = modelFixture();
  fixture.variante.sistemaTalla = 'CM';
  fixture.variante.tallaOriginal = '29,5';
  fixture.observaciones.caja.talla = '29,5';
  fixture.observaciones.etiqueta.talla = '29,5';
  const result = reconcileProductDetection(fixture);
  assert.equal(result.variante.tallaNormalizada, '29.5');
  assert.equal(result.variante.sistemaTalla, 'CM');
  assert.equal(result.variante.equivalenciasTalla.CM, '29.5');
});

test('la ausencia de CM no bloquea ni cambia la talla principal de calzado', () => {
  const fixture = modelFixture();
  fixture.observaciones.caja.talla = 'EUR 45 / US 11';
  fixture.observaciones.etiqueta.talla = 'EU 45 / US 11';
  const result = reconcileProductDetection(fixture);
  assert.equal(result.variante.tallaNormalizada, '45');
  assert.equal(result.variante.sistemaTalla, 'EU');
  assert.equal(result.variante.equivalenciasTalla.CM, undefined);
  assert.equal(result.estados.talla.estado, 'CONFIRMADO');
});

test('fila MENS US 11 / EU 45 conserva CM 29', () => {
  const fixture = modelFixture();
  fixture.producto.genero = 'HOMBRE';
  fixture.observaciones.caja.filasTalla = [footwearSizeRow('HOMBRE', '11', '29')];
  fixture.observaciones.etiqueta.filasTalla = [footwearSizeRow('HOMBRE', '11', '29')];
  const result = reconcileProductDetection(fixture);
  assert.equal(result.variante.equivalenciasTalla.CM, '29');
});

test('fila WMNS US 12.5 / EU 45 conserva CM 29.5', () => {
  const fixture = modelFixture();
  fixture.producto.genero = 'MUJER';
  fixture.observaciones.caja.filasTalla = [footwearSizeRow('MUJER', '12.5', '29.5')];
  fixture.observaciones.etiqueta.filasTalla = [footwearSizeRow('MUJER', '12.5', '29.5')];
  const result = reconcileProductDetection(fixture);
  assert.equal(result.variante.equivalenciasTalla.CM, '29.5');
});

test('dos filas con EU 45 compartido se conservan separadas sin mezclar US ni CM', () => {
  const result = reconcileProductDetection(fixtureWithMensAndWmnsRows('HOMBRE'));
  assert.equal(result.variante.filasEquivalenciasTalla.length, 2);
  assert.deepEqual(result.variante.equivalenciasTalla, { EU: '45', US: '11', UK: '10', CM: '29', BR: '43' });
  assert.ok(result.variante.filasEquivalenciasTalla.some((row) => row.equivalencias.US === '12.5' && row.equivalencias.CM === '29.5'));
});

test('producto Hombre selecciona el conjunto MENS completo', () => {
  const result = reconcileProductDetection(fixtureWithMensAndWmnsRows('HOMBRE'));
  assert.equal(result.variante.tallaNormalizada, '45');
  assert.equal(result.variante.sistemaTalla, 'EU');
  assert.equal(result.variante.equivalenciasTalla.US, '11');
  assert.equal(result.variante.equivalenciasTalla.CM, '29');
  assert.equal(result.estados.talla.estado, 'CONFIRMADO');
});

test('producto Mujer selecciona el conjunto WMNS completo', () => {
  const result = reconcileProductDetection(fixtureWithMensAndWmnsRows('MUJER'));
  assert.equal(result.variante.tallaNormalizada, '45');
  assert.equal(result.variante.sistemaTalla, 'EU');
  assert.equal(result.variante.equivalenciasTalla.US, '12.5');
  assert.equal(result.variante.equivalenciasTalla.CM, '29.5');
  assert.equal(result.estados.talla.estado, 'CONFIRMADO');
});

test('sin género determinable no elige arbitrariamente el CM de filas con el mismo EU', () => {
  const result = reconcileProductDetection(fixtureWithMensAndWmnsRows('DESCONOCIDO'));
  assert.equal(result.variante.tallaNormalizada, '45');
  assert.equal(result.variante.sistemaTalla, 'EU');
  assert.equal(result.variante.equivalenciasTalla.CM, undefined);
  assert.equal(result.variante.equivalenciasTalla.US, undefined);
  assert.equal(result.estados.talla.estado, 'REVISAR');
  assert.match(result.estados.talla.motivo ?? '', /varias filas/);
});

test('para calzado usa US como principal cuando EU no está disponible', () => {
  const fixture = modelFixture();
  fixture.variante.sistemaTalla = 'UK';
  fixture.observaciones.caja.talla = 'UK 10 / US 11 / CM 29';
  fixture.observaciones.etiqueta.talla = 'CM 29 / US 11 / UK 10';
  const result = reconcileProductDetection(fixture);
  assert.equal(result.variante.tallaNormalizada, '11');
  assert.equal(result.variante.sistemaTalla, 'US');
  assert.equal(result.estados.talla.estado, 'CONFIRMADO');
});

test('confirma coste solo con match exacto UPC-ticket', () => {
  const result = reconcileProductDetection(modelFixture());
  assert.equal(result.compra.costeCentimos, 3999);
  assert.equal(result.estados.coste.estado, 'CONFIRMADO');
});

test('confirma caja GTIN-12 contra etiqueta y ticket GTIN-14 conservando el código humano', () => {
  const fixture = modelFixture();
  fixture.variante.upc = '198480903925';
  fixture.observaciones.caja.upc = '198480903925';
  fixture.observaciones.etiqueta.upc = '00198480903925';
  fixture.ticket.lineas[0].codigo = '00198480903925';
  const result = reconcileProductDetection(fixture);
  assert.equal(result.variante.upc, '198480903925');
  assert.equal(result.variante.gtinNormalizado, '00198480903925');
  assert.equal(result.estados.upc.estado, 'CONFIRMADO');
  assert.equal(result.compra.costeCentimos, 3999);
  assert.equal(result.estados.coste.estado, 'CONFIRMADO');
});

test('resuelve el caso completo AIR MAX DN8 con referencia y GTIN equivalentes', () => {
  const fixture = modelFixture();
  fixture.producto.marca = 'NIKE';
  fixture.producto.modelo = 'AIR MAX DN8';
  fixture.producto.referencia = 'II7634 001';
  fixture.producto.colorway = 'BLACK/METALLIC SILVER';
  fixture.variante.tallaOriginal = 'US 11';
  fixture.variante.sistemaTalla = 'US';
  fixture.variante.upc = '00198481328581';
  fixture.observaciones.caja = {
    referencia: 'II7634 001', talla: 'US 11 / UK 10 / EUR 45 / CM 29 / BR 43', filasTalla: [], upc: null, barcodeDigits: '198481328581'
  };
  fixture.observaciones.etiqueta = {
    referencia: 'II7634-001', talla: 'US 11 / UK 10 / EUR 45 / CM 29 / BR 43', filasTalla: [], upc: '00198481328581', barcodeDigits: null
  };
  fixture.ticket.lineas = [{
    descripcion: 'AIR MAX DN8', codigo: '198481328581', precioOriginalCentimos: null,
    descuentoCentimos: null, precioFinalCentimos: 3999
  }];
  fixture.ticket.fechaCompra = '2026-09-09';
  fixture.ticket.fechaOrigenCompra = '2026-08-19';
  fixture.ticket.fechaOperacion = '2026-09-09';
  fixture.ticket.proveedor = 'NIKE RETAIL';
  const result = reconcileProductDetection(fixture);
  assert.equal(result.producto.marca, 'NIKE');
  assert.equal(result.producto.referencia, 'II7634-001');
  assert.equal(result.variante.tallaNormalizada, '45');
  assert.equal(result.variante.sistemaTalla, 'EU');
  assert.deepEqual(result.variante.equivalenciasTalla, { US: '11', UK: '10', EU: '45', CM: '29', BR: '43' });
  assert.equal(result.variante.gtinNormalizado, '00198481328581');
  assert.equal(result.estados.referencia.estado, 'CONFIRMADO');
  assert.deepEqual(result.estados.referencia.evidencias, ['caja', 'etiqueta']);
  assert.equal(result.estados.talla.estado, 'CONFIRMADO');
  assert.equal(result.estados.upc.estado, 'CONFIRMADO');
  assert.deepEqual(result.estados.upc.evidencias, ['caja', 'etiqueta', 'ticket']);
  assert.equal(result.estados.coste.estado, 'CONFIRMADO');
  assert.equal(result.compra.costeCentimos, 3999);
  assert.equal(result.compra.fechaCompra, '2026-08-19');
  assert.equal(result.compra.proveedor, 'NIKE RETAIL');
  assert.equal(result.ticket.fechaOperacion, '2026-09-09');
});

test('un solo GTIN legible se confirma con ticket, referencia y talla coincidentes', () => {
  const fixture = modelFixture();
  fixture.observaciones.caja.upc = null;
  fixture.observaciones.caja.barcodeDigits = '198481328581';
  fixture.observaciones.etiqueta.upc = null;
  fixture.ticket.lineas[0].codigo = '00198481328581';
  const result = reconcileProductDetection(fixture);
  assert.equal(result.estados.upc.estado, 'CONFIRMADO');
  assert.deepEqual(result.estados.upc.evidencias, ['caja', 'ticket']);
  assert.equal(result.compra.costeCentimos, 3999);
});

test('GTIN de etiqueta y ticket confirma aunque la caja no devuelva barcodeDigits', () => {
  const fixture = modelFixture();
  fixture.observaciones.caja.upc = null;
  fixture.observaciones.caja.barcodeDigits = null;
  fixture.observaciones.etiqueta.upc = '00198481328581';
  fixture.ticket.lineas[0].codigo = '198481328581';
  const result = reconcileProductDetection(fixture);
  assert.equal(result.variante.gtinNormalizado, '00198481328581');
  assert.equal(result.estados.upc.estado, 'CONFIRMADO');
  assert.deepEqual(result.estados.upc.evidencias, ['etiqueta', 'ticket']);
  assert.equal(result.compra.costeCentimos, 3999);
  assert.equal(result.estados.coste.estado, 'CONFIRMADO');
});

test('entre líneas del mismo modelo solo casa el GTIN canónico exacto', () => {
  const fixture = modelFixture();
  fixture.observaciones.caja.upc = '198480903925';
  fixture.observaciones.etiqueta.upc = '00198480903925';
  fixture.ticket.lineas = [
    { descripcion: 'W NIKE SHOX R4', codigo: '00198480903925', precioOriginalCentimos: 6299, descuentoCentimos: 3150, precioFinalCentimos: 3149 },
    { descripcion: 'W NIKE SHOX R4', codigo: '00198480947936', precioOriginalCentimos: 6299, descuentoCentimos: 3150, precioFinalCentimos: 3149 }
  ];
  assert.equal(reconcileProductDetection(fixture).compra.costeCentimos, 3149);
});

test('varias líneas con el mismo GTIN y precio proponen el mismo coste unitario', () => {
  const fixture = modelFixture();
  fixture.ticket.lineas.push({ ...fixture.ticket.lineas[0] });
  const result = reconcileProductDetection(fixture);
  assert.equal(result.compra.costeCentimos, 3999);
  assert.equal(result.estados.coste.estado, 'CONFIRMADO');
});

test('varias líneas con el mismo GTIN y precios distintos exigen revisión', () => {
  const fixture = modelFixture();
  fixture.ticket.lineas.push({ ...fixture.ticket.lineas[0], precioFinalCentimos: 2999 });
  const result = reconcileProductDetection(fixture);
  assert.equal(result.compra.costeCentimos, null);
  assert.equal(result.estados.coste.estado, 'REVISAR');
});

test('un dígito de control incorrecto exige revisión y no confirma coste', () => {
  const fixture = modelFixture();
  fixture.observaciones.caja.upc = '198480903924';
  fixture.observaciones.etiqueta.upc = '00198480903924';
  fixture.ticket.lineas[0].codigo = '00198480903924';
  const result = reconcileProductDetection(fixture);
  assert.equal(result.variante.gtinCheckDigitValido, false);
  assert.equal(result.estados.upc.estado, 'REVISAR');
  assert.equal(result.compra.costeCentimos, null);
});

test('ropa usa etiqueta como fuente principal y cruza su GTIN con ticket', () => {
  const fixture = modelFixture();
  fixture.producto.tipoProducto = 'ROPA';
  fixture.producto.subtipo = 'Sudadera';
  fixture.producto.colorway = 'Negro';
  fixture.variante.sistemaTalla = 'ALFABETICO';
  fixture.variante.tallaOriginal = 'L';
  fixture.observaciones.caja = { referencia: 'HV1234 010', talla: 'L', filasTalla: [], upc: '198480903925', barcodeDigits: null };
  fixture.observaciones.etiqueta = { referencia: null, talla: null, filasTalla: [], upc: null, barcodeDigits: null };
  fixture.ticket.lineas[0].codigo = '00198480903925';
  const result = reconcileProductDetection(fixture, 'ROPA');
  assert.equal(result.productKind, 'ROPA');
  assert.equal(result.producto.tipoProducto, 'ROPA');
  assert.equal(result.producto.subtipo, 'Sudadera');
  assert.equal(result.variante.tallaNormalizada, 'L');
  assert.equal(result.variante.sistemaTalla, 'ALFABETICO');
  assert.deepEqual(result.variante.equivalenciasTalla, {});
  assert.equal(result.estados.upc.estado, 'CONFIRMADO');
  assert.equal(result.compra.costeCentimos, 3999);
  assert.deepEqual(Object.keys(result.imagenes), ['etiquetaRopa', 'ticket', 'prendaCompleta']);
});

test('ticket sin match deja el coste a null', () => {
  const fixture = modelFixture();
  fixture.ticket.lineas[0].codigo = '999999999999';
  const result = reconcileProductDetection(fixture);
  assert.equal(result.compra.costeCentimos, null);
  assert.equal(result.estados.coste.estado, 'NO_ENCONTRADO');
});

test('una discrepancia de talla entre caja y etiqueta exige revisión', () => {
  const fixture = modelFixture();
  fixture.observaciones.etiqueta.talla = '43';
  const result = reconcileProductDetection(fixture);
  assert.equal(result.estados.talla.estado, 'REVISAR');
});

test('detecta producto y talla existentes con consultas de solo lectura', async () => {
  const statements: string[] = [];
  const database = {
    execute: async (statement: string | { sql: string }) => {
      const sql = typeof statement === 'string' ? statement : statement.sql;
      statements.push(sql.trim());
      return {
        rows: statements.length === 1
          ? [{ id: 'product-1' }]
          : [{ id: 'variant-1', producto_id: 'product-1', etiqueta_talla: '42.5', sistema_talla: 'EU', barcode_normalizado: '00198730356907', stock: 1 }]
      };
    }
  };
  const result = await checkDetectionDuplicates(reconcileProductDetection(modelFixture()), database as never);
  assert.equal(result.productExists, true);
  assert.equal(result.variantExists, true);
  assert.ok(statements.every((sql) => sql.startsWith('SELECT')));
});

test('construye paths Blob seguros y rechaza traversal', () => {
  const pathname = buildTemporaryBlobPath(SESSION_ID, 'CALZADO', 'caja', 'image/jpeg');
  assert.equal(pathname, `altas-temporales/${SESSION_ID}/CALZADO/caja.jpg`);
  assert.deepEqual(parseTemporaryBlobPath(pathname), { sessionId: SESSION_ID, productKind: 'CALZADO', kind: 'caja', extension: 'jpg' });
  assert.throws(() => parseTemporaryBlobPath(`altas-temporales/${SESSION_ID}/../ticket.jpg`), /no es válida/);
});

test('la ausencia de BLOB_READ_WRITE_TOKEN no rompe la configuración OIDC', async () => {
  const result = await getBlobOidcOptions({ VERCEL_OIDC_TOKEN: 'oidc-test', BLOB_STORE_ID: 'store-test' });
  assert.deepEqual(result, { oidcToken: 'oidc-test', storeId: 'store-test' });
  assert.equal('token' in result, false);
});

test('el diagnóstico de configuración Blob solo expone presencia booleana', async () => {
  const result = await getBlobConfigurationPresence({
    BLOB_STORE_ID: 'store-test',
    VERCEL_OIDC_TOKEN: 'oidc-test'
  });
  assert.deepEqual(result, {
    blobStoreIdConfigured: true,
    oidcConfigured: true,
    readWriteTokenConfigured: false
  });
  assert.doesNotMatch(JSON.stringify(result), /store-test|oidc-test/);
});

test('clasifica por separado configuración, autenticación y proveedor Blob', () => {
  assert.equal(blobFailure(new Error('No blob credentials found')).code, 'BLOB_CONFIG_ERROR');
  assert.equal(blobFailure(Object.assign(new Error('Unauthorized OIDC token'), { status: 401 })).code, 'BLOB_AUTH_ERROR');
  assert.equal(blobFailure(Object.assign(new Error('Service unavailable'), { status: 503 })).code, 'BLOB_PROVIDER_ERROR');
});

test('el diagnóstico Blob conserva datos útiles sin filtrar secretos', () => {
  const secret = 'vercel_blob_rw_sensitive-value';
  const error = Object.assign(new Error(`Unauthorized Bearer ${secret}`), {
    status: 401,
    code: 'unauthorized',
    cause: new Error(`upstream rejected ${secret}`)
  });
  const result = sanitizeBlobError(error, [secret]);
  assert.equal(result.class, 'Error');
  assert.equal(result.status, 401);
  assert.equal(result.code, 'unauthorized');
  assert.equal(result.cause && typeof result.cause === 'object' ? result.cause.class : null, 'Error');
  assert.doesNotMatch(JSON.stringify(result), /sensitive-value/);
  assert.match(result.message, /REDACTED/);
});

test('la autorización Blob usa OIDC y nunca un read-write token', async () => {
  let received: Record<string, unknown> | undefined;
  const issuer = async (options: Record<string, unknown>) => {
    received = options;
    return { delegationToken: 'delegation', clientSigningToken: 'signing', validUntil: Date.now() + 1000 };
  };
  await issueTemporaryUploadToken(
    buildTemporaryBlobPath(SESSION_ID, 'CALZADO', 'ticket', 'image/png'),
    { oidcToken: 'oidc-test', storeId: 'store-test' },
    issuer as never
  );
  assert.equal(received?.oidcToken, 'oidc-test');
  assert.equal(received?.storeId, 'store-test');
  assert.equal('token' in (received ?? {}), false);
  assert.deepEqual(received?.operations, ['put']);
});

test('una foto lateral válida usa las mismas validaciones y se acepta', () => {
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]);
  assert.equal(validateImageBytes(bytes, 'image/jpeg'), 'image/jpeg');
  assert.match(buildTemporaryBlobPath(SESSION_ID, 'CALZADO', 'referenciaLateral', 'image/jpeg'), /referencia-lateral\.jpg$/);
});

test('una foto trasera válida usa las mismas validaciones y se acepta', () => {
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(validateImageBytes(bytes, 'image/png'), 'image/png');
  assert.match(buildTemporaryBlobPath(SESSION_ID, 'CALZADO', 'referenciaTrasera', 'image/png'), /referencia-trasera\.png$/);
});

test('rechaza un MIME incorrecto para la foto lateral', () => {
  assert.throws(() => validateImageMetadata('image/heic', 1024), /no es compatible/);
});

test('rechaza un MIME incorrecto para la foto trasera', () => {
  assert.throws(() => validateImageMetadata('video/mp4', 1024), /no es compatible/);
});

test('genera los cinco paths Blob de calzado con tipo asociado', () => {
  assert.deepEqual(FOOTWEAR_IMAGE_KINDS.map((kind) => buildTemporaryBlobPath(SESSION_ID, 'CALZADO', kind, 'image/webp')), [
    `altas-temporales/${SESSION_ID}/CALZADO/caja.webp`,
    `altas-temporales/${SESSION_ID}/CALZADO/ticket.webp`,
    `altas-temporales/${SESSION_ID}/CALZADO/etiqueta-zapatilla.webp`,
    `altas-temporales/${SESSION_ID}/CALZADO/referencia-lateral.webp`,
    `altas-temporales/${SESSION_ID}/CALZADO/referencia-trasera.webp`
  ]);
});

test('los cinco assets comparten el mismo sessionId', () => {
  const sessionIds = FOOTWEAR_IMAGE_KINDS.map((kind) =>
    parseTemporaryBlobPath(buildTemporaryBlobPath(SESSION_ID, 'CALZADO', kind, 'image/jpeg')).sessionId
  );
  assert.deepEqual(new Set(sessionIds), new Set([SESSION_ID]));
});

test('cancelar elimina solo los blobs realmente existentes de la sesión', async () => {
  const paths = ['caja', 'ticket', 'referenciaLateral'].map((kind) =>
    buildTemporaryBlobPath(SESSION_ID, 'CALZADO', kind as (typeof FOOTWEAR_IMAGE_KINDS)[number], 'image/jpeg')
  );
  let deleted: string[] = [];
  const count = await deleteTemporarySession(SESSION_ID, {
    auth: { oidcToken: 'oidc-test', storeId: 'store-test' },
    lister: (async () => ({
      blobs: paths.map((pathname) => ({ pathname })),
      hasMore: false
    })) as never,
    deleter: (async (pathnames: string[] | string) => { deleted = typeof pathnames === 'string' ? [pathnames] : pathnames; }) as never
  });
  assert.equal(count, 3);
  assert.deepEqual(deleted, paths);
});

test('cleanup de aprobación elimina solo fotos de identificación y conserva referencias', async () => {
  const sourcePaths = CLOTHING_SOURCE_IMAGE_KINDS.map((kind) => buildTemporaryBlobPath(SESSION_ID, 'ROPA', kind, 'image/jpeg'));
  const referencePaths = ['referenciaFrontal', 'referenciaTrasera'].map((kind) =>
    buildTemporaryBlobPath(SESSION_ID, 'ROPA', kind as 'referenciaFrontal' | 'referenciaTrasera', 'image/jpeg')
  );
  let deleted: string[] = [];
  const count = await deleteTemporarySourceImages(SESSION_ID, 'ROPA', {
    auth: { oidcToken: 'oidc-test', storeId: 'store-test' },
    lister: (async () => ({ blobs: [...sourcePaths, ...referencePaths].map((pathname) => ({ pathname })), hasMore: false })) as never,
    deleter: (async (pathnames: string[] | string) => { deleted = typeof pathnames === 'string' ? [pathnames] : pathnames; }) as never
  });
  assert.equal(count, 3);
  assert.deepEqual(deleted, sourcePaths);
});

test('cleanup de aprobación ocurre únicamente después del commit de inventario', async () => {
  const events: string[] = [];
  const payload = {
    sessionId: SESSION_ID,
    tipoProducto: 'ROPA',
    producto: { marca: 'Nike', modelo: 'AIR GRAPHIC TEE', referencia: 'HM0185-489', colorway: 'Azul', genero: 'HOMBRE', tipoPrenda: 'Camiseta' },
    variante: { talla: 'L', sistemaTalla: 'ALFABETICO', gtin: '198480538028', cantidad: 1, equivalencias: {}, longitudPieCm: null },
    compra: { costeUnitarioCentimos: 499, proveedor: 'Nike', fechaCompra: '2026-09-15' }
  };
  await approveProductFromPhotos(payload, {
    inventoryApprover: async () => {
      events.push('commit');
      return { productId: 'p', variantId: 'v', movementId: 'm', quantity: 1, addedQuantity: 1, productCreated: true, variantCreated: true, idempotent: false };
    },
    sourceImageCleanup: async () => { events.push('cleanup'); return 3; }
  });
  assert.deepEqual(events, ['commit', 'cleanup']);
});

test('fallo de cleanup Blob no revierte una aprobación ya confirmada', async () => {
  let committed = false;
  const result = await approveProductFromPhotos({
    sessionId: SESSION_ID,
    tipoProducto: 'ROPA',
    producto: { marca: 'Nike', modelo: 'AIR GRAPHIC TEE', referencia: 'HM0185-489', colorway: 'Azul', genero: 'HOMBRE', tipoPrenda: 'Camiseta' },
    variante: { talla: 'L', sistemaTalla: 'ALFABETICO', gtin: null, cantidad: 1, equivalencias: {}, longitudPieCm: null },
    compra: { costeUnitarioCentimos: 499, proveedor: 'Nike', fechaCompra: '2026-09-15' }
  }, {
    inventoryApprover: async () => {
      committed = true;
      return { productId: 'p', variantId: 'v', movementId: 'm', quantity: 1, addedQuantity: 1, productCreated: true, variantCreated: true, idempotent: false };
    },
    sourceImageCleanup: async () => { throw new Error('fallo simulado'); }
  });
  assert.equal(committed, true);
  assert.equal(result.cleanupSucceeded, false);
  assert.equal(result.productId, 'p');
});

test('caja, ticket y etiqueta habilitan el contrato de Analizar', () => {
  assert.equal(analyzeRequestSchema.safeParse(analyzeRequest()).success, true);
});

test('ropa exige etiqueta, ticket propio y prenda completa sin referencias opcionales', () => {
  const request = clothingAnalyzeRequest();
  const { imagenes } = request;
  assert.equal(analyzeRequestSchema.safeParse(request).success, true);
  delete imagenes.prendaCompleta;
  assert.equal(analyzeRequestSchema.safeParse(request).success, false);
});

test('acepta los paths seguros de etiquetaRopa, ticket y prendaCompleta', () => {
  const expectedSegments = {
    etiquetaRopa: 'etiqueta-prenda',
    ticket: 'ticket',
    prendaCompleta: 'prenda-completa'
  } as const;
  for (const kind of CLOTHING_SOURCE_IMAGE_KINDS) {
    const pathname = buildTemporaryBlobPath(SESSION_ID, 'ROPA', kind, 'image/jpeg');
    assert.equal(pathname, `altas-temporales/${SESSION_ID}/ROPA/${expectedSegments[kind]}.jpg`);
    assert.equal(assertSessionBlobPath(pathname, SESSION_ID, 'ROPA', kind), pathname);
    assert.equal(parseTemporaryBlobPath(pathname).kind, kind);
  }
});

test('rechaza path traversal en una imagen de ropa', () => {
  assert.throws(
    () => assertSessionBlobPath(`altas-temporales/${SESSION_ID}/ROPA/../etiqueta-prenda.jpg`, SESSION_ID, 'ROPA', 'etiquetaRopa'),
    /no es válida/
  );
});

test('ropa sin etiquetaRopa devuelve el error de validación correspondiente', () => {
  const request = clothingAnalyzeRequest();
  delete request.imagenes.etiquetaRopa;
  const result = analyzeRequestSchema.safeParse(request);
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.issues[0]?.message ?? '', /etiquetaRopa/);
});

test('ropa sin prendaCompleta devuelve el error de validación correspondiente', () => {
  const request = clothingAnalyzeRequest();
  delete request.imagenes.prendaCompleta;
  const result = analyzeRequestSchema.safeParse(request);
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.issues[0]?.message ?? '', /prendaCompleta/);
});

test('analyze de ropa enruta sus tres paths válidos sin error 400', async () => {
  const request = clothingAnalyzeRequest();
  const extracted = modelFixture();
  extracted.producto.tipoProducto = 'ROPA';
  let receivedKinds: string[] = [];
  const result = await analyzeProductPhotos(request, {
    imageReader: (async (
      sessionId: Parameters<typeof readPrivateSessionImages>[0],
      productKind: Parameters<typeof readPrivateSessionImages>[1],
      pathnames: Parameters<typeof readPrivateSessionImages>[2]
    ) => CLOTHING_SOURCE_IMAGE_KINDS.map((kind) => {
      const pathname = assertSessionBlobPath(pathnames[kind] ?? '', sessionId, productKind, kind);
      return { kind, dataUrl: `data:image/jpeg;base64,${pathname}` };
    })) as never,
    extractor: async (images) => {
      receivedKinds = images.map(({ kind }) => kind);
      return extracted;
    },
    duplicateDatabase: { execute: async () => ({ rows: [] }) } as never
  });
  assert.deepEqual(receivedKinds, ['etiquetaRopa', 'ticket', 'prendaCompleta']);
  assert.equal(result.detection.productKind, 'ROPA');
});

test('las rutas Blob impiden mezclar kinds de ropa y calzado', () => {
  assert.throws(() => buildTemporaryBlobPath(SESSION_ID, 'ROPA', 'caja', 'image/jpeg'), /no corresponde/);
  assert.match(buildTemporaryBlobPath(SESSION_ID, 'ROPA', 'etiquetaRopa', 'image/jpeg'), /\/ROPA\/etiqueta-prenda\.jpg$/);
});

test('el contrato rechaza fotos mezcladas entre tipos', () => {
  const request = analyzeRequest();
  request.imagenes.etiquetaRopa = { pathname: buildTemporaryBlobPath(SESSION_ID, 'ROPA', 'etiquetaRopa', 'image/jpeg') };
  assert.equal(analyzeRequestSchema.safeParse(request).success, false);
});

test('la ausencia de lateral no bloquea Analizar', () => {
  const input = analyzeRequest();
  assert.equal('referenciaLateral' in input.imagenes, false);
  assert.equal(analyzeRequestSchema.safeParse(input).success, true);
});

test('la ausencia de vista trasera no bloquea Analizar', () => {
  const input = analyzeRequest();
  assert.equal('referenciaTrasera' in input.imagenes, false);
  assert.equal(analyzeRequestSchema.safeParse(input).success, true);
});

test('Structured Output de detección solo contiene las tres fotos de datos', () => {
  const parsed = modelProductDetectionSchema.parse(modelFixture());
  assert.deepEqual(Object.keys(parsed.imagenes), ['caja', 'ticket', 'etiqueta']);
});

test('cada tarjeta recibe su guía estática correcta desde public', async () => {
  const page = await readFile(new URL('../src/pages/anadir/fotos.astro', import.meta.url), 'utf8');
  for (const asset of [
    'caja.png',
    'ticket.png',
    'etiqueta-zapatilla.png',
    'perfil-lateral.png',
    'vista-trasera.png'
  ]) {
    assert.match(page, new RegExp(`/onboarding/product-photo-guide/${asset.replace('.', '\\.')}"`));
  }
});

test('la página empieza con selector de Calzado o Ropa y oculta inicialmente las fotos', async () => {
  const page = await readFile(new URL('../src/pages/anadir/fotos.astro', import.meta.url), 'utf8');
  assert.match(page, /data-step="kind"/);
  assert.match(page, /data-select-kind="CALZADO"/);
  assert.match(page, /data-select-kind="ROPA"/);
  assert.match(page, /data-step="photos" class="hidden"/);
  assert.match(page, /data-change-kind/);
});

test('la tarjeta ticket se resuelve dentro del flujo activo para no actualizar la tarjeta oculta', async () => {
  const page = await readFile(new URL('../src/pages/anadir/fotos.astro', import.meta.url), 'utf8');
  assert.match(page, /activeProductFlow\?\.querySelector<HTMLElement>/);
  assert.ok(page.includes('`[data-product-flow="${productKind}"]`'));
  assert.equal((page.match(/<PhotoUploadCard id="ticket"/g) ?? []).length, 2);
});

test('la revisión aprueba valores editados mediante endpoint server-side y muestra éxito', async () => {
  const page = await readFile(new URL('../src/pages/anadir/fotos.astro', import.meta.url), 'utf8');
  assert.match(page, /fetch\('\/api\/product-detection\/approve'/);
  assert.match(page, /const fieldValue =/);
  assert.match(page, /Producto añadido al stock/);
  assert.match(page, /data-success-publish-link/);
  assert.match(page, /Esta variante ya existe\. Al aprobar se añadirán/);
  assert.match(page, /Stock actual:/);
  assert.match(page, /Después de aprobar:/);
  assert.match(page, /duplicates\.conflict/);
});

test('la pantalla posterior al alta solo ofrece preparar publicación o volver al stock', async () => {
  const page = await readFile(new URL('../src/pages/anadir/fotos.astro', import.meta.url), 'utf8');
  assert.match(page, /¿Quieres preparar ahora la publicación\?/);
  assert.match(page, />Preparar publicación<\/a>/);
  assert.match(page, /href="\/stock"[^>]*>Volver al stock<\/a>/);
  assert.doesNotMatch(page, />Ver producto<\/a>/);
  assert.doesNotMatch(page, />Añadir otro producto<\/a>/);
});

test('Preparar publicación navega con el productId devuelto por approve', async () => {
  const page = await readFile(new URL('../src/pages/anadir/fotos.astro', import.meta.url), 'utf8');
  assert.match(page, /`\/contenido\/\$\{encodeURIComponent\(data\.productId\)\}`/);
  assert.doesNotMatch(page, /contenido\/\$\{.*sessionId/);
});

test('/contenido/[id] carga el producto real y no importa mocks', async () => {
  const page = await readFile(new URL('../src/pages/contenido/[id].astro', import.meta.url), 'utf8');
  assert.match(page, /import \{ getProductDetail \} from '\.\.\/\.\.\/lib\/inventory\/queries\.ts'/);
  assert.match(page, /await getProductDetail\(Astro\.params\.id\)/);
  assert.match(page, /product\.variants/);
  assert.match(page, /product\.stock/);
  assert.doesNotMatch(page, /mockProducts|mockStockStats|lib\/mock/);
});

test('/contenido/[id] responde 404 con estado humano cuando no existe', async () => {
  const page = await readFile(new URL('../src/pages/contenido/[id].astro', import.meta.url), 'utf8');
  assert.match(page, /Astro\.response\.status = 404/);
  assert.match(page, /Producto no encontrado/);
  assert.match(page, /Volver al stock/);
});

test('la ficha muestra CM como dato secundario solo cuando existe', async () => {
  const page = await readFile(new URL('../src/pages/anadir/fotos.astro', import.meta.url), 'utf8');
  assert.match(page, /data-foot-length/);
  assert.match(page, /Longitud del pie:/);
  assert.match(page, /equivalenciasTalla\.CM/);
  assert.match(page, /detection\.productKind === 'CALZADO'/);
});

test('PhotoUploadCard diferencia la guía vacía de la preview Tu foto', async () => {
  const component = await readFile(new URL('../src/components/ui/PhotoUploadCard.astro', import.meta.url), 'utf8');
  assert.match(component, /data-photo-empty data-photo-example/);
  assert.match(component, />Ejemplo</);
  assert.match(component, /data-photo-preview/);
  assert.match(component, />Tu foto</);
});

test('el flujo nuevo elimina el naming de vista 3/4', async () => {
  const sources = await Promise.all([
    '../src/pages/anadir/fotos.astro',
    '../src/components/ui/PhotoUploadCard.astro',
    '../src/lib/product-detection/config.ts',
    '../src/lib/product-detection/content-status.ts'
  ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  assert.ok(sources.every((source) => !/referenciaTresCuartos|referencia-tres-cuartos|Vista 3\/4/i.test(source)));
});

test('no se solicitan ni suben referencias cuando el usuario elige Ahora no', () => {
  const state = generationReferenceState({
    checked: true,
    hasGenerationReferences: false,
    hasGeneratedImages: false,
    generatedImageCount: 0
  }, 'SKIP');
  assert.equal(state.requested, false);
  assert.deepEqual(state.requiredKinds, []);
  assert.deepEqual(state.images, {});
  assert.equal(canContinueProductFlow('SKIP'), true);
});

test('un producto con imágenes existentes no pide referencias al reutilizarlas', () => {
  const state = generationReferenceState({
    checked: true,
    hasGenerationReferences: false,
    hasGeneratedImages: true,
    generatedImageCount: 8
  }, 'USE_EXISTING');
  assert.equal(state.requested, false);
  assert.deepEqual(state.requiredKinds, []);
  assert.equal(canContinueProductFlow('USE_EXISTING'), true);
});

test('un producto sin imágenes ofrece el estado de generación opcional', () => {
  const state = generationReferenceState({
    checked: true,
    hasGenerationReferences: false,
    hasGeneratedImages: false,
    generatedImageCount: 0
  }, 'UNDECIDED');
  assert.equal(state.requested, false);
  assert.deepEqual(state.requiredKinds, []);
});

test('Generar nuevas muestra y exige lateral y vista trasera', () => {
  const state = generationReferenceState({
    checked: true,
    hasGenerationReferences: false,
    hasGeneratedImages: true,
    generatedImageCount: 8
  }, 'GENERATE_NEW');
  assert.equal(state.requested, true);
  assert.deepEqual(state.requiredKinds, ['referenciaLateral', 'referenciaTrasera']);
  assert.equal(state.ready, false);
});

test('Generar nuevas para ropa exige frontal y trasera', () => {
  const state = generationReferenceState({
    checked: true, hasGenerationReferences: false, hasGeneratedImages: false, generatedImageCount: 0
  }, 'GENERATE_NEW', {}, 'ROPA');
  assert.deepEqual(state.requiredKinds, ['referenciaFrontal', 'referenciaTrasera']);
  assert.equal(state.ready, false);
});

test('referencias maestras existentes evitan pedir lateral y vista trasera', () => {
  const state = generationReferenceState({
    checked: true,
    hasGenerationReferences: true,
    hasGeneratedImages: true,
    generatedImageCount: 8
  }, 'GENERATE_NEW');
  assert.deepEqual(state.requiredKinds, []);
  assert.equal(state.ready, true);
});

test('OpenAI recibe solo caja, ticket y etiqueta y no llama a Image API', async () => {
  let imageApiCalls = 0;
  const client = {
    responses: { parse: async () => ({ output_parsed: modelFixture(), usage: undefined }) },
    images: { generate: async () => { imageApiCalls += 1; } }
  } as unknown as OpenAI;
  await extractProductWithOpenAI(OPENAI_IMAGES, 'CALZADO', { client, apiKey: 'test', model: 'test-model' });
  assert.equal(imageApiCalls, 0);
  await assert.rejects(
    extractProductWithOpenAI(OPENAI_IMAGES.slice(0, 2), 'CALZADO', { apiKey: 'test', model: 'test-model' }),
    (error: Error & { code?: string }) => error.code === 'FALTAN_IMAGENES'
  );
});

test('OpenAI de ropa recibe solo sus tres kinds y usa instrucciones específicas', async () => {
  let instructions = '';
  const clothingOutput = modelFixture();
  clothingOutput.producto.tipoProducto = 'ROPA';
  const client = {
    responses: { parse: async (request: { instructions: string }) => { instructions = request.instructions; return { output_parsed: clothingOutput, usage: undefined }; } }
  } as unknown as OpenAI;
  const images = sourceDataImageKinds('ROPA').map((kind) => ({ kind, dataUrl: 'data:image/jpeg;base64,/9j/' }));
  await extractProductWithOpenAI(images, 'ROPA', { client, apiKey: 'test', model: 'test-model' });
  assert.match(instructions, /tienda de ropa/);
  assert.match(instructions, /producto\.tipoProducto debe ser ROPA/);
});

test('los assets de detección no mezclan referencias de generación', () => {
  const request = analyzeRequestSchema.parse(analyzeRequest());
  const groups = groupTemporarySourceDataAssets(request, reconcileProductDetection(modelFixture()));
  assert.deepEqual(Object.keys(groups.sourceDataImages), ['caja', 'ticket', 'etiqueta']);
  assert.equal('generationReferenceImages' in groups, false);
});

test('el fingerprint visual es SHA-256 estable de marca, referencia y colorway', () => {
  const first = visualContentFingerprint({
    marca: ' Nike ', referencia: 'IR0871 400', colorway: 'Hydrogen Blue / Football Grey'
  });
  const second = visualContentFingerprint({
    marca: 'nike', referencia: 'IR0871-400', colorway: 'hydrogen blue / football grey'
  });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
});

test('una talla diferente reutiliza la misma identidad visual', () => {
  const size42 = reconcileProductDetection(modelFixture());
  const size43Fixture = modelFixture();
  size43Fixture.variante.tallaOriginal = 'EUR 43';
  size43Fixture.observaciones.caja.talla = 'EUR 43';
  size43Fixture.observaciones.etiqueta.talla = '43';
  const size43 = reconcileProductDetection(size43Fixture);
  const noDuplicate = { checked: true, productExists: false, productId: null, variantExists: false, variantId: null };
  assert.deepEqual(resolveVisualContentIdentity(size42, noDuplicate), resolveVisualContentIdentity(size43, noDuplicate));
});

test('contentStatus cuenta generadas y distingue las dos referencias con SELECT', async () => {
  const statements: string[] = [];
  const database = {
    execute: async (statement: string | { sql: string }) => {
      const sql = typeof statement === 'string' ? statement : statement.sql;
      statements.push(sql.trim());
      return { rows: [{ generated_image_count: 8, generation_reference_count: 2 }] };
    }
  };
  const status = await checkExistingContent(
    reconcileProductDetection(modelFixture()),
    { checked: true, productExists: true, productId: 'product-1', variantExists: false, variantId: null },
    database as never
  );
  assert.deepEqual(status, {
    checked: true,
    hasGenerationReferences: true,
    hasGeneratedImages: true,
    generatedImageCount: 8
  });
  const fingerprintStatus = await checkExistingContent(
    reconcileProductDetection(modelFixture()),
    { checked: true, productExists: false, productId: null, variantExists: false, variantId: null },
    database as never
  );
  assert.equal(fingerprintStatus.generatedImageCount, 8);
  assert.match(statements[1], /b\.huella_origen = \?/);
  assert.ok(statements.every((sql) => sql.startsWith('SELECT')));
  assert.ok(statements.every((sql) => !/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)));
});
