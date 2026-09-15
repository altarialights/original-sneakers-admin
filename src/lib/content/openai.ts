import { createHash } from 'node:crypto';
import OpenAI, { toFile } from 'openai';
import { z } from 'zod';
import { zodTextFormat } from 'openai/helpers/zod';
import { ANGLE_LABELS, CONTENT_GENERATION_TIMEOUT_MS, getContentOpenAIConfig, OPENAI_IMAGE_QUALITY } from './config.ts';
import { ContentError } from './errors.ts';
import { publicationTextsSchema } from './schemas.ts';
import { publicSizeFacts } from './formatters.ts';
import { PUBLICATION_TEXT_FIELDS, type GeneratedImage, type GeneratedImageBatch, type ImageGenerationRequest, type ImageReferenceInput, type PublicationProduct, type PublicationTextField, type PublicationTexts } from './types.ts';

const TEXT_FIELD_GUIDANCE: Record<PublicationTextField, string> = {
  tituloComercial: 'Título limpio con marca, modelo y color o género cuando aporten. Sin emojis, slogans, envío, precio ni talla salvo que exista una única variante relevante.',
  descripcionCompleta: 'Un único bloque de texto plano listo para publicar que integre introducción, características confirmadas, autenticidad, dato curioso solo si es seguro y envíos.',
  seoTitle: 'SEO title corto y natural con marca, modelo y color o género cuando aporten; termina con | Original Sneakers. Talla EU solo si la ficha representa una talla concreta.',
  metaDescription: 'Entre 140 y 160 caracteres cuando sea razonable; menciona marca, modelo, color y que el producto es original y nuevo con intención comercial natural.'
};

function productFacts(product: PublicationProduct): Record<string, unknown> {
  return {
    marca: product.brand,
    modelo: product.model,
    referencia: product.reference,
    color: product.colorway,
    tipo: product.type,
    subtipo: product.subtype,
    estadoCatalogo: product.stateLabel,
    stock: product.stock,
    tallasPublicas: publicSizeFacts(product).map((size) => ({
      etiqueta: size.label,
      talla: size.size,
      sistema: size.sizeSystem,
      genero: size.gender,
      longitudPieCm: size.footLengthCm
    }))
  };
}

function editorialInstructions(fields: PublicationTextField[], productType: string): string {
  const descriptionStructure = productType === 'ROPA'
    ? `Para descripcionCompleta de ROPA usa exactamente esta filosofía y orden:
👕 {Marca} {Modelo}

{Párrafo comercial natural de 2-4 frases}

📋 CARACTERÍSTICAS
• {solo características de prenda confirmadas: tipo, corte o manga visible, color, gráfico y uso}

✅ AUTENTICIDAD GARANTIZADA
• Producto 100 % original {Marca}
• Nueva a estrenar

🤓 DATO CURIOSO
{Incluye este bloque completo únicamente si existe un dato razonablemente seguro; si no, omítelo sin explicación}

🚚 ENVÍOS NACIONALES
• Gratis en pedidos superiores a 59,90€
• Pedidos inferiores a 59,90€, coste 3,90€
• Entrega en 48 - 72 horas
Nunca uses CM ni vocabulario de amortiguación en ropa.`
    : `Para descripcionCompleta de CALZADO sigue siempre este orden:
👟 {Marca} {Modelo}

{Párrafo comercial natural de 2-4 frases; puede incluir 📏 Talla: EU - CM cuando aporte valor}

📋 CARACTERÍSTICAS TÉCNICAS
• {solo características suficientemente confirmadas}

✅ AUTENTICIDAD GARANTIZADA
• Producto 100 % original {Marca}
• Nuevas a estrenar

🤓 DATO CURIOSO
{Incluye este bloque completo únicamente si existe un dato razonablemente seguro; si no, omítelo sin explicación}

🚚 ENVÍOS NACIONALES
• Gratis en pedidos superiores a 59,90€
• Pedidos inferiores a 59,90€, coste 3,90€
• Entrega en 48 - 72 horas`;
  return `Eres editor comercial de una tienda española especializada en sneakers y moda original.
Genera únicamente los campos solicitados en español de España.
Usa solo los hechos suministrados. No inventes materiales exactos, tecnologías, colaboraciones ni años de lanzamiento.
No uses coste, proveedor, metadata interna ni UPC/GTIN.
Las características deben aportar valor real. No uses marca, modelo, referencia o color como falsas características técnicas.
Puedes mencionar upper, mediasuela, amortiguación, suela, cierre, transpirabilidad, uso o ajuste únicamente cuando estén confirmados por los datos o sean inequívocos en las imágenes. Es mejor incluir cuatro características correctas que ocho inventadas.
El bloque DATO CURIOSO es opcional: inclúyelo solo ante información razonablemente segura sobre la línea, familia, diseño, tecnología conocida o contexto histórico. No inventes ni escribas que no se encontró información.
Para calzado usa exclusivamente las tallasPublicas suministradas: EU es principal y CM, si aparece en la misma entrada, es secundario. No conviertas ni introduzcas US si hay EU. Para ropa nunca muestres CM.
Adapta el género únicamente si se conoce. El tipo actual es ${productType}.
${descriptionStructure}
Devuelve texto plano: no uses Markdown, asteriscos, almohadillas ni guiones como viñetas. Usa el carácter •.
Evita clichés vacíos como “un modelo con personalidad”, “una opción ideal”, “estilo contemporáneo” o “presencia llamativa”.
Política confirmada: producto 100 % original y nuevo a estrenar. Envíos nacionales gratis desde 59,90 €; por debajo, 3,90 €; entrega estimada 48–72 horas.

Campos pedidos:
${fields.map((field) => `- ${field}: ${TEXT_FIELD_GUIDANCE[field]}`).join('\n')}`;
}

function assertCompleteDescription(description: string, productType: string): void {
  const requiredSections = productType === 'ROPA'
    ? ['👕 ', '📋 CARACTERÍSTICAS', '✅ AUTENTICIDAD GARANTIZADA', '🚚 ENVÍOS NACIONALES']
    : ['👟 ', '📋 CARACTERÍSTICAS TÉCNICAS', '✅ AUTENTICIDAD GARANTIZADA', '🚚 ENVÍOS NACIONALES'];
  const hasRequiredStructure = requiredSections.every((section) => description.includes(section));
  const curiousFact = description.match(/🤓 DATO CURIOSO\s*([\s\S]*?)(?=🚚 ENVÍOS NACIONALES|$)/u)?.[1]?.trim();
  if (!hasRequiredStructure || (description.includes('🤓 DATO CURIOSO') && !curiousFact)) {
    throw new ContentError(
      'La descripción generada no respetó la estructura editorial completa. Vuelve a intentarlo.',
      'OPENAI_FORMATO_TEXTO',
      502
    );
  }
}

function publicOpenAIContentError(error: unknown, kind: 'imágenes' | 'textos'): ContentError {
  const candidate = error && typeof error === 'object' ? error as { status?: number; name?: string } : {};
  if (candidate.status === 401) return new ContentError('No hemos podido autenticar el servicio de generación.', 'OPENAI_AUTH', 503);
  if (candidate.status === 429) return new ContentError('La generación ha alcanzado temporalmente su límite. Inténtalo de nuevo en unos minutos.', 'OPENAI_LIMITE', 429);
  if (candidate.status && candidate.status >= 500) return new ContentError(`OpenAI ha tenido un error temporal al generar ${kind}.`, 'OPENAI_TEMPORAL', 502);
  return new ContentError(`No hemos podido generar los ${kind}. Inténtalo de nuevo.`, 'OPENAI_ERROR', 502);
}

type OpenAIErrorDetails = {
  className: string;
  status: number | null;
  code: string;
  type: string;
  param: string;
  message: string;
  requestId: string;
};

type OpenAIErrorCandidate = {
  constructor?: { name?: string };
  name?: unknown;
  status?: unknown;
  code?: unknown;
  type?: unknown;
  param?: unknown;
  message?: unknown;
  request_id?: unknown;
  requestId?: unknown;
  headers?: { get?: (name: string) => string | null };
};

function cleanLogValue(value: unknown, fallback = 'n/a', maxLength = 500): string {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value).replace(/[\r\n\t]+/g, ' ').slice(0, maxLength);
}

function openAIErrorDetails(error: unknown): OpenAIErrorDetails {
  const candidate: OpenAIErrorCandidate = error && typeof error === 'object' ? error as OpenAIErrorCandidate : {};
  const numericStatus = Number(candidate.status);
  return {
    className: cleanLogValue(candidate.constructor?.name ?? candidate.name ?? typeof error),
    status: Number.isInteger(numericStatus) && numericStatus > 0 ? numericStatus : null,
    code: cleanLogValue(candidate.code),
    type: cleanLogValue(candidate.type),
    param: cleanLogValue(candidate.param),
    message: cleanLogValue(candidate.message ?? error),
    requestId: cleanLogValue(candidate.request_id ?? candidate.requestId ?? candidate.headers?.get?.('x-request-id'))
  };
}

function logOpenAIImageError(
  error: unknown,
  context: { index: number; angle: string; model: string; quality: string; durationMs: number; attempt: 'concurrent' | 'sequential-fallback'; lateral: boolean; rear: boolean }
): OpenAIErrorDetails {
  const details = openAIErrorDetails(error);
  console.error(`[content-images] openai:error index=${context.index + 1} angle=${context.angle} class=${details.className} status=${details.status ?? 'n/a'} code=${details.code} type=${details.type} param=${details.param} requestId=${details.requestId} durationMs=${context.durationMs} model=${context.model} quality=${context.quality} attempt=${context.attempt} lateralReference=${context.lateral} rearReference=${context.rear} message=${JSON.stringify(details.message)}`);
  return details;
}

function shouldRetrySequentially(error: unknown): boolean {
  if (error instanceof ContentError) return false;
  const { status } = openAIErrorDetails(error);
  return status === null || status === 408 || status === 409 || status === 429 || status >= 500;
}

export async function generatePublicationTextsWithOpenAI(
  product: PublicationProduct,
  fields: PublicationTextField[] = [...PUBLICATION_TEXT_FIELDS],
  referenceDataUrls: string[] = [],
  options: { client?: OpenAI; apiKey?: string; model?: string; timeoutMs?: number } = {}
): Promise<{ texts: Partial<PublicationTexts>; model: string; promptHash: string }> {
  const config = options.apiKey && options.model
    ? { apiKey: options.apiKey, textModel: options.model }
    : await getContentOpenAIConfig();
  const model = options.model ?? config.textModel;
  const client = options.client ?? new OpenAI({ apiKey: config.apiKey, maxRetries: 0, timeout: options.timeoutMs ?? CONTENT_GENERATION_TIMEOUT_MS });
  const requestedShape = Object.fromEntries(fields.map((field) => [field, publicationTextsSchema.shape[field].min(1, 'El campo no puede estar vacío.')])) as Record<PublicationTextField, z.ZodString>;
  const outputSchema = z.object(requestedShape);
  const facts = JSON.stringify(productFacts(product));
  const promptHash = createHash('sha256').update(`${model}\n${fields.join(',')}\n${facts}`, 'utf8').digest('hex');
  const content: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: 'high' }> = [
    { type: 'input_text', text: `DATOS CONFIRMADOS DEL PRODUCTO:\n${facts}` }
  ];
  for (const dataUrl of referenceDataUrls.slice(0, 3)) content.push({ type: 'input_image', image_url: dataUrl, detail: 'high' });
  const startedAt = performance.now();
  console.info(`[content-generation] text:start model=${model} fields=${fields.join(',')}`);
  try {
    const response = await client.responses.parse({
      model,
      store: false,
      instructions: editorialInstructions(fields, product.type),
      input: [{ role: 'user', content }],
      text: {
        format: zodTextFormat(outputSchema, 'publication_content', {
          description: 'Bloques editoriales de la ficha de producto solicitados por el usuario.'
        }),
        verbosity: 'medium'
      }
    }, { timeout: options.timeoutMs ?? CONTENT_GENERATION_TIMEOUT_MS });
    const parsed = outputSchema.parse(response.output_parsed) as Partial<PublicationTexts>;
    if (parsed.descripcionCompleta) assertCompleteDescription(parsed.descripcionCompleta, product.type);
    const usage = response.usage;
    console.info(`[content-generation] text:completed durationMs=${Math.round(performance.now() - startedAt)} model=${model} inputTokens=${usage?.input_tokens ?? 'n/a'} outputTokens=${usage?.output_tokens ?? 'n/a'} totalTokens=${usage?.total_tokens ?? 'n/a'} estimatedCostUsd=n/a`);
    return { texts: parsed, model, promptHash };
  } catch (error) {
    console.error(`[content-generation] text:error durationMs=${Math.round(performance.now() - startedAt)} model=${model}`);
    if (error instanceof ContentError) throw error;
    throw publicOpenAIContentError(error, 'textos');
  }
}

function imagePrompt(product: PublicationProduct, angle: string, references: ImageReferenceInput[]): string {
  const kind = product.type === 'ROPA' ? 'prenda' : 'calzado';
  const referenceInstructions = references.length === 0 ? '' : `
Referencias visuales obligatorias: la imagen 1 es la vista LATERAL real y la imagen 2 es la vista TRASERA real del mismo producto. Mantén exactamente su silueta, colorway, logos, materiales aparentes, forma de la mediasuela y detalles específicos visibles del modelo. No sustituyas ni reinterpretes el producto por otro modelo parecido.`;
  return `Fotografía ecommerce premium, realista y consistente de ${kind}.
Producto: ${product.brand} ${product.model}; referencia ${product.reference}; color ${product.colorway ?? 'no especificado'}.
Vista solicitada: ${ANGLE_LABELS[angle] ?? angle}.${referenceInstructions}
Fondo blanco o gris muy claro, iluminación de estudio suave, producto completo como protagonista, escala natural, detalle nítido, sin personas, sin atrezo, sin texto añadido, sin cambiar logos, colores ni diseño. Una sola vista del producto.`;
}

export const IMAGE_GENERATION_CONCURRENCY = 3;

const MAX_OPENAI_REFERENCE_BYTES = 15 * 1024 * 1024;
const OPENAI_REFERENCE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function hasReferenceSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.byteLength >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/webp') return isWebP(bytes);
  return false;
}

function prepareOpenAIReferences(product: PublicationProduct, references: ImageReferenceInput[]): Array<{ bytes: Buffer; mimeType: string; role: ImageReferenceInput['role'] }> {
  const byRole = new Map(references.map((reference) => [reference.role, reference]));
  if (product.type === 'CALZADO' && (!byRole.has('REFERENCIA_LATERAL') || !byRole.has('REFERENCIA_TRASERA'))) {
    throw new ContentError('No podemos generar imágenes de calzado sin las referencias visuales lateral y trasera.', 'REFERENCIAS_REQUERIDAS', 422);
  }
  return (['REFERENCIA_LATERAL', 'REFERENCIA_TRASERA'] as const).flatMap((role) => {
    const reference = byRole.get(role);
    if (!reference) return [];
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(reference.dataUrl);
    if (!match || !OPENAI_REFERENCE_MIMES.has(match[1])) {
      throw new ContentError('Una referencia visual no tiene un formato compatible.', 'REFERENCIA_FORMATO', 422);
    }
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_OPENAI_REFERENCE_BYTES || !hasReferenceSignature(bytes, match[1])) {
      throw new ContentError('Una referencia visual no contiene una imagen utilizable.', 'REFERENCIA_INVALIDA', 422);
    }
    return [{ bytes, mimeType: match[1], role }];
  });
}

function supportsConfigurableInputFidelity(model: string): boolean {
  return model !== 'gpt-image-2' && !/^gpt-image-2-\d{4}-\d{2}-\d{2}$/.test(model);
}

export async function generatePublicationImagesWithOpenAI(
  product: PublicationProduct,
  request: ImageGenerationRequest,
  references: ImageReferenceInput[] = [],
  options: { client?: OpenAI; apiKey?: string; model?: string; timeoutMs?: number; fetcher?: typeof fetch } = {}
): Promise<GeneratedImageBatch> {
  const config = options.apiKey && options.model
    ? { apiKey: options.apiKey, imageModel: options.model }
    : await getContentOpenAIConfig();
  const model = options.model ?? config.imageModel;
  const client = options.client ?? new OpenAI({ apiKey: config.apiKey, maxRetries: 0, timeout: options.timeoutMs ?? CONTENT_GENERATION_TIMEOUT_MS });
  const quality = OPENAI_IMAGE_QUALITY[request.quality];
  const indexedOutputs: Array<{ index: number; image: GeneratedImage }> = [];
  const failures: GeneratedImageBatch['failures'] = [];
  const startedAll = performance.now();
  console.info(`[content-images] generate:start model=${model} requested=${request.quantity} quality=${quality} concurrency=${IMAGE_GENERATION_CONCURRENCY}`);
  try {
    const sourceAssets = prepareOpenAIReferences(product, references);
    const hasLateral = sourceAssets.some((asset) => asset.role === 'REFERENCIA_LATERAL');
    const hasRear = sourceAssets.some((asset) => asset.role === 'REFERENCIA_TRASERA');
    const tasks = Array.from({ length: request.quantity }, (_, index) => ({
      index,
      angle: request.angles[index % request.angles.length]
    }));
    const generateOne = async ({ index, angle }: typeof tasks[number], attempt: 'concurrent' | 'sequential-fallback') => {
      const startedAt = performance.now();
      try {
        const prompt = imagePrompt(product, angle, references);
        const common = {
          model,
          prompt,
          n: 1,
          quality,
          size: '1024x1024' as const,
          output_format: 'webp' as const,
          output_compression: 90,
          background: 'opaque' as const
        };
        const sourceFiles = await Promise.all(sourceAssets.map(({ bytes, mimeType, role }) => toFile(
          bytes,
          role === 'REFERENCIA_LATERAL' ? `referencia-lateral.${mimeType.split('/')[1] ?? 'webp'}` : `referencia-trasera.${mimeType.split('/')[1] ?? 'webp'}`,
          { type: mimeType }
        )));
        const editRequest = { ...common, image: sourceFiles } as Parameters<typeof client.images.edit>[0];
        if (supportsConfigurableInputFidelity(model)) editRequest.input_fidelity = 'high';
        const response = sourceFiles.length > 0
          ? await client.images.edit(editRequest, { timeout: options.timeoutMs ?? CONTENT_GENERATION_TIMEOUT_MS })
          : await client.images.generate(common, { timeout: options.timeoutMs ?? CONTENT_GENERATION_TIMEOUT_MS });
        console.info(`[content-images] openai:completed index=${index + 1} angle=${angle} durationMs=${Math.round(performance.now() - startedAt)} attempt=${attempt}`);
        const asset = (response as { data?: Array<{ b64_json?: string; url?: string }> }).data?.[0];
        console.info(`[content-images] asset:decode:start index=${index + 1} angle=${angle}`);
        const bytes = await decodeGeneratedImageAsset(asset, options.fetcher ?? fetch);
        console.info(`[content-images] asset:decode:completed index=${index + 1} angle=${angle} bytes=${bytes.byteLength} mime=image/webp`);
        return {
          index,
          image: {
            bytes,
            mimeType: 'image/webp',
            angle,
            quality: request.quality,
            model,
            durationMs: Math.round(performance.now() - startedAt),
            providerId: null,
            promptHash: createHash('sha256').update(prompt, 'utf8').digest('hex')
          } satisfies GeneratedImage
        };
      } catch (error) {
        logOpenAIImageError(error, {
          index, angle, model, quality, attempt,
          durationMs: Math.round(performance.now() - startedAt), lateral: hasLateral, rear: hasRear
        });
        throw error;
      }
    };
    for (let offset = 0; offset < tasks.length; offset += IMAGE_GENERATION_CONCURRENCY) {
      const taskBatch = tasks.slice(offset, offset + IMAGE_GENERATION_CONCURRENCY);
      const batchStartedAt = performance.now();
      const settled = await Promise.allSettled(taskBatch.map((task) => generateOne(task, 'concurrent')));
      const retryTasks: typeof tasks = [];
      settled.forEach((result, batchIndex) => {
        const task = taskBatch[batchIndex];
        if (result.status === 'fulfilled') {
          indexedOutputs.push(result.value);
          return;
        }
        if (shouldRetrySequentially(result.reason)) {
          retryTasks.push(task);
          return;
        }
        const contentError = result.reason instanceof ContentError ? result.reason : publicOpenAIContentError(result.reason, 'imágenes');
        const stage = contentError.code.startsWith('IMAGEN_') || contentError.code === 'OPENAI_IMAGEN_VACIA' ? 'DECODE' : 'OPENAI';
        failures.push({ angle: task.angle, stage, message: contentError.message });
        console.error(`[content-images] generate:failed index=${task.index + 1} angle=${task.angle} stage=${stage} code=${contentError.code}`);
      });
      for (const task of retryTasks) {
        console.info(`[content-images] openai:fallback index=${task.index + 1} angle=${task.angle} mode=sequential attempt=1`);
        try {
          indexedOutputs.push(await generateOne(task, 'sequential-fallback'));
        } catch (error) {
          const contentError = error instanceof ContentError ? error : publicOpenAIContentError(error, 'imágenes');
          const stage = contentError.code.startsWith('IMAGEN_') || contentError.code === 'OPENAI_IMAGEN_VACIA' ? 'DECODE' : 'OPENAI';
          failures.push({ angle: task.angle, stage, message: contentError.message });
          console.error(`[content-images] generate:failed index=${task.index + 1} angle=${task.angle} stage=${stage} code=${contentError.code} fallbackExhausted=true`);
        }
      }
      console.info(`[content-images] openai:batch-completed batch=${Math.floor(offset / IMAGE_GENERATION_CONCURRENCY) + 1} batchSize=${taskBatch.length} batchDurationMs=${Math.round(performance.now() - batchStartedAt)}`);
    }
    const outputs = indexedOutputs.sort((a, b) => a.index - b.index).map(({ image }) => image);
    console.info(`[content-images] openai:completed batchDurationMs=${Math.round(performance.now() - startedAll)} model=${model} requested=${request.quantity} generated=${outputs.length} failed=${failures.length} concurrency=${IMAGE_GENERATION_CONCURRENCY}`);
    return { images: outputs, failures };
  } catch (error) {
    console.error(`[content-images] generate:failed batchDurationMs=${Math.round(performance.now() - startedAll)} model=${model} generated=${indexedOutputs.length} stage=OPENAI concurrency=${IMAGE_GENERATION_CONCURRENCY}`);
    if (error instanceof ContentError) throw error;
    throw publicOpenAIContentError(error, 'imágenes');
  }
}

const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;

function isWebP(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12
    && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP';
}

export async function decodeGeneratedImageAsset(
  asset: { b64_json?: string; url?: string } | undefined,
  fetcher: typeof fetch = fetch
): Promise<Uint8Array> {
  let bytes: Uint8Array;
  if (asset?.b64_json) {
    const encoded = asset.b64_json.trim();
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
      throw new ContentError('La imagen generada llegó con una codificación no válida. Puedes reintentar solo esta vista.', 'IMAGEN_BASE64_INVALIDA', 502);
    }
    bytes = Uint8Array.from(Buffer.from(encoded, 'base64'));
  } else if (asset?.url) {
    let response: Response;
    try {
      response = await fetcher(asset.url);
    } catch {
      throw new ContentError('No se pudo descargar una imagen generada. Puedes reintentar solo esta vista.', 'IMAGEN_URL_NO_DISPONIBLE', 502);
    }
    if (!response.ok) throw new ContentError('No se pudo descargar una imagen generada. Puedes reintentar solo esta vista.', 'IMAGEN_URL_NO_DISPONIBLE', 502);
    bytes = new Uint8Array(await response.arrayBuffer());
  } else {
    throw new ContentError('OpenAI no devolvió una imagen utilizable. Puedes reintentar solo esta vista.', 'OPENAI_IMAGEN_VACIA', 502);
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_GENERATED_IMAGE_BYTES) {
    throw new ContentError('La imagen generada tiene un tamaño no válido. Puedes reintentar solo esta vista.', 'IMAGEN_TAMANO_INVALIDO', 502);
  }
  if (!isWebP(bytes)) {
    throw new ContentError('La imagen generada no llegó en WebP. Puedes reintentar solo esta vista.', 'IMAGEN_FORMATO_INVALIDO', 502);
  }
  return bytes;
}
